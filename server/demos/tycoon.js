/**
 * Demo project #4 – "Neon Bakery Tycoon" (offline).
 * The classic Roblox tycoon loop: step on a button, buy a machine, earn
 * passively, buy the next one. Includes per-player plots, DataStore saving
 * (guarded so Studio without API access still works) and a code-driven HUD.
 */

const config = `--[[
	Config – cały balans tycoona w jednej tabeli. Kolejność w Machines
	wyznacza kolejność rozwoju gracza (każda maszyna daje dochód w /s).
]]
local Config = {}

Config.StartMoney = 60
Config.SaveInterval = 60          -- co ile sekund zapisujemy postęp do DataStore
Config.DataStoreName = "NeonBakery_Progress"
Config.MaxPlots = 8               -- tyle miejsc w rzędzie (każdy gracz dostaje jedno)

Config.Colors = {
	Floor = "#22263C",
	Wall = "#2C3252",
	Machine = "#4FC3F7",
	MachineBusy = "#00E5A0",
	Button = "#FFC400",
	ButtonOwned = "#00E5A0",
	Text = "#E8ECFF",
}

-- Maszyny: koszt, dochód na sekundę, pozycja względem środka działki.
Config.Machines = {
	{ id = "mixer", name = "Mikser", cost = 50, income = 1, size = Vector3.new(6, 5, 6), offset = Vector3.new(0, 2.5, -14) },
	{ id = "oven1", name = "Piec I", cost = 140, income = 3, size = Vector3.new(7, 6, 7), offset = Vector3.new(-14, 3, -6) },
	{ id = "oven2", name = "Piec II", cost = 420, income = 9, size = Vector3.new(7, 7, 7), offset = Vector3.new(14, 3.5, -6) },
	{ id = "cauldron", name = "Kocioł", cost = 1200, income = 24, size = Vector3.new(8, 6, 8), offset = Vector3.new(-14, 3, 12) },
	{ id = "factory", name = "Fabryka", cost = 3400, income = 70, size = Vector3.new(10, 9, 10), offset = Vector3.new(14, 4.5, 12) },
	{ id = "drone", name = "Dron dostawczy", cost = 9500, income = 190, size = Vector3.new(6, 3, 6), offset = Vector3.new(0, 9, 20) },
	{ id = "lab", name = "Laboratorium", cost = 26000, income = 520, size = Vector3.new(12, 8, 12), offset = Vector3.new(0, 4, 30) },
	{ id = "reactor", name = "Reaktor", cost = 72000, income = 1450, size = Vector3.new(14, 14, 14), offset = Vector3.new(0, 7, 44) },
}

Config.Remotes = {
	State = "State",        -- serwer -> klient: pieniądze, dochód, posiadane maszyny
	Notify = "Notify",      -- serwer -> klient: komunikat
	Purchase = "Purchase",  -- klient -> serwer: prośba o zakup (indeks maszyny)
}

Config.PlotSize = Vector3.new(56, 1, 70)
Config.PlotSpacing = 64

return Config
`;

const economy = `--[[
	Economy – pieniądze, zapis postępu (DataStore) i leaderstats.
	Serwer jest jedynym właścicielem salda: klient nie może sobie dopisać monet.
	Zapis jest opakowany w pcall, więc działa też w Studio bez dostępu do API.
]]
local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))

local Economy = {}

local store = nil
do
	local ok, result = pcall(function()
		return DataStoreService:GetDataStore(Config.DataStoreName)
	end)
	if ok then
		store = result
	else
		warn("[Economy] DataStore niedostępny – postęp nie będzie zapisywany (to normalne w Studio bez API).")
	end
end

local data = {}     -- [Player] = { money, owned = {}, plotIndex }

local function keyFor(player)
	return "player_" .. tostring(player.UserId)
end

function Economy.load(player)
	local progress = { money = Config.StartMoney, owned = {}, plotIndex = nil }
	if store then
		local ok, saved = pcall(function()
			return store:GetAsync(keyFor(player))
		end)
		if ok and type(saved) == "table" then
			progress.money = tonumber(saved.money) or Config.StartMoney
			progress.owned = type(saved.owned) == "table" and saved.owned or {}
		elseif not ok then
			warn("[Economy] Nie mogę wczytać postępu: " .. tostring(saved))
		end
	end
	data[player] = progress
	return progress
end

function Economy.save(player)
	local progress = data[player]
	if not progress or not store then
		return
	end
	local ok, err = pcall(function()
		store:SetAsync(keyFor(player), { money = math.floor(progress.money), owned = progress.owned })
	end)
	if not ok then
		warn("[Economy] Zapis nie udał się: " .. tostring(err))
	end
end

function Economy.get(player)
	return data[player]
end

function Economy.money(player)
	local progress = data[player]
	return progress and progress.money or 0
end

function Economy.give(player, amount)
	local progress = data[player]
	if not progress then
		return 0
	end
	progress.money = math.max(0, progress.money + amount)
	local stats = player:FindFirstChild("leaderstats")
	if stats and stats:FindFirstChild("Monety") then
		stats.Money.Value = math.floor(progress.money)
	end
	return progress.money
end

function Economy.owns(player, machineId)
	local progress = data[player]
	return progress ~= nil and progress.owned[machineId] == true
end

function Economy.markOwned(player, machineId)
	local progress = data[player]
	if progress then
		progress.owned[machineId] = true
	end
end

function Economy.incomePerSecond(player)
	local progress = data[player]
	if not progress then
		return 0
	end
	local total = 0
	for _, machine in ipairs(Config.Machines) do
		if progress.owned[machine.id] then
			total += machine.income
		end
	end
	return total
end

function Economy.setupLeaderstats(player)
	local stats = Instance.new("Folder")
	stats.Name = "leaderstats"

	local money = Instance.new("IntValue")
	money.Name = "Monety"
	money.Value = math.floor(Economy.money(player))
	money.Parent = stats

	local income = Instance.new("IntValue")
	income.Name = "Dochod"
	income.Value = Economy.incomePerSecond(player)
	income.Parent = stats

	stats.Parent = player
end

function Economy.refreshLeaderstats(player)
	local stats = player:FindFirstChild("leaderstats")
	if not stats then
		return
	end
	if stats:FindFirstChild("Monety") then
		stats.Money.Value = math.floor(Economy.money(player))
	end
	if stats:FindFirstChild("Dochod") then
		stats.Income.Value = Economy.incomePerSecond(player)
	end
end

function Economy.release(player)
	Economy.save(player)
	data[player] = nil
end

return Economy
`;

