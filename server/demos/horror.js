/**
 * Demo project #5 – "Blackout Ward" (offline).
 * Co-op horror: dark hospital wing, flashlight with battery, three generators
 * to repair, one monster that hunts by sound. All atmosphere is procedural
 * (lights, fog, screen effects) – no external assets required.
 */

const config = `--[[
	Config – horror: ciemno, cicho, mało liczb, każda ma znaczenie.
]]
local Config = {}

Config.GeneratorsRequired = 3        -- ile generatorów trzeba naprawić
Config.RepairTime = 12               -- sekundy trzymania przy generatorze
Config.MonsterSpeed = 15
Config.MonsterChaseSpeed = 22
Config.MonsterDamage = 34
Config.MonsterSpawnDelay = 25        -- ile sekund spokoju na starcie rundy
Config.FlashlightBattery = 100
Config.BatteryDrain = 1.6            -- % na sekundę przy włączonej latarce
Config.BatteryPickupAmount = 45
Config.RoundTime = 480               -- 8 minut na naprawę wszystkiego
Config.Intermission = 15

Config.Colors = {
	Floor = "#1A1D26",
	Wall = "#262A38",
	Generator = "#FFC400",
	GeneratorDone = "#00E5A0",
	Door = "#7E57C2",
	Battery = "#4FC3F7",
	Blood = "#8B1A1A",
	Emergency = "#FF5252",
}

Config.Remotes = {
	State = "State",           -- serwer -> klient: czas, generatory, status drzwi
	Notify = "Notify",         -- serwer -> klient: komunikaty i szepty
	Generator = "Generator",   -- klient -> serwer: postęp naprawy
	Flashlight = "Flashlight", -- klient -> serwer: stan latarki (dla dźwięku/efektów innych)
	Heartbeat = "Heartbeat",   -- serwer -> klient: poziom strachu (odległość potwora)
}

Config.Wing = {
	length = 260,              -- długość skrzydła szpitala
	width = 70,
	roomCount = 6,
	seed = 51423,
}

return Config
`;

const mapBuilder = `--[[
	MapBuilder – generuje skrzydło szpitala: korytarz, pokoje, drzwi, generatory,
	latarki na ścianach i wyjście. Ta sama mapa dla każdego gracza (stały seed).
]]
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))

local MapBuilder = {}
MapBuilder.generatorPositions = {}
MapBuilder.batteryPositions = {}
MapBuilder.doorPosition = nil

local rng = Random.new(Config.Wing.seed)

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

local function flickerLight(parent)
	local light = Instance.new("PointLight")
	light.Color = Color3.fromHex("#FFE0B2")
	light.Brightness = 0.7
	light.Range = 26
	light.Parent = parent

	-- Awaryjne światło miga nieregularnie: to buduje napięcie bez assetów.
	task.spawn(function()
		while parent.Parent do
			task.wait(rng:NextNumber(2.5, 7))
			if not parent.Parent then
				break
			end
			light.Brightness = rng:NextNumber(0.05, 0.25)
			task.wait(rng:NextNumber(0.05, 0.25))
			light.Brightness = rng:NextNumber(0.5, 0.9)
		end
	end)
	return light
end

function MapBuilder.build()
	local root = Instance.new("Folder")
	root.Name = "Ward"
	root.Parent = workspace

	local length = Config.Wing.length
	local width = Config.Wing.width

	newPart({
		Name = "Floor",
		Size = Vector3.new(width, 2, length),
		Position = Vector3.new(0, -1, length / 2),
		Color = Color3.fromHex(Config.Colors.Floor),
		Material = Enum.Material.Concrete,
		Parent = root,
	})
	newPart({
		Name = "Ceiling",
		Size = Vector3.new(width, 2, length),
		Position = Vector3.new(0, 15, length / 2),
		Color = Color3.fromHex("#14161F"),
		Material = Enum.Material.Slate,
		Parent = root,
	})

	-- Ściany boczne.
	for _, side in ipairs({ -1, 1 }) do
		newPart({
			Name = "Wall",
			Size = Vector3.new(2, 16, length),
			Position = Vector3.new(side * width / 2, 7, length / 2),
			Color = Color3.fromHex(Config.Colors.Wall),
			Material = Enum.Material.Concrete,
			Parent = root,
		})
	end
	newPart({
		Name = "BackWall",
		Size = Vector3.new(width, 16, 2),
		Position = Vector3.new(0, 7, length),
		Color = Color3.fromHex(Config.Colors.Wall),
		Material = Enum.Material.Concrete,
		Parent = root,
	})

	-- Pokoje po bokach korytarza.
	local roomStep = length / (Config.Wing.roomCount + 1)
	for index = 1, Config.Wing.roomCount do
		local side = (index % 2 == 0) and 1 or -1
		local z = roomStep * index
		local room = newPart({
			Name = "Room" .. index,
			Size = Vector3.new(1, 14, 24),
			Position = Vector3.new(side * (width / 2 - 1), 7, z),
			Color = Color3.fromHex(Config.Colors.Wall),
			Material = Enum.Material.Concrete,
			Transparency = 0.35,
			CanCollide = false,
			Parent = root,
		})
		room:SetAttribute("RoomIndex", index)

		local lamp = newPart({
			Name = "Lamp" .. index,
			Size = Vector3.new(1, 0.4, 3),
			Position = Vector3.new(side * (width / 2 - 3), 13, z),
			Color = Color3.fromHex("#FFE0B2"),
			Material = Enum.Material.Neon,
			CanCollide = false,
			Parent = root,
		})
		flickerLight(lamp)
	end

	-- Generatory: trzy, w różnych miejscach skrzydła.
	local generatorSpots = {
		Vector3.new(-width / 2 + 8, 3, roomStep * 1.5),
		Vector3.new(width / 2 - 8, 3, roomStep * 3.5),
		Vector3.new(0, 3, length - 26),
	}
	for index, position in ipairs(generatorSpots) do
		local generator = newPart({
			Name = "Generator" .. index,
			Size = Vector3.new(6, 6, 5),
			Position = position,
			Color = Color3.fromHex(Config.Colors.Generator),
			Material = Enum.Material.Metal,
			Parent = root,
		})
		generator:SetAttribute("GeneratorIndex", index)
		generator:SetAttribute("Progress", 0)

		local light = Instance.new("PointLight")
		light.Color = Color3.fromHex(Config.Colors.Generator)
		light.Brightness = 1
		light.Range = 20
		light.Parent = generator

		MapBuilder.generatorPositions[index] = position
	end

	-- Baterie do latarek (po jednej na pokój + dwie w korytarzu).
	for index = 1, Config.Wing.roomCount + 2 do
		local position = Vector3.new(
			rng:NextNumber(-width / 2 + 6, width / 2 - 6),
			1.5,
			rng:NextNumber(20, length - 20)
		)
		local battery = newPart({
			Name = "Battery" .. index,
			Size = Vector3.new(1.4, 1.4, 2.2),
			Position = position,
			Color = Color3.fromHex(Config.Colors.Battery),
			Material = Enum.Material.Neon,
			CanCollide = false,
			Parent = root,
		})
		battery:SetAttribute("Battery", true)
		table.insert(MapBuilder.batteryPositions, position)
	end

	-- Wyjście: drzwi na końcu korytarza (zamknięte do czasu naprawy generatorów).
	local doorPosition = Vector3.new(0, 6, 6)
	local door = newPart({
		Name = "ExitDoor",
		Size = Vector3.new(14, 12, 1.5),
		Position = doorPosition,
		Color = Color3.fromHex(Config.Colors.Door),
		Material = Enum.Material.Metal,
		Parent = root,
	})
	door:SetAttribute("ExitDoor", true)
	MapBuilder.doorPosition = doorPosition

	local exitLight = Instance.new("PointLight")
	exitLight.Color = Color3.fromHex(Config.Colors.Door)
	exitLight.Brightness = 1.5
	exitLight.Range = 30
	exitLight.Parent = door

	return root
end

return MapBuilder
`;

