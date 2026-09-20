/**
 * Demo project #3 – "Neon Arena" (offline).
 * Server-authoritative PvP deathmatch: teams, rounds, validated hitscan,
 * kill feed and a fully code-driven HUD.
 */

const config = `--[[
	Config – broń, runda i mapa. Serwer i klient czytają ten sam plik,
	więc podgląd rozrzutu i UI pokazują dokładnie to, co robi serwer.
]]
local Config = {}

Config.MaxHealth = 100
Config.WalkSpeed = 20
Config.JumpPower = 54
Config.Gravity = 130

Config.RoundTime = 180        -- sekundy na rundę
Config.KillLimit = 25         -- wygrywa drużyna z iloma zabójstwami
Config.Intermission = 12      -- przerwa między rundami
Config.RespawnDelay = 3

Config.Weapon = {
	name = "Pulse Rifle",
	damage = 22,
	headshotMultiplier = 2,
	fireRate = 0.11,          -- sekundy między strzałami
	magazine = 30,
	reloadTime = 1.8,
	range = 320,
	spreadDegrees = 0.75,     -- rozrzut liczony NA SERWERZE
	movingSpreadBonus = 1.8,  -- dodatkowy rozrzut w ruchu
	falloffMin = 0.45,        -- minimalny mnożnik obrażeń na maksymalnym dystansie
}

Config.Teams = {
	{ name = "Czerwoni", color = "#FF5252", spawn = Vector3.new(-90, 4, 0), facing = Vector3.new(1, 0, 0) },
	{ name = "Niebiescy", color = "#4FC3F7", spawn = Vector3.new(90, 4, 0), facing = Vector3.new(-1, 0, 0) },
}

Config.Arena = {
	size = 220,               -- bok kwadratu areny
	wallHeight = 26,
	coverCount = 42,          -- liczba skrzyń/osłon generowanych deterministycznie
	seed = 771122,
}

Config.Remotes = {
	Fire = "Fire",                 -- klient -> serwer: origin, direction
	Reload = "Reload",             -- klient -> serwer
	Hit = "Hit",                   -- serwer -> klient (trafienie / brak trafienia)
	Shot = "Shot",                 -- serwer -> klient (tracer i dźwięk u wszystkich)
	State = "State",               -- serwer -> klient (HP, amunicja, czas, wynik)
	Feed = "Feed",                 -- serwer -> klient (kill feed, komunikaty)
	Damage = "Damage",             -- serwer -> klient (kierunek otrzymanych obrażeń)
}

return Config
`;

const weaponUtil = `--[[
	WeaponUtil – matematyka strzału wspólna dla klienta i serwera.
	Rozrzut liczy SERWER (klient może go tylko pokazać), dzięki czemu
	nie da się strzelać bez rozrzutu przez modyfikację klienta.
]]
local WeaponUtil = {}

local rng = Random.new(os.clock() * 1000)

--- Zwraca kierunek z losowym rozrzutem w stożku (w stopniach).
function WeaponUtil.applySpread(direction, spreadDegrees, extra)
	local totalSpread = spreadDegrees * (extra or 1)
	if totalSpread <= 0 then
		return direction
	end
	local radians = math.rad(totalSpread)
	local offset = Vector3.new(
		rng:NextNumber(-radians, radians),
		rng:NextNumber(-radians, radians),
		rng:NextNumber(-radians, radians)
	)
	return (direction + offset).Unit
end

--- Mnożnik obrażeń wraz z dystansem (broń słabnie na końcu mapy).
function WeaponUtil.damageFalloff(baseDamage, distance, falloffMin)
	local distanceFactor = math.clamp(distance / 320, 0, 1)
	return baseDamage * (1 - (1 - falloffMin) * distanceFactor)
end

--- Ile amunicji pokazuje UI w danym momencie (klient i serwer liczą tak samo).
function WeaponUtil.formatAmmo(ammo, magazine)
	return ammo .. " / " .. magazine
end

return WeaponUtil
`;

const mapBuilder = `--[[
	MapBuilder – deterministyczna arena PvP: podłoga, ściany, osłony, rampy
	i stanowiska startowe drużyn. Ten sam seed = identyczna mapa na serwerze
	i u każdego gracza.
]]
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))

local MapBuilder = {}

local rng = Random.new(Config.Arena.seed)

local function newPart(props)
	local part = Instance.new("Part")
	part.Anchored = true
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	for key, value in pairs(props) do
		part[key] = value
	end
	return part
end

--- Buduje arenę i zwraca tabelę z informacjami o punktach startowych.
function MapBuilder.build()
	local root = Instance.new("Folder")
	root.Name = "Arena"
	root.Parent = workspace

	local size = Config.Arena.size
	local half = size / 2

	newPart({
		Name = "Floor",
		Size = Vector3.new(size, 4, size),
		Position = Vector3.new(0, -2, 0),
		Color = Color3.fromHex("#1B1F33"),
		Material = Enum.Material.Slate,
		Parent = root,
	})

	-- Ściany trzymają graczy w arenie (i pociski też).
	local walls = {
		{ Vector3.new(size, Config.Arena.wallHeight, 4), Vector3.new(0, Config.Arena.wallHeight / 2, -half) },
		{ Vector3.new(size, Config.Arena.wallHeight, 4), Vector3.new(0, Config.Arena.wallHeight / 2, half) },
		{ Vector3.new(4, Config.Arena.wallHeight, size), Vector3.new(-half, Config.Arena.wallHeight / 2, 0) },
		{ Vector3.new(4, Config.Arena.wallHeight, size), Vector3.new(half, Config.Arena.wallHeight / 2, 0) },
	}
	for index, wall in ipairs(walls) do
		newPart({
			Name = "Wall" .. index,
			Size = wall[1],
			Position = wall[2],
			Color = Color3.fromHex("#2A3050"),
			Material = Enum.Material.Concrete,
			Transparency = 0.1,
			Parent = root,
		})
	end

	-- Osłony: symetryczne, żeby żadna drużyna nie miała przewagi.
	local cover = Instance.new("Folder")
	cover.Name = "Cover"
	cover.Parent = root

	local placed = {}
	local function isFree(position, minimumDistance)
		for _, existing in ipairs(placed) do
			if (existing - position).Magnitude < minimumDistance then
				return false
			end
		end
		return true
	end

	local attempts = 0
	local created = 0
	while created < Config.Arena.coverCount and attempts < 400 do
		attempts += 1
		local x = rng:NextNumber(-half + 18, half - 18)
		local z = rng:NextNumber(-half + 18, half - 18)
		local position = Vector3.new(x, 0, z)
		if not isFree(position, 22) then
			continue
		end
		table.insert(placed, position)

		local height = rng:NextNumber(4, 12)
		local width = rng:NextNumber(8, 18)
		local depth = rng:NextNumber(8, 18)
		local block = newPart({
			Name = "Cover" .. created,
			Size = Vector3.new(width, height, depth),
			Position = Vector3.new(x, height / 2, z),
			Orientation = Vector3.new(0, rng:NextNumber(0, 90), 0),
			Color = Color3.fromHex("#31385C"),
			Material = Enum.Material.Metal,
			Parent = cover,
		})
		block:SetAttribute("Cover", true)

		-- Połowa osłon ma neonową krawędź – czytelna orientacja w ciemnej arenie.
		if created % 2 == 0 then
			newPart({
				Name = "Trim",
				Size = Vector3.new(width + 0.6, 0.4, depth + 0.6),
				Position = Vector3.new(x, height + 0.2, z),
				Orientation = Vector3.new(0, block.Orientation.Y, 0),
				Color = Color3.fromHex("#00E5A0"),
				Material = Enum.Material.Neon,
				CanCollide = false,
				Parent = cover,
			})
		end

		-- Połowa osłon ma też wersję "odwróconą" po drugiej stronie mapy:
		-- lustrzane odbicie gwarantuje sprawiedliwość rozgrywki.
		local mirrorPosition = Vector3.new(-x, 0, -z)
		if isFree(mirrorPosition, 22) then
			table.insert(placed, mirrorPosition)
			newPart({
				Name = "CoverMirror" .. created,
				Size = Vector3.new(width, height, depth),
				Position = Vector3.new(-x, height / 2, -z),
				Orientation = Vector3.new(0, block.Orientation.Y, 0),
				Color = Color3.fromHex("#31385C"),
				Material = Enum.Material.Metal,
				Parent = cover,
			}):SetAttribute("Cover", true)
		end

		created += 1
	end

	-- Centralna platforma: punkt sporny w środku mapy.
	newPart({
		Name = "CenterPlatform",
		Size = Vector3.new(40, 2, 40),
		Position = Vector3.new(0, 8, 0),
		Color = Color3.fromHex("#7E57C2"),
		Material = Enum.Material.Neon,
		Transparency = 0.25,
		Parent = root,
	})
	for _, offset in ipairs({ Vector3.new(-14, 0, 0), Vector3.new(14, 0, 0) }) do
		newPart({
			Name = "Ramp",
			Size = Vector3.new(4, 18, 16),
			Position = Vector3.new(offset.X, 0, 26),
			Orientation = Vector3.new(-22, 0, 0),
			Color = Color3.fromHex("#3A4270"),
			Material = Enum.Material.Concrete,
			Parent = root,
		})
	end

	-- Stanowiska drużyn.
	local spawns = {}
	for index, team in ipairs(Config.Teams) do
		local spawnPad = newPart({
			Name = "TeamSpawn" .. index,
			Size = Vector3.new(26, 1.5, 26),
			Position = team.spawn - Vector3.new(0, 2.5, 0),
			Color = Color3.fromHex(team.color),
			Material = Enum.Material.Neon,
			Transparency = 0.2,
			Parent = root,
		})
		local light = Instance.new("PointLight")
		light.Color = Color3.fromHex(team.color)
		light.Brightness = 2
		light.Range = 46
		light.Parent = spawnPad
		spawns[index] = team.spawn
	end

	return { root = root, spawns = spawns, half = half }
end

return MapBuilder
`;