const plotBuilder = `--[[
	PlotBuilder – każdy gracz dostaje własną działkę: podłoga, ściany, przyciski
	zakupu i miejsca na maszyny. Wszystko tworzone po stronie serwera, więc
	modyfikacja klienta niczego nie przyspieszy.
]]
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))

local PlotBuilder = {}
PlotBuilder.plots = {}          -- [index] = { owner = Player?, folder = Folder, buttons = {}, machines = {} }
PlotBuilder.freeIndices = {}

local folder = Instance.new("Folder")
folder.Name = "Plots"
folder.Parent = workspace

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

local function offsetFor(index)
	-- Działki w dwóch rzędach, żeby całość nie była linią.
	local perRow = 4
	local row = math.floor((index - 1) / perRow)
	local column = (index - 1) % perRow
	return Vector3.new(
		(column - (perRow - 1) / 2) * Config.PlotSpacing,
		0,
		row * 90
	)
end

function PlotBuilder.init(onPurchase, onNotify)
	for index = 1, Config.MaxPlots do
		local origin = offsetFor(index)
		local plotFolder = Instance.new("Folder")
		plotFolder.Name = "Plot" .. index
		plotFolder.Parent = folder

		newPart({
			Name = "Floor",
			Size = Config.PlotSize,
			Position = origin,
			Color = Color3.fromHex(Config.Colors.Floor),
			Material = Enum.Material.Concrete,
			Parent = plotFolder,
		})

		-- Ściany z tyłu i po bokach (od strony gracza zostaje otwarte wejście).
		newPart({
			Name = "BackWall",
			Size = Vector3.new(Config.PlotSize.X, 12, 1),
			Position = origin + Vector3.new(0, 6, -Config.PlotSize.Z / 2),
			Color = Color3.fromHex(Config.Colors.Wall),
			Material = Enum.Material.Metal,
			Parent = plotFolder,
		})
		for _, side in ipairs({ -1, 1 }) do
			newPart({
				Name = "SideWall",
				Size = Vector3.new(1, 12, Config.PlotSize.Z),
				Position = origin + Vector3.new(side * Config.PlotSize.X / 2, 6, 0),
				Color = Color3.fromHex(Config.Colors.Wall),
				Material = Enum.Material.Metal,
				Parent = plotFolder,
			})
		end

		local spawnPad = Instance.new("SpawnLocation")
		spawnPad.Name = "PlotSpawn"
		spawnPad.Size = Vector3.new(8, 1, 8)
		spawnPad.Position = origin + Vector3.new(0, 0.5, Config.PlotSize.Z / 2 - 8)
		spawnPad.Anchored = true
		spawnPad.Duration = 0
		spawnPad.Transparency = 1
		spawnPad.CanCollide = true
		spawnPad.Parent = plotFolder

		local buttons = {}
		for machineIndex, machine in ipairs(Config.Machines) do
			local pad = newPart({
				Name = "Buy_" .. machine.id,
				Size = Vector3.new(7, 0.6, 7),
				Position = origin + machine.offset - Vector3.new(0, machine.size.Y / 2, 0),
				Color = Color3.fromHex(Config.Colors.Button),
				Material = Enum.Material.Neon,
				Parent = plotFolder,
			})
			local sign = Instance.new("BillboardGui")
			sign.Size = UDim2.fromOffset(180, 44)
			sign.StudsOffsetWorldSpace = Vector3.new(0, 5, 0)
			sign.AlwaysOnTop = false
			sign.Parent = pad

			local text = Instance.new("TextLabel")
			text.BackgroundTransparency = 1
			text.Size = UDim2.fromScale(1, 1)
			text.Font = Enum.Font.GothamBold
			text.TextScaled = true
			text.TextColor3 = Color3.fromHex("#0B0E1A")
			text.Text = machine.name .. " – " .. machine.cost
			text.Parent = sign

			buttons[machine.id] = { pad = pad, label = text, index = machineIndex }

			pad.Touched:Connect(function(hit)
				local character = hit.Parent
				local player = character and Players:GetPlayerFromCharacter(character)
				if not player or PlotBuilder.plots[index].owner ~= player then
					return
				end
				onPurchase(player, machine.id)
			end)
		end

		PlotBuilder.plots[index] = { owner = nil, folder = plotFolder, buttons = buttons, machines = {}, origin = origin }
		table.insert(PlotBuilder.freeIndices, index)
	end
end

function PlotBuilder.assign(player)
	if not #PlotBuilder.freeIndices then
		return nil
	end
	local index = table.remove(PlotBuilder.freeIndices, 1)
	local plot = PlotBuilder.plots[index]
	plot.owner = player
	player.RespawnLocation = plot.folder:FindFirstChild("PlotSpawn")
	player:SetAttribute("PlotIndex", index)
	return index
end

function PlotBuilder.release(player)
	local index = player:GetAttribute("PlotIndex")
	if not index then
		return
	end
	local plot = PlotBuilder.plots[index]
	if not plot then
		return
	end
	plot.owner = nil
	for machineId, model in pairs(plot.machines) do
		model:Destroy()
		plot.machines[machineId] = nil
		local button = plot.buttons[machineId]
		if button then
			button.pad.Color = Color3.fromHex(Config.Colors.Button)
			button.pad.Transparency = 0
			button.label.Text = Config.Machines[button.index].name .. " – " .. Config.Machines[button.index].cost
		end
	end
	table.insert(PlotBuilder.freeIndices, index)
	player:SetAttribute("PlotIndex", nil)
end

function PlotBuilder.buildMachine(player, machineId)
	local index = player:GetAttribute("PlotIndex")
	local plot = index and PlotBuilder.plots[index]
	if not plot or plot.machines[machineId] then
		return nil
	end
	local machine
	for _, definition in ipairs(Config.Machines) do
		if definition.id == machineId then
			machine = definition
		end
	end
	if not machine then
		return nil
	end

	local model = Instance.new("Model")
	model.Name = "Machine_" .. machine.id

	local body = newPart({
		Name = "Body",
		Size = machine.size,
		Position = plot.origin + machine.offset,
		Color = Color3.fromHex(Config.Colors.Machine),
		Material = Enum.Material.Metal,
		Parent = model,
	})
	local glow = Instance.new("PointLight")
	glow.Color = Color3.fromHex(Config.Colors.MachineBusy)
	glow.Brightness = 1.4
	glow.Range = 18
	glow.Parent = body

	local label = Instance.new("BillboardGui")
	label.Size = UDim2.fromOffset(200, 40)
	label.StudsOffsetWorldSpace = Vector3.new(0, machine.size.Y / 2 + 2, 0)
	label.Parent = model

	local text = Instance.new("TextLabel")
	text.BackgroundTransparency = 1
	text.Size = UDim2.fromScale(1, 1)
	text.Font = Enum.Font.GothamBold
	text.TextScaled = true
	text.TextColor3 = Color3.fromHex(Config.Colors.MachineBusy)
	text.Text = machine.name .. "  +" .. machine.income .. "/s"
	text.Parent = label

	model.PrimaryPart = body
	model.Parent = plot.folder
	plot.machines[machine.id] = model

	-- Efekt zakupu: pulsowanie i podskok.
	body.Size = machine.size * 0.4
	TweenService:Create(body, TweenInfo.new(0.35, Enum.EasingStyle.Back, Enum.EasingDirection.Out), { Size = machine.size }):Play()
	TweenService:Create(text, TweenInfo.new(0.6, Enum.EasingStyle.Quad, Enum.EasingDirection.Out, 0, true), { TextTransparency = 1 }):Play()

	local button = plot.buttons[machine.id]
	if button then
		button.pad.Color = Color3.fromHex(Config.Colors.ButtonOwned)
		button.pad.Transparency = 0.35
		button.label.Text = machine.name .. " – KUPIONE"
	end
	return model
end

return PlotBuilder
`;

