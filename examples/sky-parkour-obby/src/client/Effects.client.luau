--[[
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