const combatService = `--[[
	CombatService – hitscan PvP po stronie serwera.
	Serwer sam sprawdza: czy gracz żyje, czy przeładowuje, czy nie strzela
	za szybko, czy origin jest przy postaci, ile ma amunicji i w co trafił.
	Klient dostaje tylko efekty (tracer, hitmarker, obrażenia).
]]
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local WeaponUtil = require(Shared:WaitForChild("WeaponUtil"))

local CombatService = {}

local playerData = {}   -- [Player] = {ammo, reloading, lastShot, kills, deaths, damageDealt}
local remotes = nil
local roundActive = false
local onKill = nil      -- callback do RoundService (wyniki drużyn)

function CombatService.init(remoteTable, callbacks)
	remotes = remoteTable
	onKill = callbacks.onKill
end

function CombatService.resetPlayer(player)
	playerData[player] = {
		ammo = Config.Weapon.magazine,
		reloading = false,
		lastShot = 0,
		kills = 0,
		deaths = 0,
		damageDealt = 0,
	}
end

function CombatService.resetAmmo(player, refill)
	local data = playerData[player]
	if not data then
		return
	end
	data.reloading = false
	if refill then
		data.ammo = Config.Weapon.magazine
	end
end

function CombatService.setRoundActive(value)
	roundActive = value
end

function CombatService.getData(player)
	return playerData[player]
end

local function characterOf(player)
	local character = player.Character
	if not character or not character.Parent then
		return nil
	end
	local humanoid = character:FindFirstChildOfClass("Humanoid")
	local head = character:FindFirstChild("Head")
	local root = character:FindFirstChild("HumanoidRootPart")
	if not humanoid or not head or not root then
		return nil
	end
	if humanoid.Health <= 0 then
		return nil
	end
	return character, humanoid, head, root
end

local function makeTracer(fromPosition, toPosition, color)
	local distance = (toPosition - fromPosition).Magnitude
	if distance < 0.5 then
		return
	end
	local tracer = Instance.new("Part")
	tracer.Name = "Tracer"
	tracer.Anchored = true
	tracer.CanCollide = false
	tracer.CanQuery = false
	tracer.CanTouch = false
	tracer.Material = Enum.Material.Neon
	tracer.Color = color
	tracer.Size = Vector3.new(0.22, 0.22, distance)
	tracer.CFrame = CFrame.lookAt(fromPosition, toPosition) * CFrame.new(0, 0, -distance / 2)
	tracer.Parent = workspace
	task.delay(0.06, function()
		tracer:Destroy()
	end)
end

function CombatService.handleFire(player, origin, direction)
	local character, humanoid, head, root = characterOf(player)
	local data = playerData[player]
	if not character or not data or not roundActive then
		return
	end
	if data.reloading then
		return
	end
	if typeof(origin) ~= "Vector3" or typeof(direction) ~= "Vector3" then
		return
	end
	if direction.Magnitude < 0.5 then
		return
	end

	local now = os.clock()
	if now - data.lastShot < Config.Weapon.fireRate then
		return                      -- za szybko: klient próbuje oszukiwać albo laguje
	end

	-- Origin musi być przy głowie gracza (max 12 studsów tolerancji na lag).
	if (origin - head.Position).Magnitude > 12 then
		return
	end

	if data.ammo <= 0 then
		remotes.Hit:FireClient(player, "empty")
		return
	end

	data.ammo -= 1
	data.lastShot = now

	-- Rozrzut liczony na serwerze; gracz w ruchu strzela mniej celnie.
	local velocity = root.AssemblyLinearVelocity
	local isMoving = Vector3.new(velocity.X, 0, velocity.Z).Magnitude > 6
	local spread = Config.Weapon.spreadDegrees * (isMoving and Config.Weapon.movingSpreadBonus or 1)
	local shotDirection = WeaponUtil.applySpread(direction.Unit, spread)

	local originPosition = head.Position
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { character, player.Character or character }
	params.IgnoreWater = true

	local result = workspace:Raycast(originPosition, shotDirection * Config.Weapon.range, params)
	local endPosition = result and result.Position or (originPosition + shotDirection * Config.Weapon.range)

	local teamColor = Color3.fromHex("#FFD54F")
	local hitPlayer = nil
	local headshot = false
	local damage = 0

	if result and result.Instance then
		local hitCharacter = result.Instance:FindFirstAncestorOfClass("Model")
		local hitHumanoid = hitCharacter and hitCharacter:FindFirstChildOfClass("Humanoid")
		local hitPlayerObject = hitCharacter and Players:GetPlayerFromCharacter(hitCharacter)

		if hitHumanoid and hitPlayerObject and hitPlayerObject ~= player and hitHumanoid.Health > 0 then
			-- Nie da się trafić sojusznika w tym trybie (friendly fire off).
			if hitPlayerObject.Team ~= player.Team then
				headshot = result.Instance.Name == "Head"
				local baseDamage = Config.Weapon.damage
				if headshot then
					baseDamage *= Config.Weapon.headshotMultiplier
				end
				local distance = (result.Position - originPosition).Magnitude
				damage = math.floor(WeaponUtil.damageFalloff(baseDamage, distance, Config.Weapon.falloffMin))
				hitPlayer = hitPlayerObject
				data.damageDealt += damage

				-- Efekt dostania obrażeń: klient wie, z którego kierunku oberwał.
				remotes.Damage:FireClient(hitPlayerObject, damage, originPosition)
				-- Ostatni napastnik trafia na postać ofiary – z tego korzysta kill feed.
				hitCharacter:SetAttribute("LastAttacker", player)
				teamColor = Color3.fromHex("#FF5252")
				hitHumanoid:TakeDamage(damage)
			end
		end
	end

	makeTracer(originPosition, endPosition, teamColor)
	remotes.Shot:FireAllClients(player, originPosition, endPosition, headshot)
	remotes.Hit:FireClient(player, hitPlayer and (headshot and "headshot" or "hit") or "miss", damage)
	CombatService.pushState(player)
end

function CombatService.handleReload(player)
	local data = playerData[player]
	local character = player.Character
	if not data or not character then
		return
	end
	if data.reloading or data.ammo >= Config.Weapon.magazine then
		return
	end
	data.reloading = true
	CombatService.pushState(player)

	task.delay(Config.Weapon.reloadTime, function()
		-- Sprawdzamy, czy gracz nadal żyje i czy nie zginął w trakcie przeładowania.
		if playerData[player] == data and characterOf(player) then
			data.ammo = Config.Weapon.magazine
			data.reloading = false
			CombatService.pushState(player)
		end
	end)
end

function CombatService.pushState(player)
	local data = playerData[player]
	if not data then
		return
	end
	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	remotes.State:FireClient(player, {
		health = humanoid and math.max(0, math.floor(humanoid.Health)) or 0,
		maxHealth = Config.MaxHealth,
		ammo = data.ammo,
		magazine = Config.Weapon.magazine,
		reloading = data.reloading,
		kills = data.kills,
		deaths = data.deaths,
	})
end

--- Wywoływane raz na każdą postać gracza – tu zbieramy zabójstwa.
function CombatService.watchCharacter(player, character)
	local humanoid = character:WaitForChild("Humanoid")
	CombatService.resetPlayer(player)
	CombatService.pushState(player)

	humanoid.Died:Connect(function()
		local data = playerData[player]
		data.deaths += 1

		-- Zabójca = ostatnia postać, która zadała obrażenia (śledzimy przez atrybut).
		local killer = character:GetAttribute("LastAttacker")
		local killerPlayer = killer and Players:GetPlayerFromCharacter(killer)

		if killerPlayer and killerPlayer ~= player then
			local killerData = playerData[killerPlayer]
			if killerData then
				killerData.kills += 1
			end
			remotes.Feed:FireAllClients("KillFeed", killerPlayer.DisplayName, player.DisplayName)
			if onKill then
				onKill(killerPlayer, player)
			end
		else
			remotes.Feed:FireAllClients("KillFeed", nil, player.DisplayName)
		end

		remotes.State:FireClient(player, {
			health = 0, maxHealth = Config.MaxHealth, ammo = 0,
			magazine = Config.Weapon.magazine, reloading = false,
			kills = data.kills, deaths = data.deaths, dead = true,
		})

		-- Respawn po krótkiej chwili, żeby runda nie zamieniała się w kolejkę.
		task.delay(Config.RespawnDelay, function()
			if roundActive and player.Parent then
				player:LoadCharacter()
			end
		end)
	end)
end

--- Gracz, który zadał obrażenia, zapisujemy na postaci (dla kill feedu).
function CombatService.markAttacker(victimCharacter, attacker)
	victimCharacter:SetAttribute("LastAttacker", attacker)
end

function CombatService.clearPlayer(player)
	playerData[player] = nil
end

Players.PlayerRemoving:Connect(function(player)
	playerData[player] = nil
end)

return CombatService
`;