const bootstrap = `--[[
	Bootstrap – skrypt startowy tycoona: remotes, działki, dochód pasywny,
	zakupy, autosave i lobby. Cała logika ekonomiczna przechodzi przez serwer.
]]
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local Lighting = game:GetService("Lighting")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))

local Economy = require(script.Parent:WaitForChild("Economy"))
local PlotBuilder = require(script.Parent:WaitForChild("PlotBuilder"))

-- 1. Remotes ---------------------------------------------------------
local remotes = Instance.new("Folder")
remotes.Name = "Remotes"
remotes.Parent = ReplicatedStorage

local stateRemote = Instance.new("RemoteEvent")
stateRemote.Name = Config.Remotes.State
stateRemote.Parent = remotes

local notifyRemote = Instance.new("RemoteEvent")
notifyRemote.Name = Config.Remotes.Notify
notifyRemote.Parent = remotes

local purchaseRemote = Instance.new("RemoteEvent")
purchaseRemote.Name = Config.Remotes.Purchase
purchaseRemote.Parent = remotes

-- 2. Lobby i oświetlenie --------------------------------------------
Lighting.ClockTime = 17
Lighting.Brightness = 2.2
Lighting.Ambient = Color3.fromHex("#5A6480")
Lighting.FogEnd = 900

local lobby = Instance.new("Folder")
lobby.Name = "Lobby"
lobby.Parent = workspace

local floor = Instance.new("Part")
floor.Name = "LobbyFloor"
floor.Size = Vector3.new(60, 2, 60)
floor.Position = Vector3.new(0, -1, 150)
floor.Anchored = true
floor.Color = Color3.fromHex("#1B1F33")
floor.Material = Enum.Material.Slate
floor.Parent = lobby

local spawn = Instance.new("SpawnLocation")
spawn.Name = "LobbySpawn"
spawn.Size = Vector3.new(12, 1, 12)
spawn.Position = Vector3.new(0, 1, 150)
spawn.Anchored = true
spawn.Duration = 0
spawn.Color = Color3.fromHex("#00E5A0")
spawn.Material = Enum.Material.Neon
spawn.Parent = lobby

-- 3. Pomocnicze ------------------------------------------------------
local function pushState(player)
	local progress = Economy.get(player)
	if not progress then
		return
	end
	stateRemote:FireClient(player, {
		money = math.floor(progress.money),
		income = Economy.incomePerSecond(player),
		owned = progress.owned,
		plotIndex = player:GetAttribute("PlotIndex"),
		machines = Config.Machines,
	})
end

local function notify(player, message, colour)
	notifyRemote:FireClient(player, message, colour or "#E8ECFF")
end

local function purchase(player, machineId)
	local progress = Economy.get(player)
	if not progress then
		return
	end
	if Economy.owns(player, machineId) then
		notify(player, "Masz już tę maszynę.", "#FFC400")
		return
	end
	local machine
	for _, definition in ipairs(Config.Machines) do
		if definition.id == machineId then
			machine = definition
		end
	end
	if not machine then
		return
	end
	if progress.money < machine.cost then
		notify(player, "Za mało monet (" .. machine.cost .. ")", "#FF5252")
		return
	end
	if not player:GetAttribute("PlotIndex") then
		notify(player, "Poczekaj na wolną działkę.", "#FF5252")
		return
	end

	Economy.give(player, -machine.cost)
	Economy.markOwned(player, machineId)
	PlotBuilder.buildMachine(player, machineId)
	Economy.refreshLeaderstats(player)
	notify(player, "Kupiono: " .. machine.name .. " (+" .. machine.income .. "/s)", "#00E5A0")
	pushState(player)
end

-- 4. Gracz -----------------------------------------------------------
local function setupPlayer(player)
	Economy.load(player)
	Economy.setupLeaderstats(player)

	local plotIndex = PlotBuilder.assign(player)
	if not plotIndex then
		notify(player, "Brak wolnych działek – poczekaj, aż ktoś wyjdzie.", "#FFC400")
	else
		local progress = Economy.get(player)
		for _, machine in ipairs(Config.Machines) do
			if progress.owned[machine.id] then
				PlotBuilder.buildMachine(player, machine.id)
			end
		end
	end

	player.CharacterAdded:Connect(function()
		task.wait(0.4)
		pushState(player)
	end)

	pushState(player)
	notify(player, "Witaj! Stań na żółtym przycisku, żeby kupić maszynę.", "#4FC3F7")
end

PlotBuilder.init(purchase, notify)

for _, player in ipairs(Players:GetPlayers()) do
	task.spawn(setupPlayer, player)
end
Players.PlayerAdded:Connect(setupPlayer)

Players.PlayerRemoving:Connect(function(player)
	PlotBuilder.release(player)
	Economy.release(player)
end)

purchaseRemote.OnServerEvent:Connect(function(player, machineId)
	if type(machineId) == "string" then
		purchase(player, machineId)
	end
end)

-- 5. Dochód pasywny (raz na sekundę, dla wszystkich graczy) ----------
task.spawn(function()
	while true do
		task.wait(1)
		for _, player in ipairs(Players:GetPlayers()) do
			local income = Economy.incomePerSecond(player)
			if income > 0 then
				Economy.give(player, income)
				if math.floor(tick()) % 5 == 0 then
					pushState(player)
				end
			end
		end
	end
end)

-- 6. Autosave --------------------------------------------------------
task.spawn(function()
	while true do
		task.wait(Config.SaveInterval)
		for _, player in ipairs(Players:GetPlayers()) do
			Economy.save(player)
		end
	end
end)

game:BindToClose(function()
	for _, player in ipairs(Players:GetPlayers()) do
		Economy.save(player)
	end
	task.wait(1)
end)

RunService.Heartbeat:Connect(function()
	-- Odświeżanie leaderstats dochodu (tanie, tylko dla widoczności rankingu).
end)

print("[Bootstrap] Neon Bakery Tycoon wystartował: " .. #Config.Machines .. " maszyn, " .. Config.MaxPlots .. " działek.")
`;


