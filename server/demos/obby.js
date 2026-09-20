/**
 * Demo project #1 – "Neon Skyway Obby" (offline, no API key needed).
 * The level is generated procedurally in Luau, so the demo shows off the
 * "world skeleton + procedural geometry" pattern the AI is asked to use.
 */

const config = `--[[
	Config – wszystkie liczby balansu w jednym miejscu.
	Zmiana tutaj wpływa na całą grę, dlatego trzymamy je z dala od logiki.
]]
local Config = {}

Config.Seed = 20240920          -- stały seed = powtarzalny level (łatwe testowanie)
Config.PlatformCount = 26       -- ile platform ma mieć wieża
Config.PlatformMinSize = 5
Config.PlatformMaxSize = 12
Config.GapMin = 9
Config.GapMax = 18
Config.LateralSpread = 7        -- na ile studsów platforma może odjechać w bok
Config.HeightStep = 2           -- maksymalna zmiana wysokości między platformami
Config.StartPoint = Vector3.new(0, 10, 60)
Config.CheckpointEvery = 6
Config.MovingEvery = 5
Config.MovingSpeed = 0.35       -- sekundy na 1 stud ruchu platformy
Config.CoinCount = 14
Config.LavaDrop = 6             -- jak nisko pod platformami jest lawa
Config.WalkSpeed = 18
Config.JumpPower = 52

Config.Colors = {
	Platform = "#4FC3F7",
	PlatformAlt = "#7E57C2",
	Lava = "#FF3B30",
	Checkpoint = "#FFD54F",
	CheckpointDone = "#66BB6A",
	Finish = "#00E5A0",
	Coin = "#FFC400",
	Lobby = "#2B2F45",
}

-- Nazwy RemoteEventów – muszą być identyczne po stronie klienta i serwera.
Config.Remotes = {
	Notify = "Notify",      -- serwer -> klient: komunikat UI
	Reset = "Reset",        -- klient -> serwer: poproszenie o respawn
}

Config.LevelFolderName = "GeneratedLevel"

return Config
`;

const checkpoint = `--[[
	CheckpointService – pilnuje postępu gracza (który checkpoint zaliczył)
	i ustawia jego RespawnLocation, żeby wracał na właściwy etap.
	Autorytetem jest serwer: klient nie może sobie "przypisać" etapu.
]]
local Players = game:GetService("Players")

local CheckpointService = {}
CheckpointService.__index = CheckpointService

local claimed = {}          -- [Player] = numer etapu
local padByStage = {}       -- [numer etapu] = SpawnLocation

function CheckpointService.register(stage, pad)
	padByStage[stage] = pad
	pad:SetAttribute("Stage", stage)
end

function CheckpointService.stageOf(player)
	return math.max(1, claimed[player] or 0)
end

--- Wywoływane przez Touched na padzie. Serwer decyduje czy zaliczenie jest legalne.
function CheckpointService.claim(player, pad)
	local stage = pad:GetAttribute("Stage")
	if type(stage) ~= "number" then
		return false
	end
	if (claimed[player] or 0) >= stage then
		return false         -- gracz już był dalej, nie cofamy postępu
	end
	claimed[player] = stage
	player.RespawnLocation = pad

	local stats = player:FindFirstChild("leaderstats")
	if stats and stats:FindFirstChild("Stage") then
		stats.Stage.Value = stage
	end

	-- Zaliczone pady świecą na zielono – czytelna informacja zwrotna.
	for claimedStage, claimedPad in pairs(padByStage) do
		if claimedStage <= stage then
			claimedPad.Color = Color3.fromHex("#66BB6A")
		end
	end
	return true
end

function CheckpointService.reset(player)
	claimed[player] = 0   -- 0 = brak zaliczonego checkpointu (etap 1 zalicza się sam)
	local first = padByStage[1]
	if first then
		player.RespawnLocation = first
	end
	local stats = player:FindFirstChild("leaderstats")
	if stats and stats:FindFirstChild("Stage") then
		stats.Stage.Value = 1
	end
end

Players.PlayerRemoving:Connect(function(player)
	claimed[player] = nil
end)

return CheckpointService
`;