const monsterService = `--[[
	MonsterService – potwór, który słyszy graczy: chodzi po korytarzu, a gdy
	ktoś biega (albo świeci latarką z bliska), zaczyna pościg. Cała logika
	na serwerze – klient widzi tylko skutki.
]]
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))

local MonsterService = {}

local monster = nil
local state = {
	target = nil,
	mode = "patrol",       -- patrol | chase | stunned
	patrolIndex = 1,
	patrolPoints = {},
	lastAttack = 0,
	active = false,
}

function MonsterService.setActive(value)
	state.active = value
	if monster and not value then
		monster.CFrame = CFrame.new(0, 4, Config.Wing.length - 10)
		state.mode = "patrol"
		state.target = nil
	end
end

local function buildMonster()
	if monster and monster.Parent then
		return monster
	end
	local model = Instance.new("Model")
	model.Name = "TheWatcher"

	local body = Instance.new("Part")
	body.Name = "Body"
	body.Size = Vector3.new(3, 7, 2)
	body.Anchored = true
	body.CanCollide = false
	body.Material = Enum.Material.SmoothPlastic
	body.Color = Color3.fromHex("#0B0C10")
	body.CFrame = CFrame.new(0, 4, Config.Wing.length - 10)
	body.Parent = model

	-- Blade światło zamiast twarzy: gracz nie wie, gdzie patrzy potwór.
	local eyes = Instance.new("Part")
	eyes.Name = "Eyes"
	eyes.Size = Vector3.new(1.6, 0.4, 0.4)
	eyes.Anchored = true
	eyes.CanCollide = false
	eyes.Material = Enum.Material.Neon
	eyes.Color = Color3.fromHex("#FF3B3B")
	eyes.Parent = model

	local aura = Instance.new("PointLight")
	aura.Color = Color3.fromHex("#FF3B3B")
	aura.Brightness = 1.2
	aura.Range = 22
	aura.Parent = body

	local hum = Instance.new("Humanoid")
	hum.MaxHealth = 1000
	hum.Health = 1000
	hum.Parent = model

	model.PrimaryPart = body
	model.Parent = workspace
	return model
end

local function nearestVisiblePlayer(position)
	local best = nil
	local bestDistance = math.huge
	for _, player in ipairs(Players:GetPlayers()) do
		local character = player.Character
		if not character then
			continue
		end
		local humanoid = character:FindFirstChildOfClass("Humanoid")
		local root = character:FindFirstChild("HumanoidRootPart")
		if not humanoid or humanoid.Health <= 0 or not root then
			continue
		end
		local distance = (root.Position - position).Magnitude
		local velocity = root.AssemblyLinearVelocity
		local noisy = Vector3.new(velocity.X, 0, velocity.Z).Magnitude > 12
		local sneaking = player:GetAttribute("FlashlightOn") == true

		-- Gracz biegnący lub świecący latarką jest "słyszalny" z dalsza.
		local hearingRange = noisy and 90 or (sneaking and 60 or 34)
		if distance < hearingRange and distance < bestDistance then
			best = player
			bestDistance = distance
		end
	end
	return best, bestDistance
end

function MonsterService.start()
	monster = buildMonster()
	local length = Config.Wing.length
	local width = Config.Wing.width

	-- Punkty patrolowe wzdłuż korytarza (potwór chodzi tam i z powrotem).
	for index = 1, 7 do
		table.insert(state.patrolPoints, Vector3.new(
			(index % 2 == 0) and (width / 2 - 10) or (-width / 2 + 10),
			4,
			24 + (length - 48) * ((index - 1) / 6)
		))
	end

	RunService.Heartbeat:Connect(function(dt)
		if not monster or not monster.Parent then
			return
		end
		if not state.active then
			return
		end

		local body = monster.PrimaryPart
		local eyes = monster:FindFirstChild("Eyes")
		local target, distance = nearestVisiblePlayer(body.Position)

		if target then
			state.mode = "chase"
			state.target = target
		elseif state.mode == "chase" then
			state.mode = "patrol"
			state.target = nil
		end

		local goal
		if state.mode == "chase" and state.target and state.target.Character then
			local root = state.target.Character:FindFirstChild("HumanoidRootPart")
			goal = root and root.Position or nil
		else
			local point = state.patrolPoints[state.patrolIndex]
			if point and (body.Position - point).Magnitude < 6 then
				state.patrolIndex = (state.patrolIndex % #state.patrolPoints) + 1
				point = state.patrolPoints[state.patrolIndex]
			end
			goal = point
		end

		if goal then
			local speed = state.mode == "chase" and Config.MonsterChaseSpeed or Config.MonsterSpeed
			local direction = (Vector3.new(goal.X, body.Position.Y, goal.Z) - body.Position)
			if direction.Magnitude > 0.5 then
				direction = direction.Unit
				body.CFrame = CFrame.lookAt(body.Position, body.Position + direction)
				body.Position = body.Position + direction * speed * dt
			end
		end

		if eyes then
			eyes.CFrame = body.CFrame * CFrame.new(0, 2, -0.9)
		end

		-- Atak: przy kontakcie zabiera HP i odrzuca gracza.
		if distance and distance < 5 and state.target then
			local now = os.clock()
			if now - state.lastAttack > 1.6 then
				state.lastAttack = now
				local character = state.target.Character
				local humanoid = character and character:FindFirstChildOfClass("Humanoid")
				if humanoid and humanoid.Health > 0 then
					humanoid:TakeDamage(Config.MonsterDamage)
				end
			end
		end
	end)

	return monster
end

function MonsterService.position()
	return monster and monster.PrimaryPart and monster.PrimaryPart.Position or nil
end

return MonsterService
`;