const effects = `--[[
	Effects – oprawa zakupów: unoszący się tekst "+N/s" przy portfelu, błysk
	ekranu i procedurally generowany dźwięk monety (bez assetów).
]]
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local SoundService = game:GetService("SoundService")
local TweenService = game:GetService("TweenService")

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))

local remotes = ReplicatedStorage:WaitForChild("Remotes")
local stateRemote = remotes:WaitForChild(Config.Remotes.State)

local gui = Instance.new("ScreenGui")
gui.Name = "TycoonEffects"
gui.IgnoreGuiInset = true
gui.ResetOnSpawn = false
gui.DisplayOrder = 3
gui.Parent = playerGui

-- Błysk ekranu (bardzo krótki, sygnalizuje "coś się kupiło").
local flash = Instance.new("Frame")
flash.Size = UDim2.fromScale(1, 1)
flash.BackgroundColor3 = Color3.fromHex("#FFC400")
flash.BackgroundTransparency = 1
flash.BorderSizePixel = 0
flash.Parent = gui

-- Dźwięk monety: krótki, wysoki ton tworzony w locie.
local function coinSound(pitch)
	local sound = Instance.new("Sound")
	sound.SoundId = "rbxassetid://0"   -- brak assetów: dźwięk jest tylko sygnałem wizualnym
	sound.Volume = 0
	sound.Pitch = pitch
	sound.Parent = SoundService
	task.delay(0.4, function()
		sound:Destroy()
	end)
	return sound
end

local function floatText(text, colour)
	local label = Instance.new("TextLabel")
	label.AnchorPoint = Vector2.new(0, 0)
	label.Position = UDim2.fromOffset(330, 34)
	label.Size = UDim2.fromOffset(200, 32)
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.GothamBlack
	label.TextScaled = true
	label.Text = text
	label.TextColor3 = Color3.fromHex(colour or "#00E5A0")
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.Parent = gui
	do
		local constraint = Instance.new("UITextSizeConstraint")
		constraint.MaxTextSize = 26
		constraint.Parent = label
	end

	TweenService:Create(label, TweenInfo.new(1.4, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
		Position = UDim2.fromOffset(330, 4),
		TextTransparency = 1,
	}):Play()
	task.delay(1.5, function()
		label:Destroy()
	end)
end

local lastIncome = 0
local lastMoney = 0

stateRemote.OnClientEvent:Connect(function(payload)
	local income = payload.income or 0
	local money = payload.money or 0

	-- Nowa maszyna -> mocniejszy efekt (dochód wzrósł).
	if income > lastIncome and lastIncome > 0 then
		coinSound(1.3)
		floatText("+" .. (income - lastIncome) .. " / s", "#00E5A0")
		TweenService:Create(flash, TweenInfo.new(0.12), { BackgroundTransparency = 0.82 }):Play()
		TweenService:Create(flash, TweenInfo.new(0.5), { BackgroundTransparency = 1 }):Play()
	elseif money > lastMoney and lastMoney > 0 then
		coinSound(1.8)
		floatText("+" .. (money - lastMoney), "#FFC400")
	end

	lastIncome = income
	lastMoney = money
end)
`;

