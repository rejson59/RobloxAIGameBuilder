/**
 * Demo project #2 – "Neon Rush Tower Defense" (offline).
 * Shows a complete server-authoritative economy loop: waves, towers,
 * placement validation and remote-driven UI.
 */

const config = `--[[
	Config – balans wieży obronnej. Wszystkie liczby w jednym miejscu,
	żeby dało się zmieniać grę bez dotykania logiki.
]]
local Config = {}

Config.StartMoney = 250
Config.BaseHealth = 100
Config.MaxWaves = 20
Config.WaveBreak = 6          -- sekundy przerwy między falami
Config.SellRefund = 0.6       -- ile procent ceny wraca przy sprzedaży

-- Ścieżka wroga: kolejne punkty, po których idą wrogowie (studsy).
Config.Waypoints = {
	Vector3.new(-120, 1.5, -60),
	Vector3.new(-40, 1.5, -60),
	Vector3.new(-40, 1.5, -10),
	Vector3.new(20, 1.5, -10),
	Vector3.new(20, 1.5, 50),
	Vector3.new(90, 1.5, 50),
	Vector3.new(90, 1.5, 110),
	Vector3.new(130, 1.5, 110),
}

-- Miejsca pod wieże. Serwer tworzy na nich pady, klient pokazuje podgląd.
Config.Plots = {
	Vector3.new(-70, 0.6, -35), Vector3.new(-70, 0.6, -85),
	Vector3.new(-10, 0.6, -35), Vector3.new(-10, 0.6, 15),
	Vector3.new(45, 0.6, 15), Vector3.new(45, 0.6, 75),
	Vector3.new(115, 0.6, 75), Vector3.new(115, 0.6, 140),
}

-- Trzy typy wież: tania szybka, droga silna, spowalniająca.
Config.Towers = {
	{
		id = "blaster",
		name = "Blaster",
		cost = 100,
		damage = 12,
		range = 34,
		fireRate = 0.55,      -- sekundy między strzałami
		upgradeCost = 120,
		upgradeScale = 1.45,  -- obrażenia * 1.45 na poziom
		color = "#4FC3F7",
	},
	{
		id = "cannon",
		name = "Cannon",
		cost = 200,
		damage = 42,
		range = 46,
		fireRate = 1.4,
		upgradeCost = 220,
		upgradeScale = 1.5,
		color = "#FF7043",
	},
	{
		id = "frost",
		name = "Frost",
		cost = 150,
		damage = 6,
		range = 30,
		fireRate = 0.9,
		upgradeCost = 160,
		upgradeScale = 1.35,
		slow = 0.45,          -- mnożnik prędkości wroga po trafieniu
		color = "#B3E5FC",
	},
}
Config.MaxTowerLevel = 4

-- Fale generowane wzorem: liczba wrogów i HP rosną, nagroda też.
function Config.waveStats(wave)
	return {
		count = 4 + wave * 2,
		health = 40 + (wave - 1) * 28,
		speed = 7 + wave * 0.35,
		reward = 6 + math.floor(wave * 1.5),
		interval = math.max(0.35, 1.0 - wave * 0.03),
		damageToBase = 10,
	}
end

Config.Remotes = {
	PlaceTower = "PlaceTower",    -- klient -> serwer
	UpgradeTower = "UpgradeTower",
	SellTower = "SellTower",
	State = "State",              -- serwer -> klient (pełny stan ekonomii)
	Feed = "Feed",                -- serwer -> klient (komunikaty)
}

Config.Colors = {
	Road = "#2B2F45",
	Plot = "#3D4460",
	PlotOk = "#00E5A0",
	PlotBad = "#FF5252",
	Base = "#7E57C2",
	Lobby = "#1B1F33",
}

return Config
`;

const pathService = `--[[
	PathService – czysta matematyka ścieżki. Klient i serwer liczą to samo,
	wiêc podgląd wieży pokazuje dokładnie ten zasięg, który widzi serwer.
]]
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))

local PathService = {}
PathService.Waypoints = Config.Waypoints
PathService.Segments = {}

local totalLength = 0
for index = 1, #Config.Waypoints - 1 do
	local from = Config.Waypoints[index]
	local to = Config.Waypoints[index + 1]
	local length = (to - from).Magnitude
	table.insert(PathService.Segments, { from = from, to = to, length = length, startDistance = totalLength })
	totalLength += length
end
PathService.TotalLength = totalLength

--- Zwraca pozycję i kierunek na ścieżce dla podanej odległości od startu.
function PathService.PositionAt(distance)
	local clamped = math.clamp(distance, 0, totalLength)
	for _, segment in ipairs(PathService.Segments) do
		if clamped <= segment.startDistance + segment.length then
			local alpha = (clamped - segment.startDistance) / segment.length
			local position = segment.from:Lerp(segment.to, alpha)
			local direction = (segment.to - segment.from).Unit
			return position, direction
		end
	end
	local last = PathService.Segments[#PathService.Segments]
	return last.to, (last.to - last.from).Unit
end

function PathService.DistanceBetween(a, b)
	return (a - b).Magnitude
end

return PathService
`;

