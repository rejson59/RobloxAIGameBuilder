--[[
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