const roundService = `--[[
	RoundService – skrypt startowy serwera: drużyny, runda, wyniki, spawn.
	Pilnuje zasad (kto wygrał, kiedy respawn, kto może strzelać) i wysyła
	stan do klientów.
]]
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")
local Teams = game:GetService("Teams")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))

local MapBuilder = require(script.Parent:WaitForChild("MapBuilder"))
local CombatService = require(script.Parent:WaitForChild("CombatService"))

-- 1. Remotes --------------------------------------------------------
local remotes = Instance.new("Folder")
remotes.Name = "Remotes"
remotes.Parent = ReplicatedStorage

local remotesTable = {}
for key, remoteName in pairs(Config.Remotes) do
	local remote = Instance.new("RemoteEvent")
	remote.Name = remoteName
	remote.Parent = remotes
	remotesTable[key] = remote
end

-- 2. Drużyny --------------------------------------------------------
local teamObjects = {}
for index, teamConfig in ipairs(Config.Teams) do
	local team = Teams:FindFirstChild(teamConfig.name)
	if not team then
		team = Instance.new("Team")
		team.Name = teamConfig.name
		team.TeamColor = BrickColor.new(teamConfig.name == "Czerwoni" and "Bright red" or "Bright blue")
		team.AutoAssignable = index == 1
		team.Parent = Teams
	end
	teamObjects[index] = team
end

-- 3. Mapa -----------------------------------------------------------
local arena = MapBuilder.build()
Workspace.Gravity = Config.Gravity

-- 4. Stan rundy -----------------------------------------------------
local state = {
	roundActive = false,
	timeLeft = Config.RoundTime,
	scores = { 0, 0 },
	roundNumber = 0,
	winner = nil,
}

local function teamIndexOf(player)
	for index, team in ipairs(teamObjects) do
		if player.Team == team then
			return index
		end
	end
	return 1
end

local function pushState()
	remotesTable.State:FireAllClients({
		roundActive = state.roundActive,
		timeLeft = state.timeLeft,
		scores = state.scores,
		roundNumber = state.roundNumber,
		winner = state.winner,
	})
end

local function feed(kind, a, b, color)
	remotesTable.Feed:FireAllClients(kind, a, b, color)
end

-- 5. Drużyna i postać gracza ---------------------------------------
local function assignTeam(player)
	if player.Team then
		return
	end
	-- Balans: mniej liczna drużyna dostaje gracza.
	local counts = { 0, 0 }
	for _, other in ipairs(Players:GetPlayers()) do
		local index = teamIndexOf(other)
		counts[index] += 1
	end
	local targetIndex = if counts[1] <= counts[2] then 1 else 2
	player.Team = teamObjects[targetIndex]
	player.Neutral = false
end

local function setupCharacter(player, character)
	local humanoid = character:WaitForChild("Humanoid")
	humanoid.MaxHealth = Config.MaxHealth
	humanoid.Health = Config.MaxHealth
	humanoid.WalkSpeed = Config.WalkSpeed
	humanoid.JumpPower = Config.JumpPower
	humanoid.UseJumpPower = true

	CombatService.watchCharacter(player, character)
end

local function setupPlayer(player)
	assignTeam(player)
	local teamIndex = teamIndexOf(player)
	local spawn = arena.spawns[teamIndex] or Vector3.new(0, 6, 0)

	local spawnLocation = Instance.new("SpawnLocation")
	spawnLocation.Name = "PlayerSpawn"
	spawnLocation.Size = Vector3.new(8, 1, 8)
	spawnLocation.Position = spawn
	spawnLocation.Anchored = true
	spawnLocation.Duration = 0
	spawnLocation.Neutral = true
	spawnLocation.Transparency = 1
	spawnLocation.CanCollide = true
	spawnLocation.Parent = arena.root
	player.RespawnLocation = spawnLocation

	player.CharacterAdded:Connect(function(character)
		setupCharacter(player, character)
	end)
	if player.Character then
		setupCharacter(player, player.Character)
	end

	CombatService.pushState(player)
end

for _, player in ipairs(Players:GetPlayers()) do
	task.spawn(setupPlayer, player)
end
Players.PlayerAdded:Connect(setupPlayer)
Players.PlayerRemoving:Connect(function(player)
	CombatService.clearPlayer(player)
end)

-- 6. Trafienia i przeładowania -------------------------------------
CombatService.init(remotesTable, {
	onKill = function(killer, victim)
		local killerIndex = teamIndexOf(killer)
		state.scores[killerIndex] += 1
		feed("Score", killer.DisplayName, state.scores[killerIndex], Color3.fromHex(Config.Teams[killerIndex].color))
		pushState()
	end,
})

remotesTable.Fire.OnServerEvent:Connect(function(player, origin, direction)
	CombatService.handleFire(player, origin, direction)
end)

remotesTable.Reload.OnServerEvent:Connect(function(player)
	CombatService.handleReload(player)
end)

-- 7. Pętla rund -----------------------------------------------------
local function teleportToSpawn(player)
	local teamIndex = teamIndexOf(player)
	local spawn = arena.spawns[teamIndex] or Vector3.new(0, 8, 0)
	if player.Character then
		local root = player.Character:FindFirstChild("HumanoidRootPart")
		if root then
			root.CFrame = CFrame.new(spawn) * CFrame.new(0, 4, 0)
		end
	end
end

local function startRound()
	state.roundNumber += 1
	state.timeLeft = Config.RoundTime
	state.winner = nil
	state.roundActive = true
	CombatService.setRoundActive(true)

	for _, player in ipairs(Players:GetPlayers()) do
		player:LoadCharacter()
		task.delay(0.6, function()
			teleportToSpawn(player)
			CombatService.resetAmmo(player, true)
		end)
	end

	feed("Info", "Runda " .. state.roundNumber .. " – do " .. Config.KillLimit .. " zabójstw!", nil, Color3.fromHex("#00E5A0"))
	pushState()
end

local function endRound(winnerIndex, reason)
	state.roundActive = false
	CombatService.setRoundActive(false)
	state.winner = winnerIndex
	local winnerName = winnerIndex and Config.Teams[winnerIndex].name or "Remis"
	feed("End", winnerName, reason, Color3.fromHex(winnerIndex and Config.Teams[winnerIndex].color or "#E0E6FF"))
	pushState()
end

task.spawn(function()
	while true do
		-- Przerwa przed rundą (gdy brak graczy, czekamy bez końca).
		state.roundActive = false
		CombatService.setRoundActive(false)
		feed("Info", "Nowa runda za " .. Config.Intermission .. " s. Wybierz osłonę!", nil, Color3.fromHex("#FFD54F"))
		for remaining = Config.Intermission, 1, -1 do
			state.timeLeft = remaining
			pushState()
			task.wait(1)
			if #Players:GetPlayers() == 0 then
				remaining = Config.Intermission
			end
		end

		startRound()

		while state.timeLeft > 0 and state.roundActive do
			task.wait(1)
			state.timeLeft -= 1
			-- Koniec rundy: limit zabójstw albo czas.
			if state.scores[1] >= Config.KillLimit then
				endRound(1, "limit zabójstw")
				break
			elseif state.scores[2] >= Config.KillLimit then
				endRound(2, "limit zabójstw")
				break
			elseif state.timeLeft <= 0 then
				if state.scores[1] == state.scores[2] then
					endRound(nil, "remis")
				else
					endRound(state.scores[1] > state.scores[2] and 1 or 2, "czas")
				end
			end
			pushState()
		end

		task.wait(4)
		state.scores = { 0, 0 }
	end
end)

print("[RoundService] Neon Arena wystartowała: " .. Config.RoundTime .. " s rundy, do " .. Config.KillLimit .. " zabójstw.");
`;