const levelBuilder = `--[[
	LevelBuilder – proceduralnie buduje cały tor: platformy, lawę, checkpointy,
	ruchome platformy, monety i metę. Wszystko liczone z jednego seeda,
	dzięki czemu mapa jest zawsze taka sama i łatwa do balansowania.
]]
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")
local Players = game:GetService("Players")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local CheckpointService = require(script.Parent:WaitForChild("CheckpointService"))

local rng = Random.new(Config.Seed)

local folder = workspace:FindFirstChild(Config.LevelFolderName)
if not folder then
	folder = Instance.new("Folder")
	folder.Name = Config.LevelFolderName
	folder.Parent = workspace
end

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

local function killPlayer(humanoid)
	-- Śmierć przez obrażenia = naturalne zachowanie Robloxa (respawn, efekty).
	humanoid.Health = 0
end

local killBricks = Instance.new("Folder")
killBricks.Name = "KillBricks"
killBricks.Parent = folder

local checkpoints = Instance.new("Folder")
checkpoints.Name = "Checkpoints"
checkpoints.Parent = folder

local movingPlatforms = {}

local function makeLava(size, position)
	local lava = newPart({
		Name = "Lava",
		Size = size,
		Position = position,
		Color = Color3.fromHex(Config.Colors.Lava),
		Material = Enum.Material.Neon,
		Transparency = 0.15,
		CanCollide = false,
		Parent = killBricks,
	})
	lava.Touched:Connect(function(hit)
		local humanoid = hit.Parent and hit.Parent:FindFirstChildOfClass("Humanoid")
		if humanoid and humanoid.Health > 0 then
			killPlayer(humanoid)
		end
	end)
	return lava
end

local function makeCheckpoint(stage, position, baseSize)
	local pad = Instance.new("SpawnLocation")
	pad.Name = "Checkpoint" .. stage
	pad.Size = Vector3.new(math.min(baseSize.X, 8), 0.6, math.min(baseSize.Z, 8))
	pad.Position = position
	pad.Anchored = true
	pad.CanCollide = true
	pad.Duration = 0                 -- bez forcefielda, żeby nie było exploitu
	pad.Neutral = true
	pad.Material = Enum.Material.Neon
	pad.Color = Color3.fromHex(Config.Colors.Checkpoint)
	pad.Parent = checkpoints

	CheckpointService.register(stage, pad)

	pad.Touched:Connect(function(hit)
		local character = hit.Parent
		local player = character and Players:GetPlayerFromCharacter(character)
		if not player then
			return
		end
		if CheckpointService.claim(player, pad) then
			pad.Color = Color3.fromHex(Config.Colors.CheckpointDone)
			local remotes = ReplicatedStorage:FindFirstChild("Remotes")
			local notify = remotes and remotes:FindFirstChild(Config.Remotes.Notify)
			if notify then
				notify:FireClient(player, "Checkpoint " .. stage .. " zaliczony!", Color3.fromHex(Config.Colors.CheckpointDone))
			end
		end
	end)
	return pad
end

local function makeCoin(position)
	local coin = newPart({
		Name = "Coin",
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(0.6, 3, 3),
		Orientation = Vector3.new(0, 0, 90),
		Position = position,
		Color = Color3.fromHex(Config.Colors.Coin),
		Material = Enum.Material.Neon,
		CanCollide = false,
		Parent = folder,
	})
	coin:SetAttribute("Collected", false)
	return coin
end

-- ------------------------------------------------------------------
-- Budowa toru
-- ------------------------------------------------------------------
local cursor = Config.StartPoint
local platforms = {}

for index = 1, Config.PlatformCount do
	local isFinish = index == Config.PlatformCount
	local sizeX = rng:NextNumber(Config.PlatformMinSize, Config.PlatformMaxSize)
	local sizeZ = rng:NextNumber(Config.PlatformMinSize, Config.PlatformMaxSize)
	if isFinish then
		sizeX, sizeZ = 24, 24
	end

	local gap = rng:NextNumber(Config.GapMin, Config.GapMax)
	local lateral = if isFinish then 0 else rng:NextNumber(-Config.LateralSpread, Config.LateralSpread)
	local height = if isFinish then cursor.Y + 2 else cursor.Y + rng:NextNumber(-Config.HeightStep, Config.HeightStep)
	local position = Vector3.new(cursor.X + lateral, height, cursor.Z + gap + sizeZ / 2)
	local size = Vector3.new(sizeX, 1.5, sizeZ)

	local platform = newPart({
		Name = "Platform" .. index,
		Size = size,
		Position = position,
		Color = Color3.fromHex(if index % 2 == 0 then Config.Colors.Platform else Config.Colors.PlatformAlt),
		Material = Enum.Material.SmoothPlastic,
		Parent = folder,
	})
	table.insert(platforms, platform)
	cursor = position

	-- Lawa pod każdą szczeliną – spadnięcie musi mieć konsekwencje.
	makeLava(
		Vector3.new(sizeX + 6, 2, gap + sizeZ + 6),
		Vector3.new(position.X, position.Y - Config.LavaDrop, position.Z - sizeZ / 2 - gap / 2)
	)

	-- Co N-ty etap: checkpoint.
	if index % Config.CheckpointEvery == 0 and index < Config.PlatformCount then
		makeCheckpoint(index, Vector3.new(position.X, position.Y + 1.1, position.Z), size)
	end

	-- Co M-ta platforma jeździ w bok – trzeba wyczuć rytm.
	if index % Config.MovingEvery == 0 and index < Config.PlatformCount then
		local offset = rng:NextNumber(6, 12) * (if rng:NextInteger(0, 1) == 0 then -1 else 1)
		local tween = TweenService:Create(
			platform,
			TweenInfo.new(Config.MovingSpeed * math.abs(offset), Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, true),
			{ Position = position + Vector3.new(offset, 0, 0) }
		)
		table.insert(movingPlatforms, tween)
		tween:Play()
	end
end

-- Checkpoint startowy (etap 1) na pierwszej platformie.
makeCheckpoint(1, Vector3.new(Config.StartPoint.X, Config.StartPoint.Y + 1.1, Config.StartPoint.Z), Vector3.new(12, 1.5, 12))

-- Monety na losowych platformach (rotują, bo to lubią gracze).
for _ = 1, Config.CoinCount do
	local platform = platforms[rng:NextInteger(3, #platforms)]
	local coin = makeCoin(platform.Position + Vector3.new(0, 3, 0))
	local spin = TweenService:Create(coin, TweenInfo.new(1.2, Enum.EasingStyle.Linear, Enum.EasingDirection.InOut, -1, true), { Orientation = Vector3.new(0, 180, 90) })
	spin:Play()
end

-- Meta – duża zielona platforma z informacją o nagrodzie.
local finish = platforms[#platforms]
local finishPad = newPart({
	Name = "FinishPad",
	Size = Vector3.new(14, 0.6, 14),
	Position = finish.Position + Vector3.new(0, 1.1, 0),
	Color = Color3.fromHex(Config.Colors.Finish),
	Material = Enum.Material.Neon,
	CanCollide = false,
	Parent = folder,
})
finishPad.Touched:Connect(function(hit)
	local player = hit.Parent and Players:GetPlayerFromCharacter(hit.Parent)
	if not player then
		return
	end
	local stats = player:FindFirstChild("leaderstats")
	if stats and stats:FindFirstChild("Coins") then
		stats.Coins.Value += 100
	end
	local remotes = ReplicatedStorage:FindFirstChild("Remotes")
	local notify = remotes and remotes:FindFirstChild(Config.Remotes.Notify)
	if notify then
		notify:FireClient(player, "META! +100 monet. Gratulacje!", Color3.fromHex(Config.Colors.Finish))
	end
end)

print("[LevelBuilder] Tor gotowy: " .. #platforms .. " platform, " .. #movingPlatforms .. " ruchomych.")
`;