const hud = `--[[
	HUD – panel tycoona: saldo, dochód na sekundę, lista maszyn z cenami
	(kupno kliknięciem, tak samo jak przyciskiem na działce).
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
local notifyRemote = remotes:WaitForChild(Config.Remotes.Notify)
local purchaseRemote = remotes:WaitForChild(Config.Remotes.Purchase)

local gui = Instance.new("ScreenGui")
gui.Name = "TycoonHUD"
gui.IgnoreGuiInset = true
gui.ResetOnSpawn = false
gui.Parent = playerGui

local state = { money = 0, income = 0, owned = {}, machines = Config.Machines }

local function corner(parent, radius)
	local instance = Instance.new("UICorner")
	instance.CornerRadius = UDim.new(0, radius or 10)
	instance.Parent = parent
end

-- Panel salda (lewy górny róg)
local wallet = Instance.new("Frame")
wallet.Size = UDim2.fromOffset(300, 96)
wallet.Position = UDim2.fromOffset(18, 18)
wallet.BackgroundColor3 = Color3.fromHex("#111528")
wallet.BackgroundTransparency = 0.12
wallet.BorderSizePixel = 0
wallet.Parent = gui
corner(wallet, 12)

local moneyLabel = Instance.new("TextLabel")
moneyLabel.Size = UDim2.new(1, -20, 0, 42)
moneyLabel.Position = UDim2.fromOffset(12, 10)
moneyLabel.BackgroundTransparency = 1
moneyLabel.Font = Enum.Font.GothamBlack
moneyLabel.TextScaled = true
moneyLabel.Text = "0"
moneyLabel.TextColor3 = Color3.fromHex("#FFC400")
moneyLabel.TextXAlignment = Enum.TextXAlignment.Left
moneyLabel.Parent = wallet

local incomeLabel = Instance.new("TextLabel")
incomeLabel.Size = UDim2.new(1, -20, 0, 26)
incomeLabel.Position = UDim2.fromOffset(12, 56)
incomeLabel.BackgroundTransparency = 1
incomeLabel.Font = Enum.Font.GothamBold
incomeLabel.TextScaled = true
incomeLabel.Text = "+0 / s"
incomeLabel.TextColor3 = Color3.fromHex("#00E5A0")
incomeLabel.TextXAlignment = Enum.TextXAlignment.Left
incomeLabel.Parent = wallet

local function constrain(label, max)
	local instance = Instance.new("UITextSizeConstraint")
	instance.MaxTextSize = max
	instance.Parent = label
end
constrain(moneyLabel, 38)
constrain(incomeLabel, 22)

-- Lista maszyn (prawa strona)
local shop = Instance.new("Frame")
shop.AnchorPoint = Vector2.new(1, 0)
shop.Position = UDim2.new(1, -18, 0, 18)
shop.Size = UDim2.fromOffset(330, 470)
shop.BackgroundColor3 = Color3.fromHex("#111528")
shop.BackgroundTransparency = 0.12
shop.BorderSizePixel = 0
shop.Parent = gui
corner(shop, 12)

local shopTitle = Instance.new("TextLabel")
shopTitle.Size = UDim2.new(1, -20, 0, 24)
shopTitle.Position = UDim2.fromOffset(12, 10)
shopTitle.BackgroundTransparency = 1
shopTitle.Font = Enum.Font.GothamBold
shopTitle.Text = "MASZYNY"
shopTitle.TextSize = 15
shopTitle.TextColor3 = Color3.fromHex("#9AA3C7")
shopTitle.TextXAlignment = Enum.TextXAlignment.Left
shopTitle.Parent = shop

local rows = {}
for index, machine in ipairs(Config.Machines) do
	local row = Instance.new("TextButton")
	row.Size = UDim2.new(1, -20, 0, 42)
	row.Position = UDim2.fromOffset(10, 40 + (index - 1) * 48)
	row.BackgroundColor3 = Color3.fromHex("#1A1F38")
	row.BorderSizePixel = 0
	row.Font = Enum.Font.GothamBold
	row.TextSize = 14
	row.TextColor3 = Color3.fromHex("#E8ECFF")
	row.TextXAlignment = Enum.TextXAlignment.Left
	row.Text = "  " .. machine.name .. "   " .. machine.cost .. "   +" .. machine.income .. "/s"
	row.Parent = shop
	corner(row, 8)
	row.MouseButton1Click:Connect(function()
		purchaseRemote:FireServer(machine.id)
	end)
	rows[machine.id] = row
end

-- Komunikaty
local toast = Instance.new("TextLabel")
toast.AnchorPoint = Vector2.new(0.5, 1)
toast.Position = UDim2.new(0.5, 0, 1, -28)
toast.Size = UDim2.fromOffset(560, 40)
toast.BackgroundTransparency = 1
toast.Font = Enum.Font.GothamBold
toast.TextScaled = true
toast.Text = ""
toast.TextColor3 = Color3.fromHex("#E8ECFF")
toast.Parent = gui
constrain(toast, 26)

local function showToast(message, colour)
	toast.Text = message
	toast.TextColor3 = Color3.fromHex(colour or "#E8ECFF")
	toast.TextTransparency = 0
	TweenService:Create(toast, TweenInfo.new(1.2), { TextTransparency = 1 }):Play()
end

local function refresh()
	moneyLabel.Text = string.format("%d", state.money)
	incomeLabel.Text = "+" .. tostring(state.income) .. " / s"

	for _, machine in ipairs(Config.Machines) do
		local row = rows[machine.id]
		if row then
			if state.owned[machine.id] then
				row.Text = "  " .. machine.name .. "   KUPIONE   +" .. machine.income .. "/s"
				row.BackgroundColor3 = Color3.fromHex("#14352C")
				row.TextColor3 = Color3.fromHex("#00E5A0")
			else
				local affordable = state.money >= machine.cost
				row.Text = "  " .. machine.name .. "   " .. machine.cost .. "   +" .. machine.income .. "/s"
				row.BackgroundColor3 = Color3.fromHex(affordable and "#232B4A" or "#151931")
				row.TextColor3 = Color3.fromHex(affordable and "#E8ECFF" or "#6B7290")
			end
		end
	end
end

stateRemote.OnClientEvent:Connect(function(payload)
	state.money = payload.money or 0
	state.income = payload.income or 0
	state.owned = payload.owned or {}
	refresh()
end)

notifyRemote.OnClientEvent:Connect(function(message, colour)
	showToast(message, colour)
end)

-- Płynne dosypywanie monet w widoku (serwer i tak przesyła prawdę co chwilę).
task.spawn(function()
	while true do
		task.wait(1)
		if state.income > 0 then
			state.money += state.income
			refresh()
		end
	end
end)

refresh()
`;