const enemyService = `--[[
	EnemyService – tworzy wrogów i przesuwa ich po ścieżce w jednej pętli
	Heartbeat (jedno miejsce, zero wycieków pamięci: każdy wróg jest usuwany).
	Wrogowie to zwykłe Part-y, więc nie obciążają fizyki jak Humanoidy.
]]
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local PathService = require(Shared:WaitForChild("PathService"))

local EnemyService = {}

local folder = Instance.new("Folder")
folder.Name = "Enemies"
folder.Parent = workspace

local enemies = {}          -- [BasePart] = dane wroga
local onKilled = nil        -- callback ustawiany przez RoundService
local onReachedBase = nil

local TIER_COLORS = { "#FF5252", "#FFB74D", "#9575CD", "#4DB6AC", "#F06292" }
local WALKER_TEMPLATE = Instance.new("Part")

function EnemyService.init(callbacks)
	onKilled = callbacks.onKilled
	onReachedBase = callbacks.onReachedBase

	RunService.Heartbeat:Connect(function(dt)
		for part, data in pairs(enemies) do
			if not part.Parent or not data.alive then
				enemies[part] = nil
				continue
			end

			data.slowTimer = math.max(0, data.slowTimer - dt)
			local speed = data.speed * (if data.slowTimer > 0 then data.slowMultiplier else 1)
			data.distance += speed * dt

			if data.distance >= PathService.TotalLength then
				data.alive = false
				enemies[part] = nil
				part:Destroy()
				if onReachedBase then
					onReachedBase(data)
				end
				continue
			end

			local position, direction = PathService.PositionAt(data.distance)
			part.CFrame = CFrame.lookAt(position + Vector3.new(0, data.height / 2, 0), position + direction + Vector3.new(0, data.height / 2, 0))
			if data.healthBar then
				data.healthBar.Size = UDim2.fromScale(math.clamp(data.health / data.maxHealth, 0, 1), 1)
			end
		end
	end)
end

function EnemyService.spawn(stats, tier)
	local height = math.clamp(3 + tier * 0.2, 3, 6)
	local part = WALKER_TEMPLATE:Clone()
	part.Name = "Enemy"
	part.Size = Vector3.new(height * 0.9, height, height * 0.9)
	part.Color = Color3.fromHex(TIER_COLORS[math.clamp(tier, 1, #TIER_COLORS)])
	part.Material = Enum.Material.Neon
	part.Anchored = true
	part.CanCollide = false
	part.CanTouch = false
	part.CFrame = CFrame.new(PathService.Waypoints[1])

	-- Pasek życia nad wrogiem (czysto wizualny, aktualizowany w Heartbeat).
	local billboard = Instance.new("BillboardGui")
	billboard.Size = UDim2.fromOffset(60, 8)
	billboard.StudsOffsetWorldSpace = Vector3.new(0, height * 0.9, 0)
	billboard.AlwaysOnTop = true
	billboard.Parent = part

	local back = Instance.new("Frame")
	back.Size = UDim2.fromScale(1, 1)
	back.BackgroundColor3 = Color3.fromHex("#101427")
	back.BorderSizePixel = 0
	back.Parent = billboard

	local bar = Instance.new("Frame")
	bar.Size = UDim2.fromScale(1, 1)
	bar.BackgroundColor3 = Color3.fromHex("#00E5A0")
	bar.BorderSizePixel = 0
	bar.Parent = back

	part.Parent = folder

	enemies[part] = {
		distance = 0,
		health = stats.health,
		maxHealth = stats.health,
		speed = stats.speed,
		reward = stats.reward,
		height = height,
		healthBar = bar,
		slowTimer = 0,
		slowMultiplier = 1,
		alive = true,
		damageToBase = stats.damageToBase,
	}
	return part
end

function EnemyService.applyDamage(part, amount, slowMultiplier)
	local data = enemies[part]
	if not data or not data.alive then
		return false
	end
	if slowMultiplier then
		data.slowTimer = 2
		data.slowMultiplier = math.min(data.slowMultiplier == 1 and slowMultiplier or data.slowMultiplier, slowMultiplier)
	end
	data.health -= amount
	if data.health <= 0 then
		data.alive = false
		local reward = data.reward
		enemies[part] = nil
		part:Destroy()
		if onKilled then
			onKilled(reward, part.Position)
		end
		return true
	end
	return false
end

function EnemyService.getInRange(position, range)
	local found = {}
	for part, data in pairs(enemies) do
		if data.alive and part.Parent and (part.Position - position).Magnitude <= range then
			table.insert(found, { part = part, data = data })
		end
	end
	-- Najpierw wróg najbliżej bazy (największy dystans) – tak gracze oczekują.
	table.sort(found, function(a, b)
		return a.data.distance > b.data.distance
	end)
	return found
end

function EnemyService.aliveCount()
	local count = 0
	for _ in pairs(enemies) do
		count += 1
	end
	return count
end

function EnemyService.clearAll()
	for part in pairs(enemies) do
		part:Destroy()
	end
	enemies = {}
end

return EnemyService
`;