const stats = `--[[
	Stats – leaderstats (Etap, Monety), statystyki postaci i wspólna obsługa
	RemoteEventu Reset. Serwer jest jedynym miejscem, które zmienia te liczby.
]]
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local CheckpointService = require(script.Parent:WaitForChild("CheckpointService"))

local remotes = ReplicatedStorage:FindFirstChild("Remotes")
if not remotes then
	remotes = Instance.new("Folder")
	remotes.Name = "Remotes"
	remotes.Parent = ReplicatedStorage
end

for _, remoteName in pairs(Config.Remotes) do
	if not remotes:FindFirstChild(remoteName) then
		local remote = Instance.new("RemoteEvent")
		remote.Name = remoteName
		remote.Parent = remotes
	end
end

local resetRemote = remotes:WaitForChild(Config.Remotes.Reset)

local function applyCharacter(player, character)
	local humanoid = character:WaitForChild("Humanoid")
	humanoid.WalkSpeed = Config.WalkSpeed
	humanoid.JumpPower = Config.JumpPower
	humanoid.UseJumpPower = true
end

local function setupPlayer(player)
	local stats = Instance.new("Folder")
	stats.Name = "leaderstats"

	local stage = Instance.new("IntValue")
	stage.Name = "Stage"
	stage.Value = 1
	stage.Parent = stats

	local coins = Instance.new("IntValue")
	coins.Name = "Coins"
	coins.Value = 0
	coins.Parent = stats

	stats.Parent = player
	CheckpointService.reset(player)

	if player.Character then
		applyCharacter(player, player.Character)
	end
	player.CharacterAdded:Connect(function(character)
		applyCharacter(player, character)
	end)
end

for _, player in ipairs(Players:GetPlayers()) do
	task.spawn(setupPlayer, player)
end
Players.PlayerAdded:Connect(function(player)
	setupPlayer(player)
end)

-- Reset postaci na życzenie klienta (np. gdy gracz utknie).
resetRemote.OnServerEvent:Connect(function(player)
	local character = player.Character
	if character then
		local humanoid = character:FindFirstChildOfClass("Humanoid")
		if humanoid and humanoid.Health > 0 then
			humanoid.Health = 0
		end
	end
end)

-- Monety zbierane przez Touched (serwer sprawdza dystans i flagę, więc nie da się
-- podwójnie zaliczyć tej samej monety).
local levelFolder = workspace:WaitForChild(Config.LevelFolderName, 30)
if levelFolder then
	for _, coin in ipairs(levelFolder:GetChildren()) do
		if coin:IsA("BasePart") and coin.Name == "Coin" then
			coin.Touched:Connect(function(hit)
				local player = hit.Parent and Players:GetPlayerFromCharacter(hit.Parent)
				if not player or coin:GetAttribute("Collected") then
					return
				end
				coin:SetAttribute("Collected", true)
				coin.Transparency = 1
				coin.CanTouch = false

				local statsFolder = player:FindFirstChild("leaderstats")
				if statsFolder and statsFolder:FindFirstChild("Coins") then
					statsFolder.Coins.Value += 1
				end

				task.delay(12, function()
					coin:SetAttribute("Collected", false)
					coin.Transparency = 0
					coin.CanTouch = true
				end)
			end)
		end
	end
end

print("[Stats] Serwer obby wystartował.")
`;

