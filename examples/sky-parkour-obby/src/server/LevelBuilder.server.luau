--[[
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