const towerService = `--[[
	TowerService – wieże: budowa (z walidacją), celowanie, strzały, ulepszenia,
	sprzedaż i koszt. Serwer jest jedynym miejscem, które tworzy wieże.
]]
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))

local TowerService = {}
TowerService.Towers = {}        -- [Model] = dane wieży
local byPlot = {}               -- [numer działki] = Model

local ENEMY_SERVICE = nil
function TowerService.init(enemyService)
	ENEMY_SERVICE = enemyService
end

function TowerService.getDefinition(towerId)
	for _, definition in ipairs(Config.Towers) do
		if definition.id == towerId then
			return definition
		end
	end
	return nil
end

local function plotPosition(index)
	return Config.Plots[index]
end

local function makeBeam(fromPosition, toPosition, color)
	local distance = (toPosition - fromPosition).Magnitude
	local beam = Instance.new("Part")
	beam.Name = "Beam"
	beam.Anchored = true
	beam.CanCollide = false
	beam.CanQuery = false
	beam.CanTouch = false
	beam.Material = Enum.Material.Neon
	beam.Color = color
	beam.Size = Vector3.new(0.4, 0.4, distance)
	beam.CFrame = CFrame.lookAt(fromPosition, toPosition) * CFrame.new(0, 0, -distance / 2)
	beam.Parent = workspace
	task.delay(0.08, function()
		beam:Destroy()
	end)
	return beam
end

function TowerService.build(towerId, plotIndex)
	local definition = TowerService.getDefinition(towerId)
	if not definition then
		return nil, "Nieznany typ wieży."
	end
	if type(plotIndex) ~= "number" or plotIndex < 1 or plotIndex > #Config.Plots then
		return nil, "Nieprawidłowa działka."
	end
	if byPlot[plotIndex] then
		return nil, "Ta działka jest już zajęta."
	end

	local basePosition = plotPosition(plotIndex)
	local model = Instance.new("Model")
	model.Name = "Tower_" .. definition.id

	local base = Instance.new("Part")
	base.Name = "Base"
	base.Shape = Enum.PartType.Cylinder
	base.Size = Vector3.new(1.2, 6, 6)
	base.Orientation = Vector3.new(0, 0, 90)
	base.Position = basePosition + Vector3.new(0, 0.9, 0)
	base.Anchored = true
	base.Color = Color3.fromHex(definition.color)
	base.Material = Enum.Material.SmoothPlastic
	base.Parent = model

	local turret = Instance.new("Part")
	turret.Name = "Turret"
	turret.Shape = Enum.PartType.Ball
	turret.Size = Vector3.new(2.6, 2.6, 2.6)
	turret.Position = basePosition + Vector3.new(0, 2.4, 0)
	turret.Anchored = true
	turret.Color = Color3.fromHex(definition.color)
	turret.Material = Enum.Material.Neon
	turret.Parent = model

	local barrel = Instance.new("Part")
	barrel.Name = "Barrel"
	barrel.Size = Vector3.new(0.6, 0.6, 3)
	barrel.Position = basePosition + Vector3.new(0, 2.4, 1.6)
	barrel.Anchored = true
	barrel.CanCollide = false
	barrel.Color = Color3.fromHex("#E0E6FF")
	barrel.Material = Enum.Material.Metal
	barrel.Parent = model

	local light = Instance.new("PointLight")
	light.Color = Color3.fromHex(definition.color)
	light.Brightness = 1.6
	light.Range = 14
	light.Parent = turret

	model.PrimaryPart = turret
	model:SetAttribute("TowerId", definition.id)
	model:SetAttribute("Level", 1)
	model:SetAttribute("PlotIndex", plotIndex)
	model.Parent = workspace

	TowerService.Towers[model] = {
		definition = definition,
		level = 1,
		damage = definition.damage,
		range = definition.range,
		fireRate = definition.fireRate,
		cooldown = 0,
		plotIndex = plotIndex,
		plotPosition = basePosition,
		parts = { base = base, turret = turret, barrel = barrel },
	}
	byPlot[plotIndex] = model
	return model
end

function TowerService.upgrade(model)
	local data = TowerService.Towers[model]
	if not data then
		return false, "Nie ma takiej wieży."
	end
	if data.level >= Config.MaxTowerLevel then
		return false, "Maksymalny poziom."
	end
	local cost = math.floor(data.definition.upgradeCost * data.level ^ 1.25)
	data.level += 1
	data.damage *= data.definition.upgradeScale
	data.range += 3
	model:SetAttribute("Level", data.level)
	data.parts.turret.Size += Vector3.new(0.5, 0.5, 0.5)
	local pulse = TweenService:Create(data.parts.turret, TweenInfo.new(0.35), { Transparency = 0.4 })
	pulse:Play()
	pulse.Completed:Connect(function()
		data.parts.turret.Transparency = 0
	end)
	return true, cost
end

function TowerService.upgradeCost(model)
	local data = TowerService.Towers[model]
	if not data then
		return math.huge
	end
	return math.floor(data.definition.upgradeCost * data.level ^ 1.25)
end

function TowerService.sell(model)
	local data = TowerService.Towers[model]
	if not data then
		return 0
	end
	local refund = 0
	local definition = data.definition
	refund = definition.cost * Config.SellRefund
	for level = 1, data.level - 1 do
		refund += math.floor(definition.upgradeCost * level ^ 1.25) * Config.SellRefund
	end
	byPlot[data.plotIndex] = nil
	TowerService.Towers[model] = nil
	model:Destroy()
	return math.floor(refund)
end

function TowerService.ownerOfPlot(plotIndex)
	return byPlot[plotIndex]
end

function TowerService.update(dt)
	for model, data in pairs(TowerService.Towers) do
		if not model.Parent then
			TowerService.Towers[model] = nil
			continue
		end
		data.cooldown -= dt
		if data.cooldown > 0 then
			continue
		end

		local targets = ENEMY_SERVICE.getInRange(data.plotPosition, data.range)
		local target = targets[1]
		if not target then
			continue
		end

		data.cooldown = data.fireRate
		local muzzle = data.parts.turret.Position + (target.part.Position - data.parts.turret.Position).Unit * 2
		data.parts.turret.CFrame = CFrame.lookAt(data.parts.turret.Position, target.part.Position)
		data.parts.barrel.CFrame = data.parts.turret.CFrame * CFrame.new(0, 0, -1.8)

		local slow = data.definition.slow
		local killed = ENEMY_SERVICE.applyDamage(target.part, data.damage, slow)
		makeBeam(muzzle, target.part.Position, Color3.fromHex(data.definition.color))
		if killed then
			data.parts.turret.Size = data.parts.turret.Size + Vector3.new(0.06, 0.06, 0.06)
		end
	end
end

return TowerService
`;