const weaponController = `--[[
	WeaponController – klient: strzelanie, przeładowanie, rozrzut, odrzut kamery,
	efekty trafień. Klient NIE zadaje obrażeń – wysyła tylko intencję strzału,
	a serwer rozstrzyga wszystko (patrz CombatService).
]]
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UserInputService = game:GetService("UserInputService")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")

local player = Players.LocalPlayer
local camera = workspace.CurrentCamera

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))

local remotes = ReplicatedStorage:WaitForChild("Remotes")
local fireRemote = remotes:WaitForChild(Config.Remotes.Fire)
local reloadRemote = remotes:WaitForChild(Config.Remotes.Reload)
local shotRemote = remotes:WaitForChild(Config.Remotes.Shot)
local stateRemote = remotes:WaitForChild(Config.Remotes.State)

local state = { ammo = Config.Weapon.magazine, reloading = false, health = Config.MaxHealth }
local firing = false
local lastShotAt = 0
local recoil = 0
local BASE_FOV = 78
local ADS_FOV = 55
local aiming = false


-- Prosty model broni w rękach (bez assetów, same Part-y).
local viewModel = Instance.new("Model")
viewModel.Name = "ViewModel"
local function vmPart(name, size, color, offset)
	local part = Instance.new("Part")
	part.Name = name
	part.Size = size
	part.Color = color
	part.Material = Enum.Material.Metal
	part.Anchored = true
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.Parent = viewModel
	part:SetAttribute("Offset", offset)
	return part
end
vmPart("Body", Vector3.new(0.35, 0.45, 2.2), Color3.fromHex("#2A3050"), Vector3.new(0.9, -0.8, -1.6))
vmPart("Barrel", Vector3.new(0.18, 0.18, 1.4), Color3.fromHex("#7E57C2"), Vector3.new(0.9, -0.72, -2.9))
vmPart("Sight", Vector3.new(0.12, 0.22, 0.5), Color3.fromHex("#00E5A0"), Vector3.new(0.9, -0.55, -1.9))
viewModel.Parent = camera

local muzzleFlash = Instance.new("PointLight")
muzzleFlash.Brightness = 0
muzzleFlash.Range = 18
muzzleFlash.Color = Color3.fromHex("#FFD54F")
muzzleFlash.Parent = viewModel:FindFirstChild("Barrel")

local function updateViewModel()
	for _, part in ipairs(viewModel:GetChildren()) do
		if part:IsA("BasePart") then
			local offset = part:GetAttribute("Offset")
			part.CFrame = camera.CFrame * CFrame.new(offset) * CFrame.Angles(0, 0, math.rad(recoil * 12))
		end
	end
end

-- Dynamiczny celownik: rozrzut rośnie w ruchu i podczas strzelania.
local gui = Instance.new("ScreenGui")
gui.Name = "ArenaWeapon"
gui.IgnoreGuiInset = true
gui.ResetOnSpawn = false
gui.Parent = player:WaitForChild("PlayerGui")

local crosshair = Instance.new("Frame")
crosshair.AnchorPoint = Vector2.new(0.5, 0.5)
crosshair.Position = UDim2.fromScale(0.5, 0.5)
crosshair.Size = UDim2.fromOffset(14, 14)
crosshair.BackgroundTransparency = 1
crosshair.Parent = gui

local lines = {}
for index, offset in ipairs({ Vector2.new(0, -1), Vector2.new(0, 1), Vector2.new(-1, 0), Vector2.new(1, 0) }) do
	local line = Instance.new("Frame")
	line.AnchorPoint = Vector2.new(0.5, 0.5)
	line.Size = UDim2.fromOffset(offset.X ~= 0 and 6 or 2, offset.X ~= 0 and 2 or 6)
	line.BackgroundColor3 = Color3.fromHex("#00E5A0")
	line.BorderSizePixel = 0
	line.Parent = crosshair
	lines[index] = { frame = line, direction = offset }
end

local hitMarker = Instance.new("TextLabel")
hitMarker.AnchorPoint = Vector2.new(0.5, 0.5)
hitMarker.Position = UDim2.fromScale(0.5, 0.5)
hitMarker.Size = UDim2.fromOffset(70, 70)
hitMarker.BackgroundTransparency = 1
hitMarker.Text = "✕"
hitMarker.TextScaled = true
hitMarker.TextTransparency = 1
hitMarker.TextColor3 = Color3.fromHex("#FFFFFF")
hitMarker.Parent = gui

local function flashHitMarker(color)
	hitMarker.TextColor3 = color
	hitMarker.TextTransparency = 0
	hitMarker.Size = UDim2.fromOffset(70, 70)
	local tween = TweenService:Create(hitMarker, TweenInfo.new(0.25), { TextTransparency = 1, Size = UDim2.fromOffset(96, 96) })
	tween:Play()
end

local function updateCrosshair(dt)
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	local speed = 0
	if root then
		local velocity = root.AssemblyLinearVelocity
		speed = Vector3.new(velocity.X, 0, velocity.Z).Magnitude
	end
	local moving = speed > 6
	local baseSpread = Config.Weapon.spreadDegrees * (moving and Config.Weapon.movingSpreadBonus or 1)
	local gap = 8 + baseSpread * 26 + recoil * 26

	for _, line in ipairs(lines) do
		line.frame.Position = UDim2.fromScale(0.5, 0.5) + UDim2.fromOffset(line.direction.X * gap * 0.7, line.direction.Y * gap * 0.7)
	end

	recoil = math.max(0, recoil - dt * 3.2)
end

local function tryFire()
	local now = os.clock()
	if now - lastShotAt < Config.Weapon.fireRate then
		return
	end
	if state.reloading or state.ammo <= 0 then
		if state.ammo <= 0 and not state.reloading then
			reloadRemote:FireServer()
		end
		return
	end

	lastShotAt = now
	state.ammo -= 1           -- lokalne odejmowanie dla UI; serwer weryfikuje

	local origin = camera.CFrame.Position
	local direction = camera.CFrame.LookVector
	fireRemote:FireServer(origin, direction)

	-- Efekty natychmiastowe (klient), żeby strzał "czuć" bez opóźnienia sieci.
	recoil = math.min(1, recoil + 0.45)
	muzzleFlash.Brightness = 6
	task.delay(0.05, function()
		muzzleFlash.Brightness = 0
	end)
	camera.CFrame = camera.CFrame * CFrame.Angles(math.rad(recoil * 0.9), 0, math.rad((math.random() - 0.5) * recoil * 0.7))
end

UserInputService.InputBegan:Connect(function(input, gameProcessed)
	if gameProcessed then
		return
	end
	if input.UserInputType == Enum.UserInputType.MouseButton1 then
		firing = true
	elseif input.KeyCode == Enum.KeyCode.R then
		reloadRemote:FireServer()
	elseif input.KeyCode == Enum.KeyCode.F then
		aiming = not aiming
		TweenService:Create(camera, TweenInfo.new(0.15), { FieldOfView = aiming and ADS_FOV or BASE_FOV }):Play()
	end
end)

UserInputService.InputEnded:Connect(function(input)
	if input.UserInputType == Enum.UserInputType.MouseButton1 then
		firing = false
	end
end)

-- Broń automatyczna: strzał w każdej klatce, gdy trzymamy LPM.
RunService.RenderStepped:Connect(function(dt)
	if player:GetAttribute("RoundActive") ~= false and firing then
		tryFire()
	end
	updateCrosshair(dt)
	updateViewModel()
end)

shotRemote.OnClientEvent:Connect(function(shooter, fromPosition, toPosition, headshot)
	if shooter == player then
		return              -- własny tracer już pokazaliśmy lokalnie
	end
	-- Tracer innych graczy rysujemy lokalnie (bez ruchu sieciowego).
	local distance = (toPosition - fromPosition).Magnitude
	if distance < 1 then
		return
	end
	local tracer = Instance.new("Part")
	tracer.Anchored = true
	tracer.CanCollide = false
	tracer.CanQuery = false
	tracer.CanTouch = false
	tracer.Material = Enum.Material.Neon
	tracer.Color = Color3.fromHex("#FFD54F")
	tracer.Size = Vector3.new(0.2, 0.2, distance)
	tracer.CFrame = CFrame.lookAt(fromPosition, toPosition) * CFrame.new(0, 0, -distance / 2)
	tracer.Parent = workspace
	task.delay(0.06, function()
		tracer:Destroy()
	end)
	if headshot then
		flashHitMarker(Color3.fromHex("#FFD54F"))
	end
end)

remotes:WaitForChild(Config.Remotes.Hit).OnClientEvent:Connect(function(kind, damage)
	if kind == "hit" then
		flashHitMarker(Color3.fromHex("#FFFFFF"))
	elseif kind == "headshot" then
		flashHitMarker(Color3.fromHex("#FFD54F"))
	elseif kind == "empty" then
		flashHitMarker(Color3.fromHex("#FF5252"))
	end
end)

stateRemote.OnClientEvent:Connect(function(newState)
	state = newState
	player:SetAttribute("RoundActive", newState.roundActive ~= false)
end)

-- Inne pliki klienckie czytają stan stąd (atrybuty gracza zamiast globali).
RunService.Heartbeat:Connect(function()
	player:SetAttribute("Ammo", state.ammo)
	player:SetAttribute("Magazine", Config.Weapon.magazine)
	player:SetAttribute("Reloading", state.reloading == true)
	player:SetAttribute("Health", state.health)
end)
`;