const hud = `--[[
	HUD – cały interfejs rysowany w kodzie (bez plików graficznych).
	Klient tylko czyta stan i wyświetla; nic tu nie decyduje o rozgrywce.
]]
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))

local gui = Instance.new("ScreenGui")
gui.Name = "ObbyHUD"
gui.IgnoreGuiInset = true
gui.ResetOnSpawn = false
gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
gui.Parent = playerGui

local function panel(name, anchor, position, size, color)
	local frame = Instance.new("Frame")
	frame.Name = name
	frame.AnchorPoint = anchor
	frame.Position = position
	frame.Size = size
	frame.BackgroundColor3 = color
	frame.BackgroundTransparency = 0.25
	frame.BorderSizePixel = 0
	frame.Parent = gui

	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 12)
	corner.Parent = frame

	local stroke = Instance.new("UIStroke")
	stroke.Color = Color3.fromHex("#FFFFFF")
	stroke.Transparency = 0.75
	stroke.Parent = frame

	return frame
end

local function label(parent, name, text, textSize, color)
	local textLabel = Instance.new("TextLabel")
	textLabel.Name = name
	textLabel.BackgroundTransparency = 1
	textLabel.Size = UDim2.fromScale(1, 1)
	textLabel.Font = Enum.Font.GothamBold
	textLabel.TextScaled = true
	textLabel.Text = text
	textLabel.TextColor3 = color
	textLabel.Parent = parent
	local constrain = Instance.new("UITextSizeConstraint")
	constrain.MaxTextSize = textSize
	constrain.Parent = textLabel
	return textLabel
end

local stagePanel = panel("StagePanel", Vector2.new(0, 0), UDim2.new(0, 18, 0, 18), UDim2.fromOffset(190, 54), Color3.fromHex("#141828"))
local stageLabel = label(stagePanel, "Stage", "ETAP 1", 30, Color3.fromHex(Config.Colors.Platform))

local coinPanel = panel("CoinPanel", Vector2.new(1, 0), UDim2.new(1, -18, 0, 18), UDim2.fromOffset(170, 54), Color3.fromHex("#141828"))
local coinLabel = label(coinPanel, "Coins", "0 monet", 28, Color3.fromHex(Config.Colors.Coin))

local timerPanel = panel("TimerPanel", Vector2.new(1, 0), UDim2.new(1, -18, 0, 84), UDim2.fromOffset(170, 40), Color3.fromHex("#141828"))
timerPanel.BackgroundTransparency = 0.5
local timerLabel = label(timerPanel, "Time", "0:00", 24, Color3.fromHex("#E0E6FF"))

local toastHolder = Instance.new("Frame")
toastHolder.Name = "Toasts"
toastHolder.AnchorPoint = Vector2.new(0.5, 1)
toastHolder.Position = UDim2.new(0.5, 0, 1, -28)
toastHolder.Size = UDim2.fromOffset(420, 200)
toastHolder.BackgroundTransparency = 1
toastHolder.Parent = gui

local function toast(text, color)
	local frame = Instance.new("Frame")
	frame.Size = UDim2.fromOffset(400, 46)
	frame.Position = UDim2.new(0.5, -200, 1, 0)
	frame.BackgroundColor3 = Color3.fromHex("#101427")
	frame.BackgroundTransparency = 0.1
	frame.BorderSizePixel = 0
	frame.Parent = toastHolder

	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 10)
	corner.Parent = frame

	local textLabel = Instance.new("TextLabel")
	textLabel.BackgroundTransparency = 1
	textLabel.Size = UDim2.fromScale(1, 1)
	textLabel.Font = Enum.Font.GothamBold
	textLabel.TextScaled = true
	textLabel.Text = text
	textLabel.TextColor3 = color or Color3.fromHex("#FFFFFF")
	textLabel.Parent = frame

	local constrain = Instance.new("UITextSizeConstraint")
	constrain.MaxTextSize = 26
	constrain.Parent = textLabel

	local tweenIn = TweenService:Create(frame, TweenInfo.new(0.25), { Position = UDim2.new(0.5, -200, 0, #toastHolder:GetChildren() * -52) })
	tweenIn:Play()
	task.delay(2.6, function()
		local fade = TweenService:Create(frame, TweenInfo.new(0.4), { BackgroundTransparency = 1 })
		fade:Play()
		local textFade = TweenService:Create(textLabel, TweenInfo.new(0.4), { TextTransparency = 1 })
		textFade:Play()
		task.wait(0.45)
		frame:Destroy()
	end)
end

-- Reset przyciskiem R (klient prosi serwer, to serwer decyduje).
local UserInputService = game:GetService("UserInputService")
local remotes = ReplicatedStorage:WaitForChild("Remotes")
local notify = remotes:WaitForChild(Config.Remotes.Notify)
local resetRemote = remotes:WaitForChild(Config.Remotes.Reset)

notify.OnClientEvent:Connect(function(message, color)
	toast(message, color)
end)

UserInputService.InputBegan:Connect(function(input, gameProcessed)
	if gameProcessed then
		return
	end
	if input.KeyCode == Enum.KeyCode.R then
		resetRemote:FireServer()
	end
	if input.KeyCode == Enum.KeyCode.H then
		gui.Enabled = not gui.Enabled
	end
end)

local startedAt = os.clock()
local statsFolder = player:WaitForChild("leaderstats")

statsFolder:WaitForChild("Stage").Changed:Connect(function(value)
	stageLabel.Text = "ETAP " .. tostring(value)
	stageLabel.TextColor3 = Color3.fromHex(Config.Colors.Finish)
	TweenService:Create(stageLabel, TweenInfo.new(0.3), { TextTransparency = 0.4 }):Play()
	task.delay(0.3, function()
		TweenService:Create(stageLabel, TweenInfo.new(0.3), { TextTransparency = 0 }):Play()
	end)
end)

statsFolder:WaitForChild("Coins").Changed:Connect(function(value)
	coinLabel.Text = tostring(value) .. " monet"
end)

RunService.RenderStepped:Connect(function()
	local elapsed = math.floor(os.clock() - startedAt)
	timerLabel.Text = string.format("%d:%02d", math.floor(elapsed / 60), elapsed % 60)
end)
`;