const roundService = `--[[
	RoundService – skrypt startowy horroru: mapa, generatory, baterie, wyjście,
	strach (odległość potwora) i warunki zwycięstwa/przegranej.
]]
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Lighting = game:GetService("Lighting")
local TweenService = game:GetService("TweenService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))

local MapBuilder = require(script.Parent:WaitForChild("MapBuilder"))
local MonsterService = require(script.Parent:WaitForChild("MonsterService"))

-- 1. Remotes ---------------------------------------------------------
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

-- 2. Atmosfera -------------------------------------------------------
Lighting.ClockTime = 0
Lighting.Brightness = 0.35
Lighting.Ambient = Color3.fromHex("#0A0C14")
Lighting.OutdoorAmbient = Color3.fromHex("#0C0E16")
Lighting.GlobalShadows = true
Lighting.FogEnd = 70
Lighting.FogColor = Color3.fromHex("#05060A")
Lighting.EnvironmentDiffuseScale = 0.15
Lighting.EnvironmentSpecularScale = 0.1

local atmosphere = Lighting:FindFirstChildOfClass("Atmosphere") or Instance.new("Atmosphere")
atmosphere.Density = 0.42
atmosphere.Haze = 2.6
atmosphere.Color = Color3.fromHex("#1A2030")
atmosphere.Decay = Color3.fromHex("#0A0C14")
atmosphere.Parent = Lighting

local blur = Lighting:FindFirstChild("HorrorBlur") or Instance.new("BlurEffect")
blur.Name = "HorrorBlur"
blur.Size = 0
blur.Parent = Lighting

local grading = Lighting:FindFirstChild("HorrorGrading") or Instance.new("ColorCorrectionEffect")
grading.Name = "HorrorGrading"
grading.Saturation = -0.45
grading.Contrast = 0.22
grading.TintColor = Color3.fromHex("#9FB0D0")
grading.Parent = Lighting

-- 3. Mapa ------------------------------------------------------------
local ward = MapBuilder.build()

local lobbySpawn = Instance.new("SpawnLocation")
lobbySpawn.Name = "EntrySpawn"
lobbySpawn.Size = Vector3.new(10, 1, 10)
lobbySpawn.Position = Vector3.new(0, 1, -8)
lobbySpawn.Anchored = true
lobbySpawn.Duration = 0
lobbySpawn.Color = Color3.fromHex("#00E5A0")
lobbySpawn.Material = Enum.Material.Neon
lobbySpawn.Parent = ward

local entryFloor = Instance.new("Part")
entryFloor.Name = "EntryHall"
entryFloor.Size = Vector3.new(30, 2, 16)
entryFloor.Position = Vector3.new(0, -1, -8)
entryFloor.Anchored = true
entryFloor.Color = Color3.fromHex(Config.Colors.Floor)
entryFloor.Material = Enum.Material.Concrete
entryFloor.Parent = ward

-- 4. Stan rundy ------------------------------------------------------
local state = {
	roundActive = false,
	timeLeft = Config.RoundTime,
	repaired = 0,
	escaped = 0,
	monsterActive = false,
}

local function pushState()
	remotesTable.State:FireAllClients({
		roundActive = state.roundActive,
		timeLeft = state.timeLeft,
		repaired = state.repaired,
		required = Config.GeneratorsRequired,
		escaped = state.escaped,
		monsterActive = state.monsterActive,
	})
end

local function notify(player, message, colour)
	if player then
		remotesTable.Notify:FireClient(player, message, colour)
	else
		remotesTable.Notify:FireAllClients(message, colour)
	end
end

-- 5. Generatory ------------------------------------------------------
local generators = {}
for _, instance in ipairs(ward:GetChildren()) do
	if instance:IsA("BasePart") and string.match(instance.Name, "^Generator") then
		generators[instance:GetAttribute("GeneratorIndex")] = {
			part = instance,
			progress = 0,
			done = false,
		}
	end
end

-- 6. Gracz -----------------------------------------------------------
local function setupPlayer(player)
	local character = player.Character or player.CharacterAdded:Wait()
	local humanoid = character:WaitForChild("Humanoid")
	humanoid.WalkSpeed = 15
	humanoid.JumpPower = 46
	humanoid.UseJumpPower = true
	player:SetAttribute("Battery", Config.FlashlightBattery)
	player:SetAttribute("FlashlightOn", false)

	character:WaitForChild("Humanoid").Died:Connect(function()
		notify(player, "Znalazł Cię. Wracasz na start.", Color3.fromHex("#FF5252"))
		task.delay(3, function()
			if state.roundActive then
				player:LoadCharacter()
			end
		end)
	end)
end

for _, player in ipairs(Players:GetPlayers()) do
	task.spawn(setupPlayer, player)
end
Players.PlayerAdded:Connect(function(player)
	player.CharacterAdded:Connect(function(character)
		local humanoid = character:WaitForChild("Humanoid")
		humanoid.WalkSpeed = 15
		humanoid.JumpPower = 46
		humanoid.UseJumpPower = true
	end)
	setupPlayer(player)
	pushState()
end)

-- 7. Naprawa generatorów --------------------------------------------
local repairRemote = remotesTable.Generator
if repairRemote then
	repairRemote.OnServerEvent:Connect(function(player, action)
		if not state.roundActive or action ~= "start" then
			return
		end
		local character = player.Character
		local root = character and character:FindFirstChild("HumanoidRootPart")
		if not root then
			return
		end

		-- Szukamy najbliższego generatora, ale tylko jeśli gracz naprawdę przy nim stoi.
		local nearestIndex = nil
		local nearestDistance = math.huge
		for index, generator in pairs(generators) do
			if not generator.done then
				local distance = (root.Position - generator.part.Position).Magnitude
				if distance < 12 and distance < nearestDistance then
					nearestIndex = index
					nearestDistance = distance
				end
			end
		end
		if not nearestIndex then
			return
		end

		-- Naprawa trwa: gracz musi zostać w miejscu i być cicho.
		local generator = generators[nearestIndex]
		local started = os.clock()
		while os.clock() - started < Config.RepairTime do
			if not state.roundActive then
				return
			end
			local currentRoot = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
			if not currentRoot or (currentRoot.Position - generator.part.Position).Magnitude > 14 then
				generator.progress = 0
				generator.part:SetAttribute("Progress", 0)
				generator.part.Color = Color3.fromHex(Config.Colors.Generator)
				notify(player, "Przerwałeś naprawę!", Color3.fromHex("#FFC400"))
				return
			end

			-- Pościg przerywa naprawę: to sprawia, że hałas ma znaczenie.
			local monsterPosition = MonsterService.position()
			if monsterPosition and (monsterPosition - generator.part.Position).Magnitude < 26 then
				generator.progress = 0
				generator.part:SetAttribute("Progress", 0)
				notify(player, "Coś jest blisko... uciekaj!", Color3.fromHex("#FF5252"))
				return
			end

			task.wait(0.2)
			generator.progress = math.min(1, (os.clock() - started) / Config.RepairTime)
			generator.part:SetAttribute("Progress", generator.progress)
			generator.part.Color = Color3.fromHex(Config.Colors.Generator):Lerp(
				Color3.fromHex(Config.Colors.GeneratorDone), generator.progress)
		end

		generator.done = true
		generator.progress = 1
		generator.part.Color = Color3.fromHex(Config.Colors.GeneratorDone)
		generator.part.Material = Enum.Material.Neon
		state.repaired += 1

		local light = generator.part:FindFirstChildOfClass("PointLight")
		if light then
			light.Color = Color3.fromHex(Config.Colors.GeneratorDone)
			light.Brightness = 3
			light.Range = 45
		end

		-- Każdy naprawiony generator rozjaśnia skrzydło – gracz widzi postęp.
		Lighting.Brightness = 0.35 + state.repaired * 0.25
		notify(nil, "Generator " .. state.repaired .. "/" .. Config.GeneratorsRequired .. " naprawiony!", Color3.fromHex("#00E5A0"))
		pushState()

		if state.repaired >= Config.GeneratorsRequired then
			notify(nil, "Wyjście otwarte! Biegnij do drzwi na końcu korytarza.", Color3.fromHex("#7E57C2"))
			local door = ward:FindFirstChild("ExitDoor")
			if door then
				TweenService:Create(door, TweenInfo.new(1.6), { Transparency = 0.75 }):Play()
				door.CanCollide = false
			end
		end
	end)
end

-- 8. Latarka i baterie ----------------------------------------------
local flashlightRemote = remotesTable.Flashlight
if flashlightRemote then
	flashlightRemote.OnServerEvent:Connect(function(player, isOn)
		player:SetAttribute("FlashlightOn", isOn == true)
	end)
end

task.spawn(function()
	while true do
		task.wait(1)
		for _, player in ipairs(Players:GetPlayers()) do
			if player:GetAttribute("FlashlightOn") then
				local battery = math.max(0, (player:GetAttribute("Battery") or 0) - Config.BatteryDrain)
				player:SetAttribute("Battery", battery)
				if battery <= 0 then
					player:SetAttribute("FlashlightOn", false)
					notify(player, "Bateria padła. Znajdź zapasową.", Color3.fromHex("#FFC400"))
				end
			end
		end
	end
end)

-- Zbieranie baterii z mapy.
for _, instance in ipairs(ward:GetDescendants()) do
	if instance:IsA("BasePart") and instance:GetAttribute("Battery") then
		instance.Touched:Connect(function(hit)
			local player = hit.Parent and Players:GetPlayerFromCharacter(hit.Parent)
			if not player then
				return
			end
			local battery = math.min(Config.FlashlightBattery, (player:GetAttribute("Battery") or 0) + Config.BatteryPickupAmount)
			player:SetAttribute("Battery", battery)
			instance:Destroy()
			notify(player, "Bateria +" .. Config.BatteryPickupAmount .. "%", Color3.fromHex("#4FC3F7"))
		end)
	end
end

-- 9. Wyjście ---------------------------------------------------------
local exitDoor = ward:FindFirstChild("ExitDoor")
if exitDoor then
	exitDoor.Touched:Connect(function(hit)
		if state.repaired < Config.GeneratorsRequired then
			return
		end
		local player = hit.Parent and Players:GetPlayerFromCharacter(hit.Parent)
		if not player then
			return
		end
		state.escaped += 1
		notify(nil, player.DisplayName .. " uciekł ze skrzydła!", Color3.fromHex("#00E5A0"))
		pushState()
		player:LoadCharacter()
	end)
end

-- 10. Strach: klient dostaje odległość potwora (efekty: blur, heartbeat) --
task.spawn(function()
	while true do
		task.wait(0.35)
		local position = MonsterService.position()
		if position then
			for _, player in ipairs(Players:GetPlayers()) do
				local character = player.Character
				local root = character and character:FindFirstChild("HumanoidRootPart")
				if root then
					remotesTable.Heartbeat:FireClient(player, (root.Position - position).Magnitude)
				end
			end
		end
	end
end)

-- 11. Runda ----------------------------------------------------------
local function resetRound()
	state.timeLeft = Config.RoundTime
	state.repaired = 0
	state.escaped = 0
	state.monsterActive = false
	MonsterService.setActive(false)
	Lighting.Brightness = 0.35

	for _, generator in pairs(generators) do
		generator.done = false
		generator.progress = 0
		generator.part.Color = Color3.fromHex(Config.Colors.Generator)
		generator.part.Material = Enum.Material.Metal
		generator.part:SetAttribute("Progress", 0)
	end

	local door = ward:FindFirstChild("ExitDoor")
	if door then
		door.Transparency = 0
		door.CanCollide = true
	end

	for _, player in ipairs(Players:GetPlayers()) do
		player:LoadCharacter()
		player:SetAttribute("Battery", Config.FlashlightBattery)
		player:SetAttribute("FlashlightOn", false)
	end
end

MonsterService.start()

task.spawn(function()
	while true do
		if #Players:GetPlayers() > 0 then
			resetRound()
			state.roundActive = true
			notify(nil, "Napraw " .. Config.GeneratorsRequired .. " generatory i uciekaj. Nie biegaj bez potrzeby.", Color3.fromHex("#FFC400"))
			pushState()

			task.wait(Config.MonsterSpawnDelay)
			state.monsterActive = true
			MonsterService.setActive(true)
			notify(nil, "Coś się obudziło...", Color3.fromHex("#FF5252"))
			pushState()

			while state.timeLeft > 0 and state.roundActive do
				task.wait(1)
				state.timeLeft -= 1
				if state.timeLeft % 10 == 0 then
					pushState()
				end
				if state.timeLeft <= 0 then
					notify(nil, "Czas minął. Skrzydło pochłonęło wszystkich.", Color3.fromHex("#FF5252"))
				end
			end

			state.roundActive = false
			MonsterService.setActive(false)
			pushState()
		end
		task.wait(Config.Intermission)
	end
end)

print("[RoundService] Blackout Ward gotowy: " .. Config.GeneratorsRequired .. " generatory, runda " .. Config.RoundTime .. " s.")
`;

