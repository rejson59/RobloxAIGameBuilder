--[[
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