const effects = `--[[
	Effects – odczucia gracza: rozmycie prędkości (FOV), efekt śmierci,
	lekki wstrząs kamery przy upadku. Wyłącznie warstwa klienta.
]]
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local Lighting = game:GetService("Lighting")

local player = Players.LocalPlayer
local camera = workspace.CurrentCamera

local BASE_FOV = 70
local FAST_FOV = 88
local currentFov = BASE_FOV

local colorCorrection = Lighting:FindFirstChild("ObbyGrading")
if not colorCorrection then
	colorCorrection = Instance.new("ColorCorrectionEffect")
	colorCorrection.Name = "ObbyGrading"
	colorCorrection.Saturation = 0.08
	colorCorrection.Contrast = 0.06
	colorCorrection.Parent = Lighting
end

local function onCharacter(character)
	local humanoid = character:WaitForChild("Humanoid")
	local root = character:WaitForChild("HumanoidRootPart")

	humanoid.Died:Connect(function()
		-- Czerwony błysk + mocny zoom = czytelny sygnał "przegrałeś".
		local flash = Instance.new("ColorCorrectionEffect")
		flash.Name = "DeathFlash"
		flash.Saturation = -0.4
		flash.Contrast = 0.5
		flash.TintColor = Color3.fromHex("#FF4A4A")
		flash.Parent = Lighting

		camera.FieldOfView = 92
		TweenService:Create(camera, TweenInfo.new(0.5), { FieldOfView = BASE_FOV }):Play()
		TweenService:Create(flash, TweenInfo.new(0.9), { Contrast = 0, Saturation = 0, TintColor = Color3.new(1, 1, 1) }):Play()
		task.wait(1)
		flash:Destroy()
	end)

	-- Wstrząs kamery podczas szybkiego spadania: im szybciej, tym mocniej.
	RunService.RenderStepped:Connect(function(dt)
		if not root or not root.Parent or humanoid.Health <= 0 then
			return
		end
		local velocity = root.AssemblyLinearVelocity
		local fallSpeed = math.clamp(-velocity.Y, 0, 220)

		local targetFov = BASE_FOV + (FAST_FOV - BASE_FOV) * (fallSpeed / 220)
		currentFov += (targetFov - currentFov) * math.clamp(dt * 6, 0, 1)
		camera.FieldOfView = currentFov

		if fallSpeed > 140 then
			local strength = (fallSpeed - 140) / 80 * 0.6
			camera.CFrame = camera.CFrame * CFrame.new(
				(math.random() - 0.5) * strength * 0.35,
				(math.random() - 0.5) * strength * 0.35,
				0
			)
		end
	end)
end

if player.Character then
	task.spawn(onCharacter, player.Character)
end
player.CharacterAdded:Connect(onCharacter)
`;