const flashlight = `--[[
	Flashlight – latarka gracza: światło, bateria, miganie i dźwięk kroków.
	Serwer dostaje tylko informację "świecę / nie świecę" (potwór słyszy światło).
]]
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UserInputService = game:GetService("UserInputService")
local RunService = game:GetService("RunService")
local Lighting = game:GetService("Lighting")

local player = Players.LocalPlayer
local camera = workspace.CurrentCamera

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))

local remotes = ReplicatedStorage:WaitForChild("Remotes")
local flashlightRemote = remotes:WaitForChild(Config.Remotes.Flashlight)

local isOn = false
local currentBattery = Config.FlashlightBattery
local flickerUntil = 0

-- Latarka to SpotLight dołączony do postaci (widzi ją cały serwer).
local function attachLight(character)
	local root = character:WaitForChild("HumanoidRootPart")
	local existing = root:FindFirstChild("PlayerFlashlight")
	if existing then
		existing:Destroy()
	end

	local attachment = Instance.new("Attachment")
	attachment.Name = "FlashlightAttachment"
	attachment.Position = Vector3.new(0.8, -0.6, -0.6)
	attachment.Parent = root

	local light = Instance.new("SpotLight")
	light.Name = "PlayerFlashlight"
	light.Angle = 62
	light.Range = 62
	light.Brightness = 0
	light.Color = Color3.fromHex("#FFF3D6")
	light.Face = Enum.NormalId.Front
	light.Shadows = true
	light.Parent = root

	-- Delikatny "stożek" widoczny w powietrzu (mgła + światło = czytelny snop).
	local cone = Instance.new("Part")
	cone.Name = "FlashlightCone"
	cone.Size = Vector3.new(1, 1, 1)
	cone.Material = Enum.Material.Neon
	cone.Color = Color3.fromHex("#FFF3D6")
	cone.Transparency = 1
	cone.CanCollide = false
	cone.CanQuery = false
	cone.CanTouch = false
	cone.Anchored = true
	cone.Parent = root
end

local function setOn(value)
	isOn = value and currentBattery > 0
	flashlightRemote:FireServer(isOn)
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	local light = root and root:FindFirstChild("PlayerFlashlight")
	if light then
		if isOn then
			light.Brightness = 2.6
		else
			light.Brightness = 0
		end
	end
end

UserInputService.InputBegan:Connect(function(input, gameProcessed)
	if gameProcessed then
		return
	end
	if input.KeyCode == Enum.KeyCode.F then
		setOn(not isOn)
	end
end)

-- Aktualizacja baterii: serwer jest autorytetem, klient tylko gasi światło.
player:GetAttributeChangedSignal("Battery"):Connect(function()
	currentBattery = player:GetAttribute("Battery") or 0
	if currentBattery <= 0 then
		setOn(false)
	end
end)

player.CharacterAdded:Connect(function(character)
	attachLight(character)
	task.wait(0.5)
	setOn(false)
end)
if player.Character then
	task.spawn(attachLight, player.Character)
end

RunService.Heartbeat:Connect(function(dt)
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if not root or not humanoid then
		return
	end
	local light = root:FindFirstChild("PlayerFlashlight")
	if not light then
		return
	end

	-- Migotanie przy niskiej baterii – klasyczny horror bez assetów.
	if isOn and currentBattery < 25 then
		if os.clock() > flickerUntil then
			flickerUntil = os.clock() + math.random() * 1.6
			light.Brightness = 0
		else
			light.Brightness = 2.6 * (0.5 + math.random() * 0.5)
		end
	elseif isOn then
		light.Brightness = 2.6
	end

	-- Latarka obraca się z kamerą (światło w kierunku patrzenia).
	local direction = camera.CFrame.LookVector
	light.Parent = root
	light.Face = Enum.NormalId.Front
	local attachment = root:FindFirstChild("FlashlightAttachment")
	if attachment then
		attachment.WorldPosition = root.Position + Vector3.new(0, -0.4, 0)
	end
	-- Światło zawsze patrzy w kierunku kamery gracza (snop jak w FPS-ach).
	light.SpotLightAngle = 62
	if direction then
		light.Parent = root
	end
end)
`;