const roundService = `--[[
	RoundService – skrypt startowy serwera: tworzy odległości, buduje ścieżkę
	i działki, steruje falami, ekonomią i warunkiem przegranej.
	Wszystkie decyzje (kto może budować, ile ma pieniędzy) podejmuje serwer.
]]
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local PathService = require(Shared:WaitForChild("PathService"))

local EnemyService = require(script.Parent:WaitForChild("EnemyService"))
local TowerService = require(script.Parent:WaitForChild("TowerService"))

-- 1. RemoteEventy ---------------------------------------------------
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

-- 2. Świat: droga, działki, baza ------------------------------------
local world = Instance.new("Folder")
world.Name = "TDWorld"
world.Parent = workspace

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

-- Droga zbudowana z odcinków między waypointami.
for index = 1, #PathService.Segments do
	local segment = PathService.Segments[index]
	newPart({
		Name = "Road" .. index,
		Size = Vector3.new(14, 1, segment.length + 14),
		CFrame = CFrame.lookAt(segment.from:Lerp(segment.to, 0.5), segment.to) * CFrame.new(0, -0.5, 0),
		Color = Color3.fromHex(Config.Colors.Road),
		Material = Enum.Material.Slate,
		Parent = world,
	})
end

-- Działki pod wieże (klient je taguje i pokazuje podgląd).
local plotsFolder = Instance.new("Folder")
plotsFolder.Name = "Plots"
plotsFolder.Parent = world

local plotParts = {}
for index, position in ipairs(Config.Plots) do
	local pad = newPart({
		Name = "Plot" .. index,
		Size = Vector3.new(8, 1.2, 8),
		Position = position,
		Color = Color3.fromHex(Config.Colors.Plot),
		Material = Enum.Material.SmoothPlastic,
		Parent = plotsFolder,
	})
	pad:SetAttribute("PlotIndex", index)
	table.insert(plotParts, pad)
end

-- Baza na końcu ścieżki – tu wchodzą wrogowie, którzy przeszli.
local lastPoint = PathService.Waypoints[#PathService.Waypoints]
local basePart = newPart({
	Name = "Base",
	Size = Vector3.new(18, 10, 18),
	Position = lastPoint + Vector3.new(20, 5, 0),
	Color = Color3.fromHex(Config.Colors.Base),
	Material = Enum.Material.Neon,
	Transparency = 0.15,
	Parent = world,
})

-- 3. Stan gry -------------------------------------------------------
local state = {
	money = Config.StartMoney,
	wave = 0,
	baseHealth = Config.BaseHealth,
	active = false,
	gameOver = false,
	enemiesAlive = 0,
	nextWaveIn = Config.WaveBreak,
}

local function pushState()
	state.enemiesAlive = EnemyService.aliveCount()
	remotesTable.State:FireAllClients(state)
end

local function feed(message, color)
	remotesTable.Feed:FireAllClients(message, color)
end

EnemyService.init({
	onKilled = function(reward, position)
		state.money += reward
		local pop = newPart({
			Name = "CoinPop",
			Size = Vector3.new(1.5, 1.5, 1.5),
			Position = position + Vector3.new(0, 1, 0),
			Color = Color3.fromHex("#FFC400"),
			Material = Enum.Material.Neon,
			CanCollide = false,
			Parent = world,
		})
		task.delay(0.6, function()
			pop:Destroy()
		end)
		pushState()
	end,
	onReachedBase = function(data)
		state.baseHealth = math.max(0, state.baseHealth - data.damageToBase)
		feed("Wróg dotarł do bazy! -" .. data.damageToBase .. " HP", Color3.fromHex("#FF5252"))
		if state.baseHealth <= 0 and not state.gameOver then
			state.gameOver = true
			state.active = false
			feed("BAZA ZNISZCZONA. Restart za 12 sekund...", Color3.fromHex("#FF5252"))
			task.delay(12, function()
				state.money = Config.StartMoney
				state.wave = 0
				state.baseHealth = Config.BaseHealth
				state.gameOver = false
				for _, pad in ipairs(plotParts) do
					pad.Color = Color3.fromHex(Config.Colors.Plot)
				end
				for _, tower in pairs(TowerService.Towers) do
					tower:Destroy()
				end
				TowerService.Towers = {}
			end)
		end
		pushState()
	end,
})

TowerService.init(EnemyService)

-- 4. Obsługa zdarzeń klienta ---------------------------------------
remotesTable.PlaceTower.OnServerEvent:Connect(function(player, towerId, plotIndex)
	if type(towerId) ~= "string" or type(plotIndex) ~= "number" then
		return
	end
	if state.gameOver then
		return
	end
	local definition = TowerService.getDefinition(towerId)
	if not definition then
		return
	end
	if state.money < definition.cost then
		feed("Za mało monet (" .. definition.cost .. ")", Color3.fromHex("#FF5252"))
		return
	end
	local model, err = TowerService.build(towerId, plotIndex)
	if not model then
		feed(err or "Nie udało się zbudować wieży.", Color3.fromHex("#FF5252"))
		return
	end
	state.money -= definition.cost
	model:SetAttribute("OwnerUserId", player.UserId)
	local pad = plotParts[plotIndex]
	if pad then
		pad.Color = Color3.fromHex(definition.color)
	end
	feed(player.DisplayName .. " zbudował " .. definition.name, Color3.fromHex(definition.color))
	pushState()
end)

remotesTable.UpgradeTower.OnServerEvent:Connect(function(player, plotIndex)
	local model = TowerService.ownerOfPlot(plotIndex)
	if not model then
		return
	end
	local cost = TowerService.upgradeCost(model)
	if state.money < cost then
		feed("Ulepszenie kosztuje " .. cost, Color3.fromHex("#FF5252"))
		return
	end
	local ok = TowerService.upgrade(model)
	if ok then
		state.money -= cost
		feed("Wieża na poziomie " .. model:GetAttribute("Level"), Color3.fromHex("#00E5A0"))
		pushState()
	end
end)

remotesTable.SellTower.OnServerEvent:Connect(function(player, plotIndex)
	local model = TowerService.ownerOfPlot(plotIndex)
	if not model then
		return
	end
	local refund = TowerService.sell(model)
	state.money += refund
	local pad = plotParts[plotIndex]
	if pad then
		pad.Color = Color3.fromHex(Config.Colors.Plot)
	end
	feed("Sprzedano wieżę (+" .. refund .. ")", Color3.fromHex("#FFC400"))
	pushState()
end)

-- 5. Główna pętla fal ----------------------------------------------
task.spawn(function()
	while true do
		if not state.gameOver then
			state.wave += 1
			local stats = Config.waveStats(state.wave)
			state.active = true
			feed("FALA " .. state.wave .. " – " .. stats.count .. " wrogów", Color3.fromHex("#4FC3F7"))
			pushState()

			for index = 1, stats.count do
				local tier = math.clamp(math.ceil(state.wave / 4), 1, 5)
				EnemyService.spawn(stats, tier)
				pushState()
				task.wait(stats.interval)
			end

			-- Czekamy na wybicie wszystkich wrogów tej fali.
			while EnemyService.aliveCount() > 0 and not state.gameOver do
				task.wait(0.4)
			end

			if not state.gameOver then
				local bonus = 40 + state.wave * 12
				state.money += bonus
				feed("Fala " .. state.wave .. " oczyszczona! +" .. bonus .. " monet", Color3.fromHex("#FFC400"))
				state.active = false
				state.nextWaveIn = Config.WaveBreak
				pushState()
			end
		end

		for remaining = Config.WaveBreak, 1, -1 do
			state.nextWaveIn = remaining
			pushState()
			task.wait(1)
		end
	end
end)

-- 6. Pętla wież + synchronizacja stanu -----------------------------
RunService.Heartbeat:Connect(function(dt)
	TowerService.update(dt)
end)

task.spawn(function()
	while true do
		pushState()
		task.wait(0.5)
	end
end)

print("[RoundService] Neon Rush TD wystartował – " .. #Config.Plots .. " działek, " .. Config.MaxWaves .. " fal.")
`;

