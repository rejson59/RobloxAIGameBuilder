--[[
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