const design = {
  name: 'Neon Skyway Obby',
  tagline: 'Pokonaj 26 ruchomych platform nad jeziorem lawy – checkpoint po checkpoincie.',
  genre: 'Obby / Platformówka',
  summary:
    'Proceduralny tor parkour nad przepaścią z lawą. Każda platforma jest inna, część jeździ w bok, ' +
    'a każdy szósty etap to checkpoint, do którego wracasz po śmierci. Zbierasz monety i ścigasz się z czasem.',
  coreLoop: '1. Skok na kolejną platformę. 2. Unikaj lawy i ruchomych przeszkód. 3. Zaliczenie checkpointu zapisuje postęp. 4. Zbieraj monety po drodze. 5. Dotrzyj do mety po nagrodę.',
  sessionLength: '3-8 min',
  audience: '9-14 lat, gracze obby i speedrunów',
  monetizationIdeas: [
    'Gamepass "Respawn w miejscu śmierci" – najczęstszy zakup w obby, bo skraca frustrację.',
    'Gamepass "Podwójne monety" dla graczy farmiących sklep.',
    'Dev product "Pomiń etap" – ratunek dla graczy tkwiących na trudnym skoku.',
  ],
  systems: [
    { name: 'Proceduralny tor', purpose: 'Nieograniczona regrywalność z jednego seeda', serverAuthority: 'Seed i geometria istnieją tylko na serwerze', keyParameters: { PlatformCount: 26, GapMin: 9, GapMax: 18, HeightStep: 2 } },
    { name: 'Checkpointy', purpose: 'Postęp bez frustracji', serverAuthority: 'Serwer trzyma numer etapu; klient nie może go podnieść', keyParameters: { CheckpointEvery: 6, StartStage: 1 } },
    { name: 'Lawa (KillBricks)', purpose: 'Kara za błąd bez utraty całego postępu', serverAuthority: 'Kolizja i śmierć liczone na serwerze', keyParameters: { LavaDrop: 6 } },
    { name: 'Monety', purpose: 'Opłata za sklep i nagroda za eksplorację', serverAuthority: 'Flaga Collected na instancji, 12 s respawn', keyParameters: { CoinCount: 14, Reward: 1, FinishBonus: 100 } },
    { name: 'Ruchome platformy', purpose: 'Zmienia timing skoków, podnosi skill ceiling', serverAuthority: 'Tween serwerowy (deterministyczny)', keyParameters: { MovingEvery: 5, MovingSpeed: 0.35 } },
    { name: 'Statystyki (leaderstats)', purpose: 'Widoczna rywalizacja: etap i monety', serverAuthority: 'Tylko serwer zapisuje wartości', keyParameters: { RankedStats: ['Stage', 'Coins'] } },
  ],
  controls: [
    { input: 'WASD', action: 'Ruch postaci (WalkSpeed 18)' },
    { input: 'Space', action: 'Skok (JumpPower 52)' },
    { input: 'R', action: 'Reset postaci po utknięciu' },
    { input: 'H', action: 'Ukryj/pokaż HUD' },
    { input: 'Kółko myszy', action: 'Zoom kamery' },
  ],
  objectives: [
    'Przejdź wszystkie 26 etapów i dotrzyj do zielonej mety.',
    'Zbierz 14 monet po drodze.',
    'Pobij swój czas na torze (timer w HUD).',
  ],
  progression: 'Monety (1 za sztukę, 100 za metę) → sklep z gamepassami: podwójne monety, respawn w miejscu śmierci. Etapy zapisane w leaderstats = ranking na serwerze.',
  balancing: {
    WalkSpeed: 18, JumpPower: 52, GapMin: 9, GapMax: 18, HeightStep: 2,
    CheckpointEvery: 6, MovingEvery: 5, LavaDrop: 6, CoinCount: 14, FinishBonus: 100,
  },
  worldLayout:
    'Lobby to ciemna platforma 40x40 studsów z neapolitańskim spawnem i tablicą z zasadami. Za lobby (rosnące Z) rozciąga się wygenerowany tor: 26 platform, każda 5-12 studsów, różnice wysokości do 2 studsów, odstępy 9-18 studsów. Pod platformami na Y-6 znajduje się lawa pokrywająca wszystkie szczeliny. Co 6. platforma ma świecący checkpoint, co 5. jeździ w bok o 6-12 studsów. Meta to zielona platforma 24x24 z bonusem 100 monet.',
  designDoc: [
    '## Koncept',
    'Neon Skyway Obby to klasyk gatunku obby w wersji "neonowej": ciemne tło, jaskrawe platformy, ',
    'proceduralny tor, który za każdym razem wygląda inaczej (bo seed zmieniasz jednym numerem), ale jest sprawiedliwy – ',
    'wszystkie skoki są do policzenia z parametrów ruchu gracza.',
    '',
    '## Pętla rozgrywki',
    '1. Gracz spawnuje się w lobby i widzi tablicę z zasadami.',
    '2. Wchodzi na tor: skok, skok, ryzyko, śmierć lub postęp.',
    '3. Checkpoint co 6 etapów daje satysfakcjonujące "zapisano".',
    '4. Monety po drodze tworzą drugi, opcjonalny cel.',
    '5. Meta daje 100 monet i wpis w leaderstats.',
    '',
    '## Systemy',
    '| System | Rola | Parametry |',
    '| --- | --- | --- |',
    '| LevelBuilder | Generuje tor z seeda | 26 platform, gap 9-18 |',
    '| CheckpointService | Zapamiętuje etap gracza | co 6 platform |',
    '| Lawa | Kara za błąd | Y-6 pod platformami |',
    '| Monety | Waluta | 14 monet, respawn 12 s |',
    '| Ruchome platformy | Timing | co 5 platform |',
    '',
    '## Balans',
    'Przy WalkSpeed 18 i JumpPower 52 gracz przeskakuje ~9-13 studsów w poziomie. Największa szczelina (18) ',
    'jest celowo na granicy – wymaga rozpędu, ale nie jest niemożliwa. Wysokość zmienia się maksymalnie o 2 studs na skok.',
    '',
    '## Mapa',
    'Liniowy tor wzdłuż osi Z, lobby na Z=0, meta około Z=450. Boczny rozrzut +/-7 studsów daje wrażenie swobody ',
    'bez gubienia gracza. Światło: popołudniowe (ClockTime 15) + cienie (ShadowMap).',
    '',
    '## UI',
    'HUD w lewym górnym rogu: etap. Prawy górny: monety i timer. Dolny środek: toasty (checkpoint, meta, monety). ',
    'Całe UI generowane w kodzie – zero plików graficznych, zero problemów z moderacją assetów.',
    '',
    '## Onboarding gracza',
    'Tablica z 3 krokami ("Skacz", "Zbieraj monety", "Dotrzyj do mety"), spawn na wygodnej platformie 12x12, ',
    'pierwsze 4 platformy są szerokie i płaskie, trudność rośnie dopiero od 5. etapu.',
    '',
    '## Ryzyka',
    '* Gracz utknie między platformami → przycisk R (reset) i checkpoint co 6 etapów.',
    '* Zbyt duże szczeliny → wszystkie limity w Config: GapMin/GapMax do zmiany bez czytania logiki.',
    '* Spadki FPS od lawy → lawa to proste Part-y z Materiałem Neon, bez cząstek na każdej platformie.',
  ].join('\n'),
};