const hudArena = `--[[
	HUD (Neon Arena) – pasek życia, amunicja, czas rundy, wynik drużyn,
	kill feed i winieta obrażeń. Wszystko rysowane w kodzie.
]]
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))

local remotes = ReplicatedStorage:WaitForChild("Remotes")
local stateRemote = remotes:WaitForChild(Config.Remotes.State)
local feedRemote = remotes:WaitForChild(Config.Remotes.Feed)
local damageRemote = remotes:WaitForChild(Config.Remotes.Damage)

local gui = Instance.new("ScreenGui")
gui.Name = "ArenaHUD"
gui.IgnoreGuiInset = true
gui.ResetOnSpawn = false
gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
gui.Parent = playerGui

local function corner(parent, radius)
	local c = Instance.new("UICorner")
	c.CornerRadius = UDim.new(0, radius)
	c.Parent = parent
	return c
end

-- Pasek życia (lewy dolny róg)
local healthBack = Instance.new("Frame")
healthBack.AnchorPoint = Vector2.new(0, 1)
healthBack.Position = UDim2.new(0, 24, 1, -24)
healthBack.Size = UDim2.fromOffset(320, 26)
healthBack.BackgroundColor3 = Color3.fromHex("#111528")
healthBack.BorderSizePixel = 0
healthBack.Parent = gui
corner(healthBack, 8)

local healthFill = Instance.new("Frame")
healthFill.Size = UDim2.fromScale(1, 1)
healthFill.BackgroundColor3 = Color3.fromHex("#00E5A0")
healthFill.BorderSizePixel = 0
healthFill.Parent = healthBack
corner(healthFill, 8)

local healthText = Instance.new("TextLabel")
healthText.BackgroundTransparency = 1
healthText.Size = UDim2.fromScale(1, 1)
healthText.Font = Enum.Font.GothamBold
healthText.TextScaled = true
healthText.Text = "100"
healthText.TextColor3 = Color3.fromHex("#0B0E1A")
healthText.Parent = healthBack
do
	local constraint = Instance.new("UITextSizeConstraint")
	constraint.MaxTextSize = 22
	constraint.Parent = healthText
end

-- Amunicja (prawy dolny róg)
local ammoLabel = Instance.new("TextLabel")
ammoLabel.AnchorPoint = Vector2.new(1, 1)
ammoLabel.Position = UDim2.new(1, -24, 1, -24)
ammoLabel.Size = UDim2.fromOffset(240, 56)
ammoLabel.BackgroundTransparency = 1
ammoLabel.Font = Enum.Font.GothamBold
ammoLabel.TextScaled = true
ammoLabel.Text = "30 / 30"
ammoLabel.TextColor3 = Color3.fromHex("#E0E6FF")
ammoLabel.Parent = gui
do
	local constraint = Instance.new("UITextSizeConstraint")
	constraint.MaxTextSize = 44
	constraint.Parent = ammoLabel
end

-- Czas i wynik (góra środek)
local topPanel = Instance.new("Frame")
topPanel.AnchorPoint = Vector2.new(0.5, 0)
topPanel.Position = UDim2.new(0.5, 0, 0, 16)
topPanel.Size = UDim2.fromOffset(460, 62)
topPanel.BackgroundColor3 = Color3.fromHex("#111528")
topPanel.BackgroundTransparency = 0.12
topPanel.BorderSizePixel = 0
topPanel.Parent = gui
corner(topPanel, 12)

local redScore = Instance.new("TextLabel")
redScore.AnchorPoint = Vector2.new(1, 0.5)
redScore.Position = UDim2.fromScale(0.32, 0.5)
redScore.Size = UDim2.fromOffset(90, 46)
redScore.BackgroundTransparency = 1
redScore.Font = Enum.Font.GothamBold
redScore.TextScaled = true
redScore.Text = "0"
redScore.TextColor3 = Color3.fromHex(Config.Teams[1].color)
redScore.Parent = topPanel

local blueScore = Instance.new("TextLabel")
blueScore.AnchorPoint = Vector2.new(0, 0.5)
blueScore.Position = UDim2.fromScale(0.68, 0.5)
blueScore.Size = UDim2.fromOffset(90, 46)
blueScore.BackgroundTransparency = 1
blueScore.Font = Enum.Font.GothamBold
blueScore.TextScaled = true
blueScore.Text = "0"
blueScore.TextColor3 = Color3.fromHex(Config.Teams[2].color)
blueScore.Parent = topPanel

local timerLabel = Instance.new("TextLabel")
timerLabel.AnchorPoint = Vector2.new(0.5, 0.5)
timerLabel.Position = UDim2.fromScale(0.5, 0.5)
timerLabel.Size = UDim2.fromOffset(140, 50)
timerLabel.BackgroundTransparency = 1
timerLabel.Font = Enum.Font.GothamBlack
timerLabel.TextScaled = true
timerLabel.Text = "3:00"
timerLabel.TextColor3 = Color3.fromHex("#FFFFFF")
timerLabel.Parent = topPanel

-- Kill feed (prawy górny róg)
local feedHolder = Instance.new("Frame")
feedHolder.AnchorPoint = Vector2.new(1, 0)
feedHolder.Position = UDim2.new(1, -20, 0, 20)
feedHolder.Size = UDim2.fromOffset(340, 220)
feedHolder.BackgroundTransparency = 1
feedHolder.Parent = gui

local function pushFeedLine(text, color)
	local line = Instance.new("TextLabel")
	line.Size = UDim2.new(1, 0, 0, 26)
	line.Position = UDim2.fromOffset(0, 0)
	line.BackgroundTransparency = 1
	line.Font = Enum.Font.GothamMedium
	line.TextScaled = true
	line.TextXAlignment = Enum.TextXAlignment.Right
	line.Text = text
	line.TextColor3 = color or Color3.fromHex("#E0E6FF")
	line.Parent = feedHolder
	do
		local constraint = Instance.new("UITextSizeConstraint")
		constraint.MaxTextSize = 20
		constraint.Parent = line
	end

	-- Przesuwamy starsze wiersze w dół i usuwamy najstarsze (max 8).
	local count = 0
	for _, child in ipairs(feedHolder:GetChildren()) do
		if child:IsA("TextLabel") then
			count += 1
			TweenService:Create(child, TweenInfo.new(0.18), { Position = UDim2.fromOffset(0, (count - 1) * 28) }):Play()
		end
		if count > 8 then
			child:Destroy()
		end
	end

	task.delay(7, function()
		if line.Parent then
			TweenService:Create(line, TweenInfo.new(0.4), { TextTransparency = 1 }):Play()
			task.wait(0.45)
			line:Destroy()
		end
	end)
end

-- Winieta obrażeń (czerwona poświata przy trafieniu)
local vignette = Instance.new("Frame")
vignette.Size = UDim2.fromScale(1, 1)
vignette.BackgroundColor3 = Color3.fromHex("#FF1744")
vignette.BackgroundTransparency = 1
vignette.BorderSizePixel = 0
vignette.ZIndex = 0
vignette.Parent = gui

local function hurtFlash(amount)
	local strength = math.clamp(amount / Config.MaxHealth, 0.05, 0.4)
	vignette.BackgroundTransparency = 1 - strength
	TweenService:Create(vignette, TweenInfo.new(0.55), { BackgroundTransparency = 1 }):Play()
end

-- Ekran śmierci
local deathLabel = Instance.new("TextLabel")
deathLabel.AnchorPoint = Vector2.new(0.5, 0.5)
deathLabel.Position = UDim2.fromScale(0.5, 0.42)
deathLabel.Size = UDim2.fromOffset(560, 80)
deathLabel.BackgroundTransparency = 1
deathLabel.Font = Enum.Font.GothamBlack
deathLabel.TextScaled = true
deathLabel.Text = "ELIMINOWANY – respawn za 3 s"
deathLabel.TextColor3 = Color3.fromHex("#FF5252")
deathLabel.TextTransparency = 1
deathLabel.Parent = gui
do
	local constraint = Instance.new("UITextSizeConstraint")
	constraint.MaxTextSize = 52
	constraint.Parent = deathLabel
end

local function refresh()
	local health = player:GetAttribute("Health") or Config.MaxHealth
	local ammo = player:GetAttribute("Ammo") or Config.Weapon.magazine
	local magazine = player:GetAttribute("Magazine") or Config.Weapon.magazine
	local reloading = player:GetAttribute("Reloading")

	healthFill.Size = UDim2.fromScale(math.clamp(health / Config.MaxHealth, 0, 1), 1)
	healthFill.BackgroundColor3 = Color3.fromHex(if health > 60 then "#00E5A0" elseif health > 30 then "#FFC400" else "#FF5252")
	healthText.Text = tostring(math.floor(health))
	healthText.TextColor3 = Color3.fromHex(if health > 60 then "#0B0E1A" else "#1A1020")

	ammoLabel.Text = if reloading then "PRZEŁADOWANIE..." else (tostring(ammo) .. " / " .. tostring(magazine))
	ammoLabel.TextColor3 = Color3.fromHex(if ammo <= 5 then "#FF5252" else "#E0E6FF")
end

stateRemote.OnClientEvent:Connect(function(payload)
	if payload.scores then
		redScore.Text = tostring(payload.scores[1])
		blueScore.Text = tostring(payload.scores[2])
	end
	if payload.timeLeft then
		timerLabel.Text = string.format("%d:%02d", math.floor(payload.timeLeft / 60), payload.timeLeft % 60)
		timerLabel.TextColor3 = Color3.fromHex(if payload.timeLeft <= 20 then "#FF5252" else "#FFFFFF")
	end
	if payload.winner ~= nil or payload.roundActive == false then
		-- Koniec rundy: banner z wynikiem.
	end
	if payload.dead then
		deathLabel.Text = "ELIMINOWANY – respawn za " .. Config.RespawnDelay .. " s"
		deathLabel.TextTransparency = 0
		task.delay(Config.RespawnDelay, function()
			TweenService:Create(deathLabel, TweenInfo.new(0.3), { TextTransparency = 1 }):Play()
		end)
	end
	if payload.health then
		player:SetAttribute("Health", payload.health)
	end
	refresh()
end)

feedRemote.OnClientEvent:Connect(function(kind, a, b, color)
	if kind == "KillFeed" then
		local text = if a then (tostring(a) .. "  ➜  " .. tostring(b)) else (tostring(b) .. " zginął")
		pushFeedLine(text, color)
	elseif kind == "Info" or kind == "End" then
		pushFeedLine(tostring(a), color)
	elseif kind == "Score" then
		pushFeedLine(tostring(a) .. " ma " .. tostring(b) .. " zabójstw", color)
	end
end)

damageRemote.OnClientEvent:Connect(function(amount)
	hurtFlash(amount)
end)

player:GetAttributeChangedSignal("Health"):Connect(refresh)
player:GetAttributeChangedSignal("Ammo"):Connect(refresh)
player:GetAttributeChangedSignal("Reloading"):Connect(refresh)

refresh()
`;