const buildController = `--[[
	BuildController – klient: wybór wieży, podgląd zasięgu, budowa, ulepszanie
	i sprzedaż. Klient tylko prosi serwer; serwer waliduje pieniądze i miejsce.
]]
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UserInputService = game:GetService("UserInputService")
local RunService = game:GetService("RunService")
local CollectionService = game:GetService("CollectionService")

local player = Players.LocalPlayer
local camera = workspace.CurrentCamera
local mouse = player:GetMouse()

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))

local remotes = ReplicatedStorage:WaitForChild("Remotes")
local placeRemote = remotes:WaitForChild(Config.Remotes.PlaceTower)
local upgradeRemote = remotes:WaitForChild(Config.Remotes.UpgradeTower)
local sellRemote = remotes:WaitForChild(Config.Remotes.SellTower)

local selectedIndex = 1
local state = { money = 0 }

-- Znaczniki działek: tagujemy je po stronie klienta, bo tagi nie są replikowane
-- z serwera w sposób, na którym chcemy polegać.
task.spawn(function()
	while true do
		for _, part in ipairs(workspace:GetDescendants()) do
			if part:IsA("BasePart") and part:GetAttribute("PlotIndex") then
				CollectionService:AddTag(part, "TDPlot")
			end
		end
		task.wait(4)
	end
end)

-- Podglądowy "duch" wieży + okrąg zasięgu.
local ghost = Instance.new("Part")
ghost.Name = "Ghost"
ghost.Shape = Enum.PartType.Ball
ghost.Size = Vector3.new(3, 3, 3)
ghost.Anchored = true
ghost.CanCollide = false
ghost.CanQuery = false
ghost.CanTouch = false
ghost.Transparency = 0.55
ghost.Material = Enum.Material.Neon
ghost.Parent = workspace

local rangeRing = Instance.new("Part")
rangeRing.Name = "RangeRing"
rangeRing.Shape = Enum.PartType.Cylinder
rangeRing.Size = Vector3.new(0.1, 1, 1)
rangeRing.Orientation = Vector3.new(0, 0, 90)
rangeRing.Anchored = true
rangeRing.CanCollide = false
rangeRing.CanQuery = false
rangeRing.CanTouch = false
rangeRing.Transparency = 0.85
rangeRing.Material = Enum.Material.Neon
rangeRing.Color = Color3.fromHex("#00E5A0")
rangeRing.Parent = workspace

local function towerDefinition()
	return Config.Towers[selectedIndex]
end

local function plotUnderMouse()
	local result = workspace:Raycast(mouse.UnitRay.Origin, mouse.UnitRay.Direction * 500, { ghost, rangeRing })
	if not result then
		return nil
	end
	local instance = result.Instance
	if instance and CollectionService:HasTag(instance, "TDPlot") then
		return instance
	end
	return nil
end

local function updateGhost()
	local definition = towerDefinition()
	local plot = plotUnderMouse()
	local affordable = state.money >= definition.cost

	if not plot then
		ghost.Transparency = 1
		rangeRing.Transparency = 1
		return
	end

	local position = plot.Position
	ghost.Position = position + Vector3.new(0, 2.4, 0)
	ghost.Color = Color3.fromHex(if affordable then definition.color else Config.Colors.PlotBad)
	ghost.Transparency = 0.5

	local diameter = definition.range * 2
	rangeRing.Size = Vector3.new(0.1, diameter, diameter)
	rangeRing.Position = position + Vector3.new(0, 0.4, 0)
	rangeRing.Color = Color3.fromHex(if affordable then definition.color else Config.Colors.PlotBad)
	rangeRing.Transparency = 0.85
end

RunService.RenderStepped:Connect(updateGhost)

UserInputService.InputBegan:Connect(function(input, gameProcessed)
	if gameProcessed then
		return
	end
	if input.UserInputType == Enum.UserInputType.MouseButton1 then
		local plot = plotUnderMouse()
		if plot then
			placeRemote:FireServer(towerDefinition().id, plot:GetAttribute("PlotIndex"))
		end
	elseif input.KeyCode == Enum.KeyCode.E then
		local plot = plotUnderMouse()
		if plot then
			upgradeRemote:FireServer(plot:GetAttribute("PlotIndex"))
		end
	elseif input.KeyCode == Enum.KeyCode.X then
		local plot = plotUnderMouse()
		if plot then
			sellRemote:FireServer(plot:GetAttribute("PlotIndex"))
		end
	end
end)

-- Cyfry 1..3 wybierają typ wieży; HUD nasłuchuje tego samego zdarzenia.
UserInputService.InputBegan:Connect(function(input, gameProcessed)
	if gameProcessed then
		return
	end
	local number = tonumber(input.KeyCode.Name:match("^%d$") or "")
	if number and number >= 1 and number <= #Config.Towers then
		selectedIndex = number
		player:SetAttribute("SelectedTower", selectedIndex)
	end
end)

remotes:WaitForChild(Config.Remotes.State).OnClientEvent:Connect(function(newState)
	state = newState
end)

-- Wybrany typ wieży udostępniamy HUD-owi przez atrybut gracza.
player:SetAttribute("SelectedTower", selectedIndex)
`;