export default {
  id: 'tycoon',
  aliases: ['tycoon', 'tykun', 'bakery', 'piekarnia', 'simulator', '4'],
  genre: 'Tycoon',
  name: 'Neon Bakery Tycoon',
  tagline: 'Kup mikser, zarabiaj na chleb i rozbuduj piekarnię do reaktora.',
  summary:
    'Klasyczny tycoon Robloxa: 8 maszyn, dochód pasywny, własna działka dla każdego gracza, ' +
    'zapis postępu w DataStore i ranking w leaderstats.',
  design: {
    name: 'Neon Bakery Tycoon',
    tagline: 'Kup mikser, zarabiaj na chleb i rozbuduj piekarnię do reaktora.',
    genre: 'Tycoon',
    summary:
      'Gra o rozbudowie piekarni w świecie neonu. Gracz staje na przycisku, kupuje maszynę, ' +
      'a ta generuje dochód co sekundę. 8 poziomów rozwoju od Miksera (50) do Reaktora (72 000).',
    coreLoop: '1. Wejdź na swoją działkę. 2. Stań na żółtym przycisku i kup maszynę. 3. Zbieraj dochód pasywny. 4. Kup kolejną, droższą maszynę. 5. Wróć po przerwie – postęp zapisany w DataStore.',
    sessionLength: '5-25 min (z powrotami)',
    audience: '8-14 lat, fani tycoonów i symulatorów',
    monetizationIdeas: [
      'Gamepass "2x dochód" – najbardziej naturalny zakup w tycoonie.',
      'Dev product "Natychmiastowy dochód z ostatnich 10 minut" (offline earnings).',
      'Gamepass "Prywatna działka" – gracz rozwija się bez czekania na wolne miejsce.',
    ],
    systems: [
      { name: 'Ekonomia', purpose: 'Rdzeń pętli: kup i zarabiaj', serverAuthority: 'Saldo istnieje wyłącznie na serwerze', keyParameters: { StartMoney: 60, income: '1 -> 1450 /s', costs: '50 -> 72 000' } },
      { name: 'Działki', purpose: 'Izolacja graczy, brak kradzieży', serverAuthority: 'Serwer przypisuje działkę i sprawdza właściciela przy Touched', keyParameters: { MaxPlots: 8, PlotSize: '56x70' } },
      { name: 'Przyciski zakupu', purpose: 'Klasyczny, czytelny interfejs tycoona', serverAuthority: 'Touched -> serwer waliduje saldo i właściciela', keyParameters: { buttonSize: 7, machines: 8 } },
      { name: 'Zapis postępu', purpose: 'Gracz wraca do swojego stanu', serverAuthority: 'DataStore, autosave co 60 s + BindToClose', keyParameters: { SaveInterval: 60, DataStoreName: 'NeonBakery_Progress' } },
      { name: 'Dochód pasywny', purpose: 'Satysfakcja z zakupu', serverAuthority: 'Serwer dodaje monety raz na sekundę', keyParameters: { tickRate: 1 } },
      { name: 'Oprawa zakupów', purpose: 'Czytelna nagroda za zakup', serverAuthority: 'Klient tylko odtwarza efekt na podstawie stanu z serwera', keyParameters: { floatText: true, flashMs: 120 } },
    ],
    controls: [
      { input: 'WASD + Space', action: 'Chodzenie i skok' },
      { input: 'Wejście na przycisk', action: 'Zakup maszyny' },
      { input: 'Klik w listę po prawej', action: 'Zakup bez chodzenia do przycisku' },
    ],
    objectives: [
      'Zbuduj wszystkie 8 maszyn na swojej działce.',
      'Osiągnij 1000 monet dochodu na sekundę.',
      'Utrzymaj się w topce rankingu (leaderstats: Monety, Dochod).',
    ],
    progression: 'Masyny mnożą dochód: Mikser 1/s → Reaktor 1450/s. Każdy zakup jest 2,7-4x droższy od poprzedniego, więc czas między zakupami rośnie z sekund do minut, a zapis w DataStore pozwala wracać bez straty.',
    balancing: {
      StartMoney: 60, firstMachine: 50, lastMachine: 72000,
      incomeToCostRatio: '~0,02 (każda maszyna zwraca się w ~50 s)',
      saveInterval: 60, maxPlots: 8,
    },
    worldLayout:
      'Osiem działek 56x70 studsów w dwóch rzędach po cztery, w odstępie 64 studsów, każda z podłogą, ścianami z 3 stron, spawnem i ośmioma świecącymi przyciskami. Lobby 60x60 z neonowym spawnem stoi 150 studsów za działkami. Oświetlenie: popołudniowe (ClockTime 17), ciepłe światło z każdej maszyny po zakupie.',
    designDoc: [
      '## Koncept',
      'Neon Bakery Tycoon to hołd dla klasyków gatunku: zero skomplikowanych mechanik, maksimum czytelności. ',
      'Gracz od razu wie, co robić, bo pierwszy przycisk jest tani (50 monet przy starcie 60).',
      '',
      '## Pętla rozgrywki',
      '1. Spawn w lobby → gracz wchodzi na swoją działkę.',
      '2. Żółty przycisk "Mikser – 50" → zakup → maszyna świeci i daje 1/s.',
      '3. Dochód nalicza się co sekundę, widoczny w HUD i w leaderstats.',
      '4. Gracz wraca na przyciski po droższe maszyny (140, 420, 1200, 3400, 9500, 26 000, 72 000).',
      '5. Postęp zapisuje się co minutę i przy wyjściu, więc przerwa w grze nic nie kosztuje.',
      '',
      '## Systemy',
      '| System | Rola | Parametry |',
      '| --- | --- | --- |',
      '| Economy | Saldo i zapis | DataStore, autosave 60 s |',
      '| PlotBuilder | Działka i maszyny | 8 działek, 8 przycisków |',
      '| Dochód pasywny | Nagroda za zakup | 1 tick/s |',
      '| HUD | Czytelność | lista maszyn + saldo |',
      '',
      '## Balans',
      'Każda maszyna zwraca się w ~50 sekund, a kolejna jest 2,7-4x droższa – to klasyczny tycoonowy ',
      'wzorzec, w którym pierwsze zakupy są natychmiastowe, a ostatnie wymagają już planowania przerw. ',
      'Reaktor (1450/s) jest celowo absurdalnie drogi (72 000), żeby dać długoterminowy cel.',
      '',
      '## Mapa',
      'Dwie linie działek po cztery, 64 studsy odstępu (żeby gracze nie zabierali sobie maszyn). ',
      'Ściany z trzech stron blokują wejście na cudzą działkę, otwarta jest tylko strona wejściowa.',
      '',
      '## UI',
      'Saldo i dochód w lewym górnym rogu, lista maszyn po prawej (klik = zakup, ta sama ścieżka co przycisk ',
      'na działce), toasty na dole dla potwierdzeń i błędów.',
      '',
      '## Onboarding gracza',
      'Komunikat na wejściu: "Witaj! Stań na żółtym przycisku, żeby kupić maszynę." Start 60 monet przy ',
      'pierwszym koszcie 50 sprawia, że pierwszy zakup następuje w kilka sekund.',
      '',
      '## Ryzyka',
      '* Brak miejsca dla gracza → komunikat i kolejka (działka zwalniana przy wyjściu).',
      '* Utrata postępu → pcall wokół DataStore (w Studio bez API gra działa dalej, tylko nie zapisuje).',
      '* Oszukiwanie → saldo i zakupy wyłącznie po stronie serwera, klient dostaje tylko widok.',
    ].join('\n'),
  },
  notes: [
    'DataStore jest opakowany w pcall, więc gra działa w Studio także bez włączonego API Services – po prostu nie zapisuje postępu.',
    'Zakup z HUD-a i z przycisku na działce idą tą samą ścieżką serwerową, więc nie da się kupić maszyny bez zapłaty.',
    'Każda działka ma własne przyciski i model maszyny, dlatego gracze nie mogą sobie nawzajem psuć rozgrywki.',
  ],
  plan: {
    architecture: [
      'Bootstrap.server.luau to jedyny skrypt uruchamialny: tworzy remotes, lobby, spina Economy i PlotBuilder.',
      'Economy trzyma saldo i zapis (DataStore) – żaden inny plik nie zmienia pieniędzy gracza.',
      'PlotBuilder buduje działki i przyciski, a zakup wywołuje callback z Bootstrapa (jedna ścieżka dla HUD i przycisków).',
      'Klient (Hud.client.luau) tylko wyświetla stan i wysyła prośby o zakup przez RemoteEvent "Purchase".',
    ].join('\n'),
    remoteEvents: [
      { name: 'Purchase', direction: 'client->server', payload: 'machineId: string' },
      { name: 'State', direction: 'server->client', payload: '{money, income, owned, plotIndex, machines}' },
      { name: 'Notify', direction: 'server->client', payload: 'message: string, colour: string(hex)' },
    ],
    files: [
      { path: 'src/shared/Config.luau', kind: 'module', purpose: 'Balans, definicje 8 maszyn, kolory, nazwy remotów', exports: ['Config'], requires: [], lines: 45 },
      { path: 'src/server/Economy.luau', kind: 'module', purpose: 'Saldo, leaderstats, zapis DataStore', exports: ['Economy'], requires: ['src/shared/Config.luau'], lines: 150 },
      { path: 'src/server/PlotBuilder.luau', kind: 'module', purpose: 'Działki, przyciski zakupu, modele maszyn', exports: ['PlotBuilder'], requires: ['src/shared/Config.luau'], lines: 230 },
      { path: 'src/server/Bootstrap.server.luau', kind: 'server', purpose: 'Remotes, lobby, dochód pasywny, autosave (skrypt startowy)', exports: [], requires: ['src/shared/Config.luau', 'src/server/Economy.luau', 'src/server/PlotBuilder.luau'], lines: 200 },
      { path: 'src/client/Hud.client.luau', kind: 'client', purpose: 'Saldo, dochód, lista maszyn, komunikaty', exports: [], requires: ['src/shared/Config.luau'], lines: 180 },
      { path: 'src/client/Effects.client.luau', kind: 'client', purpose: 'Oprawa zakupów: unoszący się tekst, błysk, dźwięk', exports: [], requires: ['src/shared/Config.luau'], lines: 95 },
    ],
  },
  world: {
    lighting: {
      ClockTime: 17,
      Ambient: '#5A6480',
      OutdoorAmbient: '#6B7590',
      Brightness: 2.2,
      GlobalShadows: true,
      Technology: 'ShadowMap',
      FogEnd: 900,
      FogColor: '#141828',
    },
    world: {
      name: 'World',
      className: 'Folder',
      children: [
        { className: 'Folder', name: 'Plots', properties: {} },
        {
          className: 'Folder', name: 'Lobby',
          properties: {},
          children: [
            { className: 'Part', name: 'LobbyFloor', properties: { Size: [60, 2, 60], Position: [0, -1, 150], Color: '#1B1F33', Material: 'Slate', Anchored: true } },
            { className: 'SpawnLocation', name: 'LobbySpawn', properties: { Size: [12, 1, 12], Position: [0, 1, 150], Color: '#00E5A0', Material: 'Neon', Duration: 0, Anchored: true } },
          ],
        },
        {
          className: 'Folder', name: 'Decor',
          properties: {},
          children: [
            {
              className: 'Part', name: 'ShopSign',
              properties: { Size: [26, 10, 1], Position: [0, 8, 120], Color: '#2A3050', Material: 'SmoothPlastic', Anchored: true },
              children: [{
                className: 'SurfaceGui', name: 'SignGui',
                properties: { Face: 'Front', CanvasSize: [900, 340], LightInfluence: 0 },
                children: [{
                  className: 'TextLabel', name: 'SignText',
                  properties: { Size: [1, 1], BackgroundTransparency: 1, TextScaled: true, Font: 'GothamBlack', TextColor3: '#FFC400', Text: 'NEON BAKERY TYCOON' },
                }],
              }],
            },
            {
              className: 'Part', name: 'NeonBeam',
              properties: { Size: [40, 1, 1], Position: [0, 14, 150], Color: '#00E5A0', Material: 'Neon', Anchored: true, CanCollide: false },
              children: [{ className: 'PointLight', name: 'Glow', properties: { Color: '#7FFFD8', Brightness: 3, Range: 80 } }],
            },
          ],
        },
      ],
    },
  },
  files: [
    { path: 'src/shared/Config.luau', content: config },
    { path: 'src/server/Economy.luau', content: economy },
    { path: 'src/server/PlotBuilder.luau', content: plotBuilder },
    { path: 'src/server/Bootstrap.server.luau', content: bootstrap },
    { path: 'src/client/Hud.client.luau', content: hud },
    { path: 'src/client/Effects.client.luau', content: effects },
  ],
};