export default {
  id: 'arena',
  aliases: ['arena', 'pvp', 'shooter', 'fps', 'strzelanka', 'deathmatch', '3'],
  genre: 'PvP Shooter',
  name: 'Neon Arena',
  tagline: 'Dwie drużyny, jedna arena, 25 zabójstw do zwycięstwa.',
  summary:
    'Szybki deathmatch 2v2-5v5 na symetrycznej, neonowej arenie. Hitscan w pełni walidowany przez serwer, ' +
    'rundy po 3 minuty, kill feed i respawn po 3 sekundach.',
  design: {
    name: 'Neon Arena',
    tagline: 'Dwie drużyny, jedna arena, 25 zabójstw do zwycięstwa.',
    genre: 'PvP Shooter (deathmatch)',
    summary:
      'Drużynowy deathmatch na symetrycznej arenie 220x220 studsów z centralną platformą w kształcie ' +
      'punktu spornego. Runda trwa 3 minuty albo do 25 zabójstw. Cała walka to hitscan walidowany przez serwer.',
    coreLoop: '1. Wybierz osłonę i zajmij pozycję. 2. Prowadź ogień / kontroluj rozrzut. 3. Przeładuj w bezpiecznym miejscu. 4. Zbieraj zabójstwa dla drużyny. 5. Wygraj rundę.',
    sessionLength: '3-9 min na rundę',
    audience: '12-18 lat, gracze FPS i PvP',
    monetizationIdeas: [
      'Gamepass "Skin broni" – kosmetyka, nie zaburza balansu, a sprzedaje się najlepiej w FPS.',
      'Dev product "Zmiana drużyny" – dla graczy, którzy chcą grać z kolegą.',
      'Gamepass "Statystyki kariery" – ekran z K/D, zabójstwami i celnością.',
    ],
    systems: [
      { name: 'Hitscan po stronie serwera', purpose: 'Uczciwa walka, brak wallbangów i strzałów przez ściany', serverAuthority: 'Serwer sprawdza origin, amunicję, cooldown i sam wykonuje raycast', keyParameters: { damage: 22, headshot: 'x2', range: 320, fireRate: 0.11 } },
      { name: 'Rozrzut', purpose: 'Nagradzać kontrolę ognia i karę za bieganie', serverAuthority: 'Rozrzut liczony TYLKO na serwerze', keyParameters: { spreadDegrees: 0.75, movingSpreadBonus: 1.8 } },
      { name: 'Rundy', purpose: 'Krótkie, powtarzalne sesje z jasnym celem', serverAuthority: 'Serwer trzyma czas, wynik i warunek zwycięstwa', keyParameters: { RoundTime: 180, KillLimit: 25, Intermission: 12 } },
      { name: 'Drużyny', purpose: 'Balans i wspólny cel', serverAuthority: 'Auto-balans po stronie serwera', keyParameters: { teams: 2, friendlyFire: false } },
      { name: 'Respawn', purpose: 'Tempo gry bez długiego czekania', serverAuthority: 'Serwer decyduje kiedy respawn', keyParameters: { RespawnDelay: 3 } },
    ],
    controls: [
      { input: 'WASD + Space', action: 'Ruch i skok (WalkSpeed 20, JumpPower 54)' },
      { input: 'LPM', action: 'Ogień ciągły (automatyczny)' },
      { input: 'R', action: 'Przeładowanie (1,8 s)' },
      { input: 'F', action: 'Przybliżenie (ADS, FOV 55)' },
      { input: 'Mysz', action: 'Celowanie, odrzut kamery po strzale' },
    ],
    objectives: [
      'Zdobądź dla drużyny 25 zabójstw przed upływem 3 minut.',
      'Utrzymaj K/D powyżej 1 (respawn to 3 sekundy, więc agresja się opłaca).',
      'Kontroluj centralną platformę – stąd widać większość osłon.',
    ],
    progression: 'Statystyki per runda (kills, deaths, damage dealt), brak zapisu między sesjami. Kolejne rundy resetują wynik, a kolejne wejście na serwer dobiera drużynę automatycznie na podstawie liczby graczy.',
    balancing: {
      WeaponDamage: 22, Headshot: 44, TTKBody: '5 strzałów (~0,5 s)', TTReloadTime: 1.8,
      magazine: 30, spreadBase: '0,75°', spreadMoving: '1,35°', rounds: '180 s / 25 zabójstw',
    },
    worldLayout:
      'Arena 220x220 studsów zamknięta ścianami 26 studsów wysokości. 42 osłony (4-12 studsów wysokości) rozłożone deterministycznie z seeda i lustrzanie odbity względem środka, żeby obie strony miały identyczne warunki. W centrum platforma 40x40 na wysokości 8 studsów z dwoma rampami. Stanowiska drużyn na X=-90 (czerwoni) i X=+90 (niebiescy).',
    designDoc: [
      '## Koncept',
      'Neon Arena to klasyczny drużynowy deathmatch dla graczy, którzy chcą wejść, pograć 3 minuty i wyjść. ',
      'Zero zapisu, zero grindowania – liczy się wyłącznie runda.',
      '',
      '## Pętla rozgrywki',
      '1. 12-sekundowa przerwa: gracze rozbiegają się na pozycje.',
      '2. Runda startuje, obie drużyny dostają pełne HP i amunicję.',
      '3. Walka: 5 strzałów w korpus (22 HP, TTK ~0,5 s) lub 3 w głowę (44 HP).',
      '4. Śmierć = 3 sekundy przerwy i respawn na swojej stronie.',
      '5. Koniec przy 25 zabójstwach albo po 180 sekundach (przy remisie – remis).',
      '',
      '## Systemy',
      '| System | Rola | Ważne liczby |',
      '| --- | --- | --- |',
      '| CombatService | Walidacja i rozstrzyganie strzałów | 22 dmg, headshot x2 |',
      '| Rozrzut | Kontrola ognia | 0,75° / 1,35° w ruchu |',
      '| RoundService | Runda, wynik, respawn | 180 s, 25 zabójstw |',
      '| MapBuilder | Symetryczna arena | 42 osłony, seed 771122 |',
      '',
      '## Balans',
      'TTK 0,5 s w korpus jest celowo krótkie: gracze mają 3-sekundowy respawn, a runda trwa 3 minuty, ',
      'więc walka musi być szybka. Rozrzut w ruchu (1,35°) podnosi efektywny promień błędu na 100 studsach ',
      'do ~2,4 studsów, co zmusza do zwalniania podczas strzelania. Głowa (x2) nagradza celność, ale nie ',
      'jest jedyną drogą do zabicia – broń jest automatyczna, więc seria w korpus też wygrywa.',
      '',
      '## Mapa',
      'Symetryczne osłony gwarantują, że żadna drużyna nie ma lepszego luku. Centralna platforma nagradza ',
      'agresję (widać z niej 70% mapy), ale jest wystawiona na ostrzał z czterech stron – klasyczny dylemat.',
      '',
      '## UI',
      'Pasek życia (lewy dół), amunicja (prawy dół), czas i wynik (góra środek), kill feed (prawy górny róg), ',
      'winieta obrażeń i ekran eliminacji. Dynamizmy celownik pokazuje aktualny rozrzut – gracz uczy się ',
      'kontroli ognia bez czytania instrukcji.',
      '',
      '## Onboarding gracza',
      '12 sekund przerwy z komunikatem "Nowa runda za N s. Wybierz osłonę!" oraz spawn na własnej stronie ',
      'z widocznymi wrogami dopiero w środku mapy. Zabójstwo/zgon pojawiają się w kill feedzie, więc nowy ',
      'gracz od razu rozumie, gdzie umarł.',
      '',
      '## Ryzyka',
      '* Lag strzałów -> origin walidowany z tolerancją 12 studsów, strzał nie jest odrzucany przy chwilowym opóźnieniu.',
      '* Przewaga jednej strony -> mapa jest lustrzana co do studsa.',
      '* Jeden gracz dominujący -> auto-balans drużyn przy dołączaniu i symetryczna mapa.',
    ].join('\n'),
  },
  notes: [
    'Hitscan w całości rozstrzygany na serwerze: origin musi leżeć w promieniu 12 studsów od głowy gracza, a cooldown broni jest sprawdzany po stronie serwera.',
    'Rozrzut liczy serwer, więc modyfikacja klienta nie da "lasera" – klient tylko rysuje celownik.',
    'Arena jest symetryczna (lustrzane osłony), dzięki czemu przy 220x220 studsach żadna drużyna nie ma przewagi.',
  ],
  plan: {
    architecture: [
      'RoundService to jedyny skrypt uruchamialny: tworzy remotes, drużyny, rundę, wynik i respawny.',
      'CombatService waliduje strzały i rozstrzyga obrażenia; klient nigdy nie mówi "trafiłem".',
      'MapBuilder buduje lustrzaną arenę z jednego seeda – mapa nie jest zapisana w pliku, ale deterministyczna.',
      'Klient (WeaponController + HUD) wysyła tylko Fire/Reload i renderuje efekty oraz stan z RemoteEvent "State".',
    ].join('\n'),
    remoteEvents: [
      { name: 'Fire', direction: 'client->server', payload: 'origin: Vector3, direction: Vector3' },
      { name: 'Reload', direction: 'client->server', payload: '(brak)' },
      { name: 'Hit', direction: 'server->client', payload: 'kind: "hit"|"headshot"|"miss"|"empty", damage: number' },
      { name: 'Shot', direction: 'server->client', payload: 'shooter: Player, from: Vector3, to: Vector3, headshot: boolean' },
      { name: 'State', direction: 'server->client', payload: '{health, maxHealth, ammo, magazine, reloading, kills, deaths} lub stan rundy' },
      { name: 'Feed', direction: 'server->client', payload: 'kind: string, a, b, color' },
      { name: 'Damage', direction: 'server->client', payload: 'amount: number, fromPosition: Vector3' },
    ],
    files: [
      { path: 'src/shared/Config.luau', kind: 'module', purpose: 'Balans broni, rundy, drużyn, areny, nazwy remotów', exports: ['Config'], requires: [], lines: 60 },
      { path: 'src/shared/WeaponUtil.luau', kind: 'module', purpose: 'Rozrzut i falloff obrażeń (matematyka wspólna)', exports: ['WeaponUtil'], requires: [], lines: 40 },
      { path: 'src/server/MapBuilder.luau', kind: 'module', purpose: 'Deterministyczna, lustrzana arena PvP', exports: ['MapBuilder'], requires: ['src/shared/Config.luau'], lines: 190 },
      { path: 'src/server/CombatService.luau', kind: 'module', purpose: 'Walidacja strzałów, obrażenia, kill feed', exports: ['CombatService'], requires: ['src/shared/Config.luau', 'src/shared/WeaponUtil.luau'], lines: 290 },
      { path: 'src/server/RoundService.server.luau', kind: 'server', purpose: 'Drużyny, runda, wynik, spawn (skrypt startowy)', exports: [], requires: ['src/shared/Config.luau', 'src/server/MapBuilder.luau', 'src/server/CombatService.luau'], lines: 240 },
      { path: 'src/client/WeaponController.client.luau', kind: 'client', purpose: 'Ogień, przeładowanie, rozrzut, odrzut, tracer', exports: [], requires: ['src/shared/Config.luau'], lines: 260 },
      { path: 'src/client/Hud.client.luau', kind: 'client', purpose: 'HP, amunicja, czas, wynik, kill feed, winieta', exports: [], requires: ['src/shared/Config.luau'], lines: 230 },
    ],
  },
  world: {
    lighting: {
      ClockTime: 22,
      Ambient: '#3B4266',
      OutdoorAmbient: '#4A5278',
      Brightness: 1.2,
      GlobalShadows: true,
      Technology: 'Future',
      FogEnd: 600,
      FogColor: '#0A0D1A',
    },
    world: {
      name: 'World',
      className: 'Folder',
      children: [
        {
          className: 'Folder', name: 'Arena',
          properties: {},
        },
        {
          className: 'SpawnLocation', name: 'CenterSpawn',
          properties: { Size: [10, 1, 10], Position: [0, 9.5, 0], Color: '#00E5A0', Material: 'Neon', Duration: 0, Anchored: true },
        },
        {
          className: 'Folder', name: 'Decor',
          properties: {},
          children: [
            {
              className: 'Part', name: 'CenterGlow',
              properties: { Size: [6, 26, 6], Position: [0, 21, 0], Color: '#7E57C2', Material: 'Neon', Transparency: 0.2, Anchored: true, CanCollide: false },
              children: [{ className: 'PointLight', name: 'Glow', properties: { Color: '#B39DFF', Brightness: 3.5, Range: 70 } }],
            },
            {
              className: 'Part', name: 'RedBeacon',
              properties: { Size: [2, 30, 2], Position: [-90, 17, -70], Color: '#FF5252', Material: 'Neon', Anchored: true, CanCollide: false },
            },
            {
              className: 'Part', name: 'BlueBeacon',
              properties: { Size: [2, 30, 2], Position: [90, 17, 70], Color: '#4FC3F7', Material: 'Neon', Anchored: true, CanCollide: false },
            },
          ],
        },
      ],
    },
  },
  files: [
    { path: 'src/shared/Config.luau', content: config },
    { path: 'src/shared/WeaponUtil.luau', content: weaponUtil },
    { path: 'src/server/MapBuilder.luau', content: mapBuilder },
    { path: 'src/server/CombatService.luau', content: combatService },
    { path: 'src/server/RoundService.server.luau', content: roundService },
    { path: 'src/client/WeaponController.client.luau', content: weaponController },
    { path: 'src/client/Hud.client.luau', content: hudArena },
  ],
};