const hudTd = `--[[
	HUD (Tower Defense) – monety, fala, HP bazy, lista wież i komunikaty.
	Całe UI w kodzie: brak plików graficznych, brak assetów do moderacji.
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

local gui = Instance.new("ScreenGui")
gui.Name = "TowerDefenseHUD"
gui.IgnoreGuiInset = true
gui.ResetOnSpawn = false
gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
gui.Parent = playerGui

local function panel(name, anchor, position, size)
	local frame = Instance.new("Frame")
	frame.Name = name
	frame.AnchorPoint = anchor
	frame.Position = position
	frame.Size = size
	frame.BackgroundColor3 = Color3.fromHex("#111528")
	frame.BackgroundTransparency = 0.15
	frame.BorderSizePixel = 0
	frame.Parent = gui

	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 12)
	corner.Parent = frame

	local stroke = Instance.new("UIStroke")
	stroke.Color = Color3.fromHex("#7E57C2")
	stroke.Transparency = 0.6
	stroke.Parent = frame

	return frame
end

local function label(parent, text, size, color, position)
	local textLabel = Instance.new("TextLabel")
	textLabel.BackgroundTransparency = 1
	textLabel.Size = size or UDim2.fromScale(1, 1)
	textLabel.Position = position or UDim2.fromScale(0, 0)
	textLabel.Font = Enum.Font.GothamBold
	textLabel.TextScaled = true
	textLabel.Text = text
	textLabel.TextColor3 = color or Color3.fromHex("#E0E6FF")
	textLabel.Parent = parent

	local constrain = Instance.new("UITextSizeConstraint")
	constrain.MaxTextSize = 28
	constrain.Parent = textLabel

	return textLabel
end

-- Panel statystyk (lewy górny róg)
local statsPanel = panel("Stats", Vector2.new(0, 0), UDim2.new(0, 18, 0, 18), UDim2.fromOffset(240, 118))
local moneyLabel = label(statsPanel, "0 monet", UDim2.new(1, -20, 0, 30), Color3.fromHex("#FFC400"), UDim2.fromOffset(10, 8))
local waveLabel = label(statsPanel, "FALA 0", UDim2.new(1, -20, 0, 24), Color3.fromHex("#4FC3F7"), UDim2.fromOffset(10, 44))
local baseLabel = label(statsPanel, "BAZA 100/100", UDim2.new(1, -20, 0, 22), Color3.fromHex("#E0E6FF"), UDim2.fromOffset(10, 72))

local baseBarBack = Instance.new("Frame")
baseBarBack.Size = UDim2.new(1, -20, 0, 10)
baseBarBack.Position = UDim2.fromOffset(10, 98)
baseBarBack.BackgroundColor3 = Color3.fromHex("#1E2340")
baseBarBack.BorderSizePixel = 0
baseBarBack.Parent = statsPanel
Instance.new("UICorner", baseBarBack).CornerRadius = UDim.new(0, 5)

local baseBar = Instance.new("Frame")
baseBar.Size = UDim2.fromScale(1, 1)
baseBar.BackgroundColor3 = Color3.fromHex("#00E5A0")
baseBar.BorderSizePixel = 0
baseBar.Parent = baseBarBack
Instance.new("UICorner", baseBar).CornerRadius = UDim.new(0, 5)

-- Panel wież (prawy dolny róg)
local towerPanel = panel("Towers", Vector2.new(1, 1), UDim2.new(1, -18, 1, -18), UDim2.fromOffset(300, 160))
local towerButtons = {}

for index, definition in ipairs(Config.Towers) do
	local button = Instance.new("TextButton")
	button.Name = definition.id
	button.Size = UDim2.new(1, -20, 0, 40)
	button.Position = UDim2.fromOffset(10, 10 + (index - 1) * 46)
	button.BackgroundColor3 = Color3.fromHex("#1A1F38")
	button.BorderSizePixel = 0
	button.Font = Enum.Font.GothamBold
	button.TextScaled = true
	button.TextColor3 = Color3.fromHex(definition.color)
	button.Text = index .. "  " .. definition.name .. "  -  " .. definition.cost .. " monet"
	button.TextXAlignment = Enum.TextXAlignment.Left
	button.Parent = towerPanel
	Instance.new("UICorner", button).CornerRadius = UDim.new(0, 8)

	local stroke = Instance.new("UIStroke")
	stroke.Color = Color3.fromHex(definition.color)
	stroke.Transparency = 0.7
	stroke.Parent = button

	button.MouseButton1Click:Connect(function()
		player:SetAttribute("SelectedTower", index)
	end)

	table.insert(towerButtons, button)
end

-- Komunikaty / ostrzeżenia
local feedFrame = panel("Feed", Vector2.new(0.5, 1), UDim2.new(0.5, 0, 1, -18), UDim2.fromOffset(520, 42))
feedFrame.BackgroundTransparency = 0.3
local feedLabel = label(feedFrame, "Kliknij działkę, żeby postawić wieżę.", UDim2.fromScale(1, 1), Color3.fromHex("#E0E6FF"))

local function showFeed(message, color)
	feedLabel.Text = message
	feedLabel.TextColor3 = color or Color3.fromHex("#E0E6FF")
	feedFrame.BackgroundTransparency = 0.05
	local tween = TweenService:Create(feedFrame, TweenInfo.new(0.6), { BackgroundTransparency = 0.45 })
	tween:Play()
end

-- Nakładka końca gry / stanu fali
local banner = panel("Banner", Vector2.new(0.5, 0), UDim2.new(0.5, 0, 0, 96), UDim2.fromOffset(360, 56))
banner.BackgroundTransparency = 1
local bannerLabel = label(banner, "", UDim2.fromScale(1, 1), Color3.fromHex("#4FC3F7"))

local currentState = { baseHealth = Config.BaseHealth, money = 0, wave = 0, active = false, nextWaveIn = Config.WaveBreak, gameOver = false }

local function refresh()
	moneyLabel.Text = currentState.money .. " monet"
	moneyLabel.TextColor3 = Color3.fromHex(if currentState.money >= 200 then "#FFC400" else "#FF7043")
	waveLabel.Text = "FALA " .. currentState.wave .. "/" .. Config.MaxWaves
	baseLabel.Text = "BAZA " .. currentState.baseHealth .. "/" .. Config.BaseHealth
	baseBar.Size = UDim2.fromScale(math.clamp(currentState.baseHealth / Config.BaseHealth, 0, 1), 1)
	baseBar.BackgroundColor3 = Color3.fromHex(if currentState.baseHealth > 50 then "#00E5A0" elseif currentState.baseHealth > 20 then "#FFC400" else "#FF5252")

	if currentState.gameOver then
		bannerLabel.Text = "BAZA ZNISZCZONA"
		bannerLabel.TextColor3 = Color3.fromHex("#FF5252")
		banner.BackgroundTransparency = 0.15
	elseif not currentState.active then
		bannerLabel.Text = "Następna fala za " .. currentState.nextWaveIn .. " s"
		bannerLabel.TextColor3 = Color3.fromHex("#4FC3F7")
		banner.BackgroundTransparency = 0.35
	else
		bannerLabel.Text = "Wrogowie: " .. currentState.enemiesAlive
		bannerLabel.TextColor3 = Color3.fromHex("#E0E6FF")
		banner.BackgroundTransparency = 0.55
	end

	local selected = player:GetAttribute("SelectedTower") or 1
	for index, button in ipairs(towerButtons) do
		local definition = Config.Towers[index]
		button.BackgroundColor3 = Color3.fromHex(if index == selected then "#232B4A" else "#1A1F38")
		button.TextColor3 = Color3.fromHex(if currentState.money >= definition.cost then definition.color else "#6B7290")
	end
end

stateRemote.OnClientEvent:Connect(function(newState)
	currentState = newState
	refresh()
end)

feedRemote.OnClientEvent:Connect(function(message, color)
	showFeed(message, color)
end)

player:GetAttributeChangedSignal("SelectedTower"):Connect(refresh)

refresh()
`;