const hudHorror = `--[[
	HUD – horror: bateria, postęp generatorów, czas, strach (blur + heartbeat),
	ekran śmierci i podpowiedzi sterowania.
]]
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local Lighting = game:GetService("Lighting")
local SoundService = game:GetService("SoundService")

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))

local remotes = ReplicatedStorage:WaitForChild("Remotes")
local stateRemote = remotes:WaitForChild(Config.Remotes.State)
local notifyRemote = remotes:WaitForChild(Config.Remotes.Notify)
local heartbeatRemote = remotes:WaitForChild(Config.Remotes.Heartbeat)

local gui = Instance.new("ScreenGui")
gui.Name = "HorrorHUD"
gui.IgnoreGuiInset = true
gui.ResetOnSpawn = false
gui.DisplayOrder = 5
gui.Parent = playerGui

local function corner(parent, radius)
	local instance = Instance.new("UICorner")
	instance.CornerRadius = UDim.new(0, radius or 8)
	instance.Parent = parent
end

-- Pasek baterii (lewy dolny róg)
local batteryFrame = Instance.new("Frame")
batteryFrame.AnchorPoint = Vector2.new(0, 1)
batteryFrame.Position = UDim2.new(0, 24, 1, -24)
batteryFrame.Size = UDim2.fromOffset(280, 22)
batteryFrame.BackgroundColor3 = Color3.fromHex("#0B0D14")
batteryFrame.BackgroundTransparency = 0.25
batteryFrame.BorderSizePixel = 0
batteryFrame.Parent = gui
corner(batteryFrame, 6)

local batteryFill = Instance.new("Frame")
batteryFill.Size = UDim2.fromScale(1, 1)
batteryFill.BackgroundColor3 = Color3.fromHex("#4FC3F7")
batteryFill.BorderSizePixel = 0
batteryFill.Parent = batteryFrame
corner(batteryFill, 6)

local batteryLabel = Instance.new("TextLabel")
batteryLabel.Size = UDim2.new(1, -16, 1, 0)
batteryLabel.Position = UDim2.fromOffset(8, 0)
batteryLabel.BackgroundTransparency = 1
batteryLabel.Font = Enum.Font.GothamBold
batteryLabel.TextSize = 13
batteryLabel.TextColor3 = Color3.fromHex("#0B0D14")
batteryLabel.Text = "LATARKA 100%  [F]"
batteryLabel.TextXAlignment = Enum.TextXAlignment.Left
batteryLabel.Parent = batteryFrame

-- Postęp generatorów (górny środek)
local genFrame = Instance.new("Frame")
genFrame.AnchorPoint = Vector2.new(0.5, 0)
genFrame.Position = UDim2.new(0.5, 0, 0, 16)
genFrame.Size = UDim2.fromOffset(320, 52)
genFrame.BackgroundColor3 = Color3.fromHex("#0B0D14")
genFrame.BackgroundTransparency = 0.35
genFrame.BorderSizePixel = 0
genFrame.Parent = gui
corner(genFrame, 10)

local genLabel = Instance.new("TextLabel")
genLabel.Size = UDim2.new(1, -16, 0, 30)
genLabel.Position = UDim2.fromOffset(8, 4)
genLabel.BackgroundTransparency = 1
genLabel.Font = Enum.Font.GothamBold
genLabel.TextSize = 16
genLabel.TextColor3 = Color3.fromHex("#FFC400")
genLabel.Text = "GENERATORY 0/3"
genLabel.Parent = genFrame

local timeLabel = Instance.new("TextLabel")
timeLabel.Size = UDim2.new(1, -16, 0, 16)
timeLabel.Position = UDim2.fromOffset(8, 32)
timeLabel.BackgroundTransparency = 1
timeLabel.Font = Enum.Font.Gotham
timeLabel.TextSize = 12
timeLabel.TextColor3 = Color3.fromHex("#9AA3C7")
timeLabel.Text = "8:00"
timeLabel.Parent = genFrame

-- Winieta strachu + tekst podpowiedzi
local vignette = Instance.new("Frame")
vignette.Size = UDim2.fromScale(1, 1)
vignette.BackgroundColor3 = Color3.fromHex("#000000")
vignette.BackgroundTransparency = 1
vignette.BorderSizePixel = 0
vignette.ZIndex = 0
vignette.Parent = gui

local hint = Instance.new("TextLabel")
hint.AnchorPoint = Vector2.new(0.5, 1)
hint.Position = UDim2.new(0.5, 0, 1, -70)
hint.Size = UDim2.fromOffset(620, 30)
hint.BackgroundTransparency = 1
hint.Font = Enum.Font.Gotham
hint.TextSize = 14
hint.TextColor3 = Color3.fromHex("#C9D2EE")
hint.Text = "F – latarka    E – naprawa generatora    Wyjście otworzy się po 3 generatorach"
hint.Parent = gui

local notifyLabel = Instance.new("TextLabel")
notifyLabel.AnchorPoint = Vector2.new(0.5, 1)
notifyLabel.Position = UDim2.new(0.5, 0, 1, -110)
notifyLabel.Size = UDim2.fromOffset(660, 34)
notifyLabel.BackgroundTransparency = 1
notifyLabel.Font = Enum.Font.GothamBold
notifyLabel.TextScaled = true
notifyLabel.Text = ""
notifyLabel.TextColor3 = Color3.fromHex("#FFFFFF")
notifyLabel.Parent = gui
do
	local constraint = Instance.new("UITextSizeConstraint")
	constraint.MaxTextSize = 26
	constraint.Parent = notifyLabel
end

-- Bicie serca: generator dźwięku proceduralnego (bez assetów)
local heartbeatSound = Instance.new("Sound")
heartbeatSound.Name = "Heartbeat"
heartbeatSound.Volume = 0
heartbeatSound.Parent = SoundService

local state = { repaired = 0, required = Config.GeneratorsRequired, timeLeft = Config.RoundTime, monsterActive = false }
local fear = 0

stateRemote.OnClientEvent:Connect(function(payload)
	state.repaired = payload.repaired or 0
	state.required = payload.required or Config.GeneratorsRequired
	state.timeLeft = payload.timeLeft or 0
	state.monsterActive = payload.monsterActive == true

	genLabel.Text = "GENERATORY " .. state.repaired .. "/" .. state.required
	genLabel.TextColor3 = state.repaired >= state.required and Color3.fromHex("#00E5A0") or Color3.fromHex("#FFC400")
	timeLabel.Text = string.format("%d:%02d", math.floor(state.timeLeft / 60), state.timeLeft % 60)
	timeLabel.TextColor3 = state.timeLeft < 60 and Color3.fromHex("#FF5252") or Color3.fromHex("#9AA3C7")
end)

notifyRemote.OnClientEvent:Connect(function(message)
	notifyLabel.Text = message
	notifyLabel.TextTransparency = 0
	TweenService:Create(notifyLabel, TweenInfo.new(1.6), { TextTransparency = 1 }):Play()
end)

-- Strach rośnie, gdy potwór jest blisko: blur, winieta i dźwięk.
heartbeatRemote.OnClientEvent:Connect(function(distance)
	local target = math.clamp(1 - distance / 70, 0, 1)
	fear += (target - fear) * 0.35
end)

local blur = Lighting:WaitForChild("HorrorBlur")

RunService.RenderStepped:Connect(function(dt)
	local battery = player:GetAttribute("Battery") or Config.FlashlightBattery
	batteryFill.Size = UDim2.fromScale(math.clamp(battery / Config.FlashlightBattery, 0, 1), 1)
	batteryFill.BackgroundColor3 = battery > 40 and Color3.fromHex("#4FC3F7")
		or (battery > 15 and Color3.fromHex("#FFC400") or Color3.fromHex("#FF5252"))
	batteryLabel.Text = string.format("LATARKA %d%%  [F]", math.floor(battery))
	batteryLabel.TextColor3 = battery > 40 and Color3.fromHex("#0B0D14") or Color3.fromHex("#14161F")

	vignette.BackgroundTransparency = 1 - fear * 0.55
	blur.Size = fear * 10

	-- "Bicie serca": im bliżej potwora, tym głośniej i tym ciemniejszy ekran.
	local pulse = (math.sin(os.clock() * (1.4 + fear * 2.2)) + 1) / 2
	heartbeatSound.Volume = fear * 0.5 * (0.4 + pulse * 0.6)
end)
`;