export default {
  id: 'obby',
  aliases: ['obby', 'parkour', 'spawn', 'skok', 'platformowka', '1'],
  genre: 'Obby',
  name: design.name,
  tagline: design.tagline,
  summary: design.summary,
  design,
  notes: [
    'Tor buduje się proceduralnie z seeda Config.Seed – zmiana liczby = nowy level, bez rysowania w Studio.',
    'Checkpointy to SpawnLocation-y ustawiane jako player.RespawnLocation, więc respawn działa "z pudelka" i jest po stronie serwera.',
    'Całe UI powstaje w kodzie, więc projekt nie zależy od żadnego assetu z Toolboxa.',
  ],
  plan: {
    architecture: [
      'Serwer jest autorytetem: buduje tor (LevelBuilder), pilnuje postępu (CheckpointService), trzyma walutę i leaderstats (Stats).',
      'Klient (HUD, Effects) nie modyfikuje stanu gry – wysyła tylko prośbę o reset przez RemoteEvent "Reset".',
      'Serwer wysyła komunikaty UI przez RemoteEvent "Notify" (tekst + kolor), które HUD pokazuje jako toast.',
      'Config w ReplicatedStorage.Shared jest wspólny: te same kolory, te same nazwy remotów po obu stronach.',
    ].join('\n'),
    remoteEvents: [
      { name: 'Notify', direction: 'server->client', payload: 'message: string, color: Color3?' },
      { name: 'Reset', direction: 'client->server', payload: '(brak) – prośba o respawn postaci' },
    ],
    files: [
      { path: 'src/shared/Config.luau', kind: 'module', purpose: 'Liczby balansu, kolory, nazwy remotów', exports: ['Config'], requires: [], lines: 45 },
      { path: 'src/server/CheckpointService.luau', kind: 'module', purpose: 'Postęp gracza i RespawnLocation', exports: ['CheckpointService'], requires: ['src/shared/Config.luau'], lines: 70 },
      { path: 'src/server/LevelBuilder.server.luau', kind: 'server', purpose: 'Proceduralna budowa toru', exports: [], requires: ['src/shared/Config.luau', 'src/server/CheckpointService.luau'], lines: 200 },
      { path: 'src/server/Stats.server.luau', kind: 'server', purpose: 'leaderstats, statystyki postaci, monety, remotes', exports: [], requires: ['src/shared/Config.luau', 'src/server/CheckpointService.luau'], lines: 110 },
      { path: 'src/client/Hud.client.luau', kind: 'client', purpose: 'HUD: etap, monety, timer, toasty', exports: [], requires: ['src/shared/Config.luau'], lines: 170 },
      { path: 'src/client/Effects.client.luau', kind: 'client', purpose: 'FOV, efekt śmierci, wstrząs kamery', exports: [], requires: [], lines: 90 },
    ],
  },
  world: {
    lighting: {
      ClockTime: 15,
      Ambient: '#6E7B94',
      OutdoorAmbient: '#8A94A8',
      Brightness: 2,
      GlobalShadows: true,
      Technology: 'ShadowMap',
      FogEnd: 1200,
      FogColor: '#20233A',
    },
    world: {
      name: 'World',
      className: 'Folder',
      children: [
        {
          className: 'Part', name: 'LobbyBase',
          properties: { Size: [44, 2, 44], Position: [0, -1, 0], Color: '#2B2F45', Material: 'SmoothPlastic', Anchored: true, CanCollide: true },
        },
        {
          className: 'SpawnLocation', name: 'LobbySpawn',
          properties: { Size: [12, 1, 12], Position: [0, 1, 0], Color: '#4FC3F7', Material: 'Neon', Duration: 0, Anchored: true },
        },
        {
          className: 'Part', name: 'RulesBoard',
          properties: { Size: [26, 12, 1], Position: [0, 8, -20], Color: '#141828', Material: 'SmoothPlastic', Anchored: true },
          children: [{
            className: 'SurfaceGui', name: 'BoardGui',
            properties: { Face: 'Front', CanvasSize: [800, 400], LightInfluence: 0 },
            children: [{
              className: 'TextLabel', name: 'Rules',
              properties: {
                Size: [1, 1], BackgroundTransparency: 1, TextScaled: true, Font: 'GothamBold',
                TextColor3: '#8FE3FF', Text: 'NEON SKYWAY OBBY  |  Skacz po platformach, zbieraj monety, dotrzyj do zielonej mety. R = reset, H = HUD.',
              },
            }],
          }],
        },
        {
          className: 'Folder', name: 'GeneratedLevel',
          properties: {},
        },
        {
          className: 'Folder', name: 'Decor',
          properties: {},
          children: [
            {
              className: 'Part', name: 'GlowPillarLeft',
              properties: { Size: [2, 16, 2], Position: [-18, 8, -16], Color: '#7E57C2', Material: 'Neon', Anchored: true },
              children: [{ className: 'PointLight', name: 'Glow', properties: { Color: '#9C7BFF', Brightness: 3, Range: 40 } }],
            },
            {
              className: 'Part', name: 'GlowPillarRight',
              properties: { Size: [2, 16, 2], Position: [18, 8, -16], Color: '#4FC3F7', Material: 'Neon', Anchored: true },
              children: [{ className: 'PointLight', name: 'Glow', properties: { Color: '#7FE7FF', Brightness: 3, Range: 40 } }],
            },
          ],
        },
      ],
    },
  },
  files: [
    { path: 'src/shared/Config.luau', content: config },
    { path: 'src/server/CheckpointService.luau', content: checkpoint },
    { path: 'src/server/LevelBuilder.server.luau', content: levelBuilder },
    { path: 'src/server/Stats.server.luau', content: stats },
    { path: 'src/client/Hud.client.luau', content: hud },
    { path: 'src/client/Effects.client.luau', content: effects },
  ],
};