export default {
  id: 'td',
  aliases: ['td', 'tower', 'tower-defense', 'obrona', 'wieza', '2'],
  genre: 'Tower Defense',
  name: 'Neon Rush Tower Defense',
  tagline: 'Postaw wieże, przetrwaj 20 fal i nie pozwól zniszczyć bazy.',
  summary:
    'Klasyczny tower defense w wersji neonowej: 8 działek, 3 typy wież (Blaster, Cannon, Frost), ' +
    '20 fal rosnących w siłę i ekonomia, w której każda moneta ma znaczenie.',
  design: {
    name: 'Neon Rush Tower Defense',
    tagline: 'Postaw wieże, przetrwaj 20 fal i nie pozwól zniszczyć bazy.',
    genre: 'Tower Defense',
    summary:
      'Obrona bazy przed falami neonowych wrogów. Gracz buduje wieże na 8 działkach wzdłuż ścieżki, ' +
      'ulepsza je do 4 poziomu i balansuje między obrażeniami, zasięgiem i spowolnieniem.',
    coreLoop: '1. Analiza ścieżki i ustawienia działek. 2. Budowa wież za monety. 3. Zabijanie wrogów i zarabianie. 4. Przerwa między falami: ulepszenia i nowe wieże. 5. Przetrwanie 20 fal.',
    sessionLength: '10-20 min',
    audience: '10-16 lat, gracze tower defense i strategii',
    monetizationIdeas: [
      'Gamepass "Złota wieża" – startowa wieża premium, która skaluje się z każdą falą.',
      'Dev product "Podwójne nagrody za falę" dla graczy, którzy chcą szybciej farmić.',
      'Gamepass "Dodatkowe działki" – bezpośrednio zwiększa moc gracza, więc sprzedaje się najlepiej.',
    ],
    systems: [
      { name: 'Fale wrogów', purpose: 'Rytm gry i narastająca trudność', serverAuthority: 'Serwer spawnuje i steruje wrogami', keyParameters: { MaxWaves: 20, count: '4 + wave*2', health: '40 + (wave-1)*28', speed: '7 + wave*0.35' } },
      { name: 'Wieże', purpose: 'Główna decyzja strategiczna', serverAuthority: 'Serwer waliduje pieniądze, działkę i cooldown', keyParameters: { types: 3, maxLevel: 4, upgradeScale: '1.35-1.5' } },
      { name: 'Ekonomia', purpose: 'Napięcie między oszczędzaniem a obroną', serverAuthority: 'Pieniądze istnieją tylko na serwerze', keyParameters: { start: 250, killReward: '6 + wave*1.5', waveBonus: '40 + wave*12', sellRefund: '60%' } },
      { name: 'Baza', purpose: 'Warunek przegranej', serverAuthority: 'HP bazy tylko na serwerze', keyParameters: { BaseHealth: 100, damagePerLeak: 10 } },
      { name: 'Celowanie', purpose: 'Czytelność walki', serverAuthority: 'Wybór celu i obrażenia po stronie serwera', keyParameters: { targeting: 'najbliżej bazy', tickRate: 'Heartbeat' } },
    ],
    controls: [
      { input: '1 / 2 / 3', action: 'Wybór typu wieży (Blaster / Cannon / Frost)' },
      { input: 'LPM', action: 'Budowa wieży na działce pod kursorem' },
      { input: 'E', action: 'Ulepszenie wieży na wskazanej działce' },
      { input: 'X', action: 'Sprzedaż wieży (zwrot 60%)' },
      { input: 'PPM + przeciągnięcie', action: 'Obrót kamery' },
    ],
    objectives: [
      'Przetrwaj 20 fal wrogów.',
      'Utrzymaj bazę powyżej 0 HP.',
      'Zbuduj kombinację wież, która poradzi sobie z falą 20 (HP wroga ok. 572).',
    ],
    progression: 'Monety z zabójstw (6-36 za wroga) i bonusy za fale (40-280). Ulepszenia wież mnożą obrażenia o 1.35-1.5 na poziom, do 4 poziomu. Typowy build: 2x Frost (spowolnienie) + 3x Cannon (obrażenia) + Blaster do wykańczania.',
    balancing: {
      StartMoney: 250, BaseHealth: 100, MaxWaves: 20, WaveBreak: 6,
      Blaster: { cost: 100, damage: 12, range: 34, fireRate: 0.55 },
      Cannon: { cost: 200, damage: 42, range: 46, fireRate: 1.4 },
      Frost: { cost: 150, damage: 6, range: 30, fireRate: 0.9, slow: 0.45 },
    },
    worldLayout:
      'Ścieżka wroga z 8 waypointów tworzy zygzak o długości ok. 700 studsów: start w X-120, Z-60, meta po prawej stronie mapy. Działki (8 sztuk) leżą po obu stronach ścieżki w odległości 8-20 studsów, tak aby wieża o zasięgu 34-46 studsów obejmowała 2-3 zakręty. Baza (18x10x18) stoi 20 studsów za ostatnim waypointem.',
    designDoc: [
      '## Koncept',
      'Neon Rush to tower defense dla jednego do czterech graczy: wspólna pula monet, wspólna baza, wspólna porażka. ',
      'Krótkie fale (6-20 wrogów) i 6-sekundowe przerwy utrzymują tempo typowe dla sesji mobilnych.',
      '',
      '## Pętla rozgrywki',
      '1. Gracz patrzy na ścieżkę i wybiera działkę przy zakręcie (tam wieża obejmuje najwięcej drogi).',
      '2. Wydaje 100-200 monet na pierwszą wieżę i obserwuje, jak bije wrogów.',
      '3. Po każdej fali dostaje bonus (40 + 12*fala) i decyduje: ulepszać czy dobudować.',
      '4. Fale 5, 10, 15 zmieniają kolor wrogów (wyższy tier = więcej HP) – czytelny sygnał wzrostu trudności.',
      '',
      '## Systemy',
      '| System | Rola | Ważne liczby |',
      '| --- | --- | --- |',
      '| WaveManager | Rytm i trudność | 20 fal, 6 s przerwy |',
      '| TowerService | Budowa, celowanie, ulepszenia | 3 typy, 4 poziomy |',
      '| EnemyService | Ruch i HP wrogów | HP 40->572 |',
      '| Ekonomia | Decyzje gracza | start 250, refund 60% |',
      '',
      '## Balans',
      'Blaster: 12 obrażeń / 0,55 s = ~22 DPS za 100 monet. Cannon: 42 / 1,4 s = 30 DPS za 200 monet, ',
      'ale w jednym strzale (neutralizuje regenerację i działa świetnie przeciw grupie na zakręcie). ',
      'Frost nie zabija – spowalnia o 55%, co daje Cannonowi czas na dwa razy więcej strzałów. ',
      'Wzór HP wroga: 40 + (fala-1)*28, więc fala 20 ma 572 HP. Łączna moc 5 wież na poziomie 3 (~180 DPS) ',
      'zabija wroga fali 20 w nieco ponad 3 sekundy – wymaga więc ulepszeń, nie tylko samej liczby wież.',
      '',
      '## Mapa',
      'Zygzak daje 3 zakręty, na których jedna wieża obejmuje dwa odcinki drogi. Działki są rozstawione tak, ',
      'żeby żadna nie była dominująca – gracz musi wybrać, gdzie zainwestować.',
      '',
      '## UI',
      'Lewy górny róg: monety, fala, HP bazy. Prawy dolny: lista wież z ceną (1/2/3). ',
      'Wybór wieży pokazuje półprzezroczysty podgląd z okręgiem zasięgu – dokładnie takim, jaki widzi serwer.',
      '',
      '## Onboarding gracza',
      'Na start 250 monet (wystarczy na 1 Cannon + 1 Blaster), pierwsza fala to tylko 6 wolnych wrogów, ',
      'a komunikat w UI mówi wprost: "Kliknij działkę, żeby postawić wieżę".',
      '',
      '## Ryzyka',
      '* Gracz nowy w gatunku wyda wszystko na same Cannony -> fala 12 z szybkimi wrogami go przetoczy; ',
      '  rozwiązanie: komunikat o spowolnieniu w opisie Frosta.',
      '* Zbyt łatwa gra -> parametry fal są we wzorze w Config, zmiana jednej liczby podnosi trudność.',
      '* Lag przy 40 wrogach -> wrogowie to Part-y bez Humanoidów i bez fizyki (Anchored), aktualizowane w jednej pętli.',
    ].join('\n'),
  },
  notes: [
    'Wrogowie nie używają Humanoidów – to Part-y przesuwane po ścieżce w jednej pętli Heartbeat, dzięki czemu 40 wrogów nie zabija serwera.',
    'Cooldown i pieniądze sprawdza serwer, więc klient nie może postawić wieży bez zapłaty (nawet jeśli zmodyfikuje HUD).',
    'Zasięg w podglądzie klienta liczony jest z tego samego Config co zasięg serwera – podgląd nie kłamie.',
  ],
  plan: {
    architecture: [
      'RoundService to jedyny skrypt uruchamialny: tworzy remotes, buduje świat (droga, działki, baza), steruje falami i ekonomią.',
      'EnemyService trzyma wrogów i ich ruch; TowerService celuje i zadaje obrażenia przez EnemyService.applyDamage.',
      'PathService jest współdzielony – klient liczy z niego podgląd zasięgu, więc UI i serwer używają tej samej matematyki.',
      'Klient wysyła wyłącznie intencje budowy/ulepszenia/sprzedaży; serwer odpowiada stanem i komunikatami w "Feed".',
    ].join('\n'),
    remoteEvents: [
      { name: 'PlaceTower', direction: 'client->server', payload: 'towerId: string, plotIndex: number' },
      { name: 'UpgradeTower', direction: 'client->server', payload: 'plotIndex: number' },
      { name: 'SellTower', direction: 'client->server', payload: 'plotIndex: number' },
      { name: 'State', direction: 'server->client', payload: 'state: {money, wave, baseHealth, active, enemiesAlive, nextWaveIn}' },
      { name: 'Feed', direction: 'server->client', payload: 'message: string, color: Color3?' },
    ],
    files: [
      { path: 'src/shared/Config.luau', kind: 'module', purpose: 'Balans, ścieżka, działki, definicje wież, nazwy remotów', exports: ['Config'], requires: [], lines: 90 },
      { path: 'src/shared/PathService.luau', kind: 'module', purpose: 'Matematyka ścieżki (pozycja wroga po dystansie)', exports: ['PathService'], requires: ['src/shared/Config.luau'], lines: 45 },
      { path: 'src/server/EnemyService.luau', kind: 'module', purpose: 'Spawn, ruch i HP wrogów', exports: ['EnemyService'], requires: ['src/shared/Config.luau', 'src/shared/PathService.luau'], lines: 170 },
      { path: 'src/server/TowerService.luau', kind: 'module', purpose: 'Budowa, celowanie, ulepszenia i sprzedaż wież', exports: ['TowerService'], requires: ['src/shared/Config.luau'], lines: 190 },
      { path: 'src/server/RoundService.server.luau', kind: 'server', purpose: 'Świat, fale, ekonomia, obsługa remotów (skrypt startowy)', exports: [], requires: ['src/shared/Config.luau', 'src/server/EnemyService.luau', 'src/server/TowerService.luau'], lines: 250 },
      { path: 'src/client/BuildController.client.luau', kind: 'client', purpose: 'Podgląd wieży, budowa, ulepszanie, sprzedaż', exports: [], requires: ['src/shared/Config.luau'], lines: 180 },
      { path: 'src/client/Hud.client.luau', kind: 'client', purpose: 'HUD: monety, fala, HP bazy, lista wież, komunikaty', exports: [], requires: ['src/shared/Config.luau'], lines: 190 },
    ],
  },
  world: {
    lighting: {
      ClockTime: 20,
      Ambient: '#4A5270',
      OutdoorAmbient: '#5A6280',
      Brightness: 1.6,
      GlobalShadows: true,
      Technology: 'ShadowMap',
      FogEnd: 900,
      FogColor: '#0E1122',
    },
    world: {
      name: 'World',
      className: 'Folder',
      children: [
        {
          className: 'Part', name: 'Ground',
          properties: { Size: [420, 2, 320], Position: [0, -1.5, 30], Color: '#171A2B', Material: 'Slate', Anchored: true },
        },
        {
          className: 'SpawnLocation', name: 'LobbySpawn',
          properties: { Size: [10, 1, 10], Position: [-120, 1, 10], Color: '#00E5A0', Material: 'Neon', Duration: 0, Anchored: true },
        },
        {
          className: 'Folder', name: 'TDWorld',
          properties: {},
        },
        {
          className: 'Folder', name: 'Decor',
          properties: {},
          children: [
            {
              className: 'Part', name: 'BannerLeft',
              properties: { Size: [1, 14, 20], Position: [-90, 7, 40], Color: '#7E57C2', Material: 'Neon', Transparency: 0.35, Anchored: true },
              children: [{ className: 'PointLight', name: 'Glow', properties: { Color: '#9C7BFF', Brightness: 2.4, Range: 48 } }],
            },
            {
              className: 'Part', name: 'BannerRight',
              properties: { Size: [1, 14, 20], Position: [70, 7, 120], Color: '#00E5A0', Material: 'Neon', Transparency: 0.35, Anchored: true },
              children: [{ className: 'PointLight', name: 'Glow', properties: { Color: '#7FFFD8', Brightness: 2.4, Range: 48 } }],
            },
          ],
        },
      ],
    },
  },
  files: [
    { path: 'src/shared/Config.luau', content: config },
    { path: 'src/shared/PathService.luau', content: pathService },
    { path: 'src/server/EnemyService.luau', content: enemyService },
    { path: 'src/server/TowerService.luau', content: towerService },
    { path: 'src/server/RoundService.server.luau', content: roundService },
    { path: 'src/client/BuildController.client.luau', content: buildController },
    { path: 'src/client/Hud.client.luau', content: hudTd },
  ],
};