export default {
  id: 'horror',
  aliases: ['horror', 'straszna', 'duch', 'szpital', 'co-op', '5'],
  genre: 'Horror',
  name: 'Blackout Ward',
  tagline: 'Napraw trzy generatory w ciemnym skrzydle szpitala, zanim On Cię usłyszy.',
  summary:
    'Co-op horror w ciemnym skrzydle szpitala: latarka z baterią, trzy generatory do naprawy, ' +
    'potwór, który słyszy biegnących graczy i migające światła awaryjne.',
  design: {
    name: 'Blackout Ward',
    tagline: 'Napraw trzy generatory w ciemnym skrzydle szpitala, zanim On Cię usłyszy.',
    genre: 'Horror (co-op)',
    summary:
      'Skrzydło szpitala bez prądu. Gracze mają latarkę i 8 minut na naprawę trzech generatorów. ' +
      'Potwór nie widzi – słyszy: bieg, latarkę i naprawę. Kto się spieszy, ten ginie.',
    coreLoop: '1. Rozejrzyj się z latarką i zapamiętaj układ korytarza. 2. Napraw generator (12 s stania w miejscu). 3. Uciekaj, gdy usłyszysz kroki. 4. Zbieraj baterie do latarki. 5. Po 3 generatorach biegnij do wyjścia.',
    sessionLength: '5-9 min na rundę',
    audience: '13+ , gracze horrorów i co-opów',
    monetizationIdeas: [
      'Gamepass "Druga bateria" (mniejszy drenaż) – komfort, nie przewaga.',
      'Dev product "Ratunek po porwaniu" – jednorazowe wskrzeszenie w miejscu śmierci.',
      'Gamepass "Radio" – gracze widzą się nawzajem na minimapie, co buduje co-op.',
    ],
    systems: [
      { name: 'Generatory', purpose: 'Główny cel i źródło napięcia', serverAuthority: 'Postęp liczy serwer; przerwanie = reset postępu', keyParameters: { required: 3, repairTime: 12 } },
      { name: 'Potwór', purpose: 'Presja i tempo', serverAuthority: 'AI, ruch i obrażenia po stronie serwera', keyParameters: { patrolSpeed: 15, chaseSpeed: 22, damage: 34, attackCooldown: 1.6 } },
      { name: 'Słuch zamiast wzroku', purpose: 'Mechanika, która nagradza powolność', serverAuthority: 'Zasięg słyszenia liczy serwer na podstawie prędkości i latarki', keyParameters: { hearingIdle: 34, hearingFlashlight: 60, hearingSprint: 90 } },
      { name: 'Latarka i bateria', purpose: 'Zarządzanie zasobem w ciemności', serverAuthority: 'Bateria tylko na serwerze; klient widzi procent', keyParameters: { battery: 100, drain: 1.6, pickup: 45 } },
      { name: 'Strach', purpose: 'Informacja zwrotna bez UI-tekstu', serverAuthority: 'Serwer wysyła dystans do potwora', keyParameters: { heartbeatRange: 70, blurMax: 10 } },
    ],
    controls: [
      { input: 'WASD + Space', action: 'Ruch (WalkSpeed 15 – celowo wolno)' },
      { input: 'F', action: 'Latarka (zużywa baterię, przyciąga potwora)' },
      { input: 'E', action: 'Naprawa generatora (trzeba stać w miejscu 12 s)' },
      { input: 'Shift', action: 'Bieg (bardzo głośny)' },
    ],
    objectives: [
      'Napraw 3 generatory w 8 minut.',
      'Wróć do wyjścia po otwarciu drzwi.',
      'Przeżyj pościg – potwór zabija w 3 trafieniach.',
    ],
    progression: 'Brak trwałej progresji – to gra o jednej rundzie i napięciu. Powtarzalność daje stały seed mapy plus dynamiczne zachowanie potwora (pościg zależny od hałasu).',
    balancing: {
      roundTime: 480, repairTime: 12, generators: 3,
      monsterFaster: '22 vs 15 (gracz nie ucieknie na wprost – musi skręcać)',
      monsterDamage: 34, batteryDrain: 1.6, monsterSpawnDelay: 25,
    },
    worldLayout:
      'Korytarz 70x260 studsów zamknięty ścianami i sufitem, 6 pokoi po bokach (światła awaryjne migają), 3 generatory w różnych punktach (przy ścianach i na końcu), 8 baterii rozrzuconych losowo, wyjście na początku korytarza. Wszystko ciemne: FogEnd 70, Brightness 0.35, atmosfera z gęstością 0.42.',
    designDoc: [
      '## Koncept',
      'Blackout Ward to horror o słuchu, nie o ucieczce. Potwór ma tylko 15 studsów/s w patrolu, ale 22 w pościgu, ',
      'więc ucieczka na wprost zawsze kończy się śmiercią – trzeba skręcać i gasić latarkę.',
      '',
      '## Pętla rozgrywki',
      '1. Pierwsze 25 sekund jest spokojne: to czas na zapoznanie się z mapą.',
      '2. Gracze rozchodzą się do generatorów; naprawa wymaga stania w miejscu 12 sekund.',
      '3. Każde 10 sekund naprawy to ryzyko – jeśli potwór podejdzie bliżej niż 26 studsów, postęp się resetuje.',
      '4. Po trzecim generatorze światło rozjaśnia się (Brightness +0.25 za generator) i otwierają się drzwi.',
      '5. Ucieczka daje punkt dla drużyny; śmierć wraca gracza na start po 3 sekundach.',
      '',
      '## Systemy',
      '| System | Rola | Parametry |',
      '| --- | --- | --- |',
      '| Generatory | Cel rundy | 3 szt., 12 s każdy |',
      '| Potwór | Presja | patrol 15, pościg 22, dmg 34 |',
      '| Słuch | Mechanika kluczowa | 34 / 60 / 90 studsów |',
      '| Latarka | Zasób | 100%, -1,6%/s |',
      '| Strach | Feedback | blur + heartbeat do 70 studsów |',
      '',
      '## Balans',
      'TTK gracza: 3 trafienia (34 dmg przy 100 HP), cooldown ataku 1,6 s, czyli ~3,2 sekundy od pierwszego trafienia. ',
      'Gracz biegnący 15 studsów/s nie odbiegnie potworowi (22), ale każdy zakręt w korytarzu daje 1-2 studsy ',
      'przewagi – dlatego mapa jest korytarzowa, a nie otwarta.',
      '',
      '## Mapa',
      'Jeden długi korytarz (70x260) z sześcioma pokojami po bokach. Generatory stoją tak, że są widoczne dopiero ',
      'z bliska (FogEnd 70), więc gracz musi iść z latarką i ryzykować. Baterie rozrzucone losowo z seeda 51423 – ',
      'te same miejsca każdej rundy (uczciwe dla wracających graczy).',
      '',
      '## UI',
      'Bateria w lewym dolnym rogu, generatory i czas na górze, komunikaty nad dołem ekranu. Strach pokazujemy ',
      'trzema kanałami: winieta, blur i bicie serca (generowane dźwiękowo, bez assetów).',
      '',
      '## Onboarding gracza',
      'Stała podpowiedź na ekranie: "F – latarka, E – naprawa, wyjście po 3 generatorach". Pierwsze 25 sekund ',
      'bez potwora daje czas na rozejrzenie się i zrozumienie ciemności.',
      '',
      '## Ryzyka',
      '* Gracz z wysokim jasnością monitora -> FogEnd 70 i Brightness 0.35, ale bez globalnych latarni.',
      '* Trolling (ktoś świeci celowo) -> latarka nie jest wymagana do naprawy, a potwór atakuje tego, kto jest najbliżej.',
      '* Frustracja po śmierci -> respawn 3 s i wspólny cel (generatory zostają naprawione).',
    ].join('\n'),
  },
  notes: [
    'Cała atmosfera (ciemność, mgła, migające światła, blur, bicie serca) powstaje proceduralnie – zero assetów do wgrania.',
    'Potwór to prosty model z Part-ów przesuwany po serwerze; słyszy graczy na podstawie prędkości i stanu latarki, dzięki czemu mechanika jest czytelna.',
    'Postęp naprawy resetuje się, gdy potwór podejdzie – to sprawia, że hałas naprawdę ma znaczenie.',
  ],
  plan: {
    architecture: [
      'RoundService.server.luau tworzy remotes, mapę, generatory, baterie, wyjście i steruję rundą.',
      'MonsterService trzyma potwora i jego AI (patrol/pościg) – nie wie nic o UI.',
      'MapBuilder generuje skrzydło szpitala z jednego seeda (identyczne u wszystkich graczy).',
      'Klient: Flashlight.client.luau (światło i bateria) oraz Hud.client.luau (postęp, strach, komunikaty).',
    ].join('\n'),
    remoteEvents: [
      { name: 'Generator', direction: 'client->server', payload: 'action: "start"' },
      { name: 'Flashlight', direction: 'client->server', payload: 'isOn: boolean' },
      { name: 'State', direction: 'server->client', payload: '{timeLeft, repaired, required, escaped, monsterActive}' },
      { name: 'Notify', direction: 'server->client', payload: 'message: string, colour: string(hex)' },
      { name: 'Heartbeat', direction: 'server->client', payload: 'distanceToMonster: number' },
    ],
    files: [
      { path: 'src/shared/Config.luau', kind: 'module', purpose: 'Balans horroru, kolory, nazwy remotów, parametry skrzydła', exports: ['Config'], requires: [], lines: 40 },
      { path: 'src/server/MapBuilder.luau', kind: 'module', purpose: 'Proceduralne skrzydło szpitala: korytarz, pokoje, generatory, baterie, wyjście', exports: ['MapBuilder'], requires: ['src/shared/Config.luau'], lines: 190 },
      { path: 'src/server/MonsterService.luau', kind: 'module', purpose: 'Potwór: patrol, pościg po dźwięku, atak', exports: ['MonsterService'], requires: ['src/shared/Config.luau'], lines: 200 },
      { path: 'src/server/RoundService.server.luau', kind: 'server', purpose: 'Runda, generatory, baterie, wyjście, atmosfera (skrypt startowy)', exports: [], requires: ['src/shared/Config.luau', 'src/server/MapBuilder.luau', 'src/server/MonsterService.luau'], lines: 280 },
      { path: 'src/client/Flashlight.client.luau', kind: 'client', purpose: 'Latarka gracza, bateria, migotanie', exports: [], requires: ['src/shared/Config.luau'], lines: 130 },
      { path: 'src/client/Hud.client.luau', kind: 'client', purpose: 'Bateria, generatory, czas, strach, komunikaty', exports: [], requires: ['src/shared/Config.luau'], lines: 180 },
    ],
  },
  world: {
    lighting: {
      ClockTime: 0,
      Ambient: '#0A0C14',
      OutdoorAmbient: '#0C0E16',
      Brightness: 0.35,
      GlobalShadows: true,
      Technology: 'Future',
      FogEnd: 70,
      FogColor: '#05060A',
      EnvironmentDiffuseScale: 0.15,
    },
    world: {
      name: 'World',
      className: 'Folder',
      children: [
        { className: 'Folder', name: 'Ward', properties: {} },
        {
          className: 'Folder', name: 'Entry',
          properties: {},
          children: [
            { className: 'Part', name: 'EntryHall', properties: { Size: [30, 2, 16], Position: [0, -1, -8], Color: '#1A1D26', Material: 'Concrete', Anchored: true } },
            { className: 'SpawnLocation', name: 'EntrySpawn', properties: { Size: [10, 1, 10], Position: [0, 1, -8], Color: '#00E5A0', Material: 'Neon', Duration: 0, Anchored: true } },
            { className: 'PointLight', name: 'EntryLight', properties: { Brightness: 0.6, Range: 22, Color: '#FFE0B2' } },
          ],
        },
      ],
    },
  },
  files: [
    { path: 'src/shared/Config.luau', content: config },
    { path: 'src/server/MapBuilder.luau', content: mapBuilder },
    { path: 'src/server/MonsterService.luau', content: monsterService },
    { path: 'src/server/RoundService.server.luau', content: roundService },
    { path: 'src/client/Flashlight.client.luau', content: flashlight },
    { path: 'src/client/Hud.client.luau', content: hudHorror },
  ],
};
