--[[
	Roblox AI Game Builder – wygenerowana wtyczka z wbudowaną grą.

	Gra: Neon Skyway Obby
	Pokonaj 26 ruchomych platform nad jeziorem lawy – checkpoint po checkpoincie.
	Pliki Luau: 6 | Wygenerowano: 2026-09-20

	Instalacja:
	  1. Zapisz ten plik na dysku jako RobloxAIGameBuilder.plugin.luau
	  2. W Roblox Studio: Plugins -> Plugins Folder (otworzy folder w eksploratorze plików)
	  3. Skopiuj plik do tego folderu
	  4. Wróć do Studio: Plugins -> Manage Plugins i włącz wtyczkę (albo zrestartuj Studio)
	  5. Na pasku wtyczek pojawi się "Roblox AI Game Builder" -> "Buduj grę"
]]
--!nocheck

local PROJECT = {
	name = "Neon Skyway Obby",
	tagline = "Pokonaj 26 ruchomych platform nad jeziorem lawy – checkpoint po checkpoincie.",
	files = {
		{
			path = "src/shared/Config.luau",
			content = "--[[\n\tConfig – wszystkie liczby balansu w jednym miejscu.\n\tZmiana tutaj wpływa na całą grę, dlatego trzymamy je z dala od logiki.\n]]\nlocal Config = {}\n\nConfig.Seed = 20240920          -- stały seed = powtarzalny level (łatwe testowanie)\nConfig.PlatformCount = 26       -- ile platform ma mieć wieża\nConfig.PlatformMinSize = 5\nConfig.PlatformMaxSize = 12\nConfig.GapMin = 9\nConfig.GapMax = 18\nConfig.LateralSpread = 7        -- na ile studsów platforma może odjechać w bok\nConfig.HeightStep = 2           -- maksymalna zmiana wysokości między platformami\nConfig.StartPoint = Vector3.new(0, 10, 60)\nConfig.CheckpointEvery = 6\nConfig.MovingEvery = 5\nConfig.MovingSpeed = 0.35       -- sekundy na 1 stud ruchu platformy\nConfig.CoinCount = 14\nConfig.LavaDrop = 6             -- jak nisko pod platformami jest lawa\nConfig.WalkSpeed = 18\nConfig.JumpPower = 52\n\nConfig.Colors = {\n\tPlatform = \"#4FC3F7\",\n\tPlatformAlt = \"#7E57C2\",\n\tLava = \"#FF3B30\",\n\tCheckpoint = \"#FFD54F\",\n\tCheckpointDone = \"#66BB6A\",\n\tFinish = \"#00E5A0\",\n\tCoin = \"#FFC400\",\n\tLobby = \"#2B2F45\",\n}\n\n-- Nazwy RemoteEventów – muszą być identyczne po stronie klienta i serwera.\nConfig.Remotes = {\n\tNotify = \"Notify\",      -- serwer -> klient: komunikat UI\n\tReset = \"Reset\",        -- klient -> serwer: poproszenie o respawn\n}\n\nConfig.LevelFolderName = \"GeneratedLevel\"\n\nreturn Config\n",
		},
		{
			path = "src/server/CheckpointService.luau",
			content = "--[[\n\tCheckpointService – pilnuje postępu gracza (który checkpoint zaliczył)\n\ti ustawia jego RespawnLocation, żeby wracał na właściwy etap.\n\tAutorytetem jest serwer: klient nie może sobie \"przypisać\" etapu.\n]]\nlocal Players = game:GetService(\"Players\")\n\nlocal CheckpointService = {}\nCheckpointService.__index = CheckpointService\n\nlocal claimed = {}          -- [Player] = numer etapu\nlocal padByStage = {}       -- [numer etapu] = SpawnLocation\n\nfunction CheckpointService.register(stage, pad)\n\tpadByStage[stage] = pad\n\tpad:SetAttribute(\"Stage\", stage)\nend\n\nfunction CheckpointService.stageOf(player)\n\treturn math.max(1, claimed[player] or 0)\nend\n\n--- Wywoływane przez Touched na padzie. Serwer decyduje czy zaliczenie jest legalne.\nfunction CheckpointService.claim(player, pad)\n\tlocal stage = pad:GetAttribute(\"Stage\")\n\tif type(stage) ~= \"number\" then\n\t\treturn false\n\tend\n\tif (claimed[player] or 0) >= stage then\n\t\treturn false         -- gracz już był dalej, nie cofamy postępu\n\tend\n\tclaimed[player] = stage\n\tplayer.RespawnLocation = pad\n\n\tlocal stats = player:FindFirstChild(\"leaderstats\")\n\tif stats and stats:FindFirstChild(\"Stage\") then\n\t\tstats.Stage.Value = stage\n\tend\n\n\t-- Zaliczone pady świecą na zielono – czytelna informacja zwrotna.\n\tfor claimedStage, claimedPad in pairs(padByStage) do\n\t\tif claimedStage <= stage then\n\t\t\tclaimedPad.Color = Color3.fromHex(\"#66BB6A\")\n\t\tend\n\tend\n\treturn true\nend\n\nfunction CheckpointService.reset(player)\n\tclaimed[player] = 0   -- 0 = brak zaliczonego checkpointu (etap 1 zalicza się sam)\n\tlocal first = padByStage[1]\n\tif first then\n\t\tplayer.RespawnLocation = first\n\tend\n\tlocal stats = player:FindFirstChild(\"leaderstats\")\n\tif stats and stats:FindFirstChild(\"Stage\") then\n\t\tstats.Stage.Value = 1\n\tend\nend\n\nPlayers.PlayerRemoving:Connect(function(player)\n\tclaimed[player] = nil\nend)\n\nreturn CheckpointService\n",
		},
		{
			path = "src/server/LevelBuilder.server.luau",
			content = "--[[\n\tLevelBuilder – proceduralnie buduje cały tor: platformy, lawę, checkpointy,\n\truchome platformy, monety i metę. Wszystko liczone z jednego seeda,\n\tdzięki czemu mapa jest zawsze taka sama i łatwa do balansowania.\n]]\nlocal ReplicatedStorage = game:GetService(\"ReplicatedStorage\")\nlocal TweenService = game:GetService(\"TweenService\")\nlocal Players = game:GetService(\"Players\")\n\nlocal Shared = ReplicatedStorage:WaitForChild(\"Shared\")\nlocal Config = require(Shared:WaitForChild(\"Config\"))\nlocal CheckpointService = require(script.Parent:WaitForChild(\"CheckpointService\"))\n\nlocal rng = Random.new(Config.Seed)\n\nlocal folder = workspace:FindFirstChild(Config.LevelFolderName)\nif not folder then\n\tfolder = Instance.new(\"Folder\")\n\tfolder.Name = Config.LevelFolderName\n\tfolder.Parent = workspace\nend\n\nlocal function newPart(props)\n\tlocal part = Instance.new(\"Part\")\n\tpart.Anchored = true\n\tpart.TopSurface = Enum.SurfaceType.Smooth\n\tpart.BottomSurface = Enum.SurfaceType.Smooth\n\tfor key, value in pairs(props) do\n\t\tpart[key] = value\n\tend\n\treturn part\nend\n\nlocal function killPlayer(humanoid)\n\t-- Śmierć przez obrażenia = naturalne zachowanie Robloxa (respawn, efekty).\n\thumanoid.Health = 0\nend\n\nlocal killBricks = Instance.new(\"Folder\")\nkillBricks.Name = \"KillBricks\"\nkillBricks.Parent = folder\n\nlocal checkpoints = Instance.new(\"Folder\")\ncheckpoints.Name = \"Checkpoints\"\ncheckpoints.Parent = folder\n\nlocal movingPlatforms = {}\n\nlocal function makeLava(size, position)\n\tlocal lava = newPart({\n\t\tName = \"Lava\",\n\t\tSize = size,\n\t\tPosition = position,\n\t\tColor = Color3.fromHex(Config.Colors.Lava),\n\t\tMaterial = Enum.Material.Neon,\n\t\tTransparency = 0.15,\n\t\tCanCollide = false,\n\t\tParent = killBricks,\n\t})\n\tlava.Touched:Connect(function(hit)\n\t\tlocal humanoid = hit.Parent and hit.Parent:FindFirstChildOfClass(\"Humanoid\")\n\t\tif humanoid and humanoid.Health > 0 then\n\t\t\tkillPlayer(humanoid)\n\t\tend\n\tend)\n\treturn lava\nend\n\nlocal function makeCheckpoint(stage, position, baseSize)\n\tlocal pad = Instance.new(\"SpawnLocation\")\n\tpad.Name = \"Checkpoint\" .. stage\n\tpad.Size = Vector3.new(math.min(baseSize.X, 8), 0.6, math.min(baseSize.Z, 8))\n\tpad.Position = position\n\tpad.Anchored = true\n\tpad.CanCollide = true\n\tpad.Duration = 0                 -- bez forcefielda, żeby nie było exploitu\n\tpad.Neutral = true\n\tpad.Material = Enum.Material.Neon\n\tpad.Color = Color3.fromHex(Config.Colors.Checkpoint)\n\tpad.Parent = checkpoints\n\n\tCheckpointService.register(stage, pad)\n\n\tpad.Touched:Connect(function(hit)\n\t\tlocal character = hit.Parent\n\t\tlocal player = character and Players:GetPlayerFromCharacter(character)\n\t\tif not player then\n\t\t\treturn\n\t\tend\n\t\tif CheckpointService.claim(player, pad) then\n\t\t\tpad.Color = Color3.fromHex(Config.Colors.CheckpointDone)\n\t\t\tlocal remotes = ReplicatedStorage:FindFirstChild(\"Remotes\")\n\t\t\tlocal notify = remotes and remotes:FindFirstChild(Config.Remotes.Notify)\n\t\t\tif notify then\n\t\t\t\tnotify:FireClient(player, \"Checkpoint \" .. stage .. \" zaliczony!\", Color3.fromHex(Config.Colors.CheckpointDone))\n\t\t\tend\n\t\tend\n\tend)\n\treturn pad\nend\n\nlocal function makeCoin(position)\n\tlocal coin = newPart({\n\t\tName = \"Coin\",\n\t\tShape = Enum.PartType.Cylinder,\n\t\tSize = Vector3.new(0.6, 3, 3),\n\t\tOrientation = Vector3.new(0, 0, 90),\n\t\tPosition = position,\n\t\tColor = Color3.fromHex(Config.Colors.Coin),\n\t\tMaterial = Enum.Material.Neon,\n\t\tCanCollide = false,\n\t\tParent = folder,\n\t})\n\tcoin:SetAttribute(\"Collected\", false)\n\treturn coin\nend\n\n-- ------------------------------------------------------------------\n-- Budowa toru\n-- ------------------------------------------------------------------\nlocal cursor = Config.StartPoint\nlocal platforms = {}\n\nfor index = 1, Config.PlatformCount do\n\tlocal isFinish = index == Config.PlatformCount\n\tlocal sizeX = rng:NextNumber(Config.PlatformMinSize, Config.PlatformMaxSize)\n\tlocal sizeZ = rng:NextNumber(Config.PlatformMinSize, Config.PlatformMaxSize)\n\tif isFinish then\n\t\tsizeX, sizeZ = 24, 24\n\tend\n\n\tlocal gap = rng:NextNumber(Config.GapMin, Config.GapMax)\n\tlocal lateral = if isFinish then 0 else rng:NextNumber(-Config.LateralSpread, Config.LateralSpread)\n\tlocal height = if isFinish then cursor.Y + 2 else cursor.Y + rng:NextNumber(-Config.HeightStep, Config.HeightStep)\n\tlocal position = Vector3.new(cursor.X + lateral, height, cursor.Z + gap + sizeZ / 2)\n\tlocal size = Vector3.new(sizeX, 1.5, sizeZ)\n\n\tlocal platform = newPart({\n\t\tName = \"Platform\" .. index,\n\t\tSize = size,\n\t\tPosition = position,\n\t\tColor = Color3.fromHex(if index % 2 == 0 then Config.Colors.Platform else Config.Colors.PlatformAlt),\n\t\tMaterial = Enum.Material.SmoothPlastic,\n\t\tParent = folder,\n\t})\n\ttable.insert(platforms, platform)\n\tcursor = position\n\n\t-- Lawa pod każdą szczeliną – spadnięcie musi mieć konsekwencje.\n\tmakeLava(\n\t\tVector3.new(sizeX + 6, 2, gap + sizeZ + 6),\n\t\tVector3.new(position.X, position.Y - Config.LavaDrop, position.Z - sizeZ / 2 - gap / 2)\n\t)\n\n\t-- Co N-ty etap: checkpoint.\n\tif index % Config.CheckpointEvery == 0 and index < Config.PlatformCount then\n\t\tmakeCheckpoint(index, Vector3.new(position.X, position.Y + 1.1, position.Z), size)\n\tend\n\n\t-- Co M-ta platforma jeździ w bok – trzeba wyczuć rytm.\n\tif index % Config.MovingEvery == 0 and index < Config.PlatformCount then\n\t\tlocal offset = rng:NextNumber(6, 12) * (if rng:NextInteger(0, 1) == 0 then -1 else 1)\n\t\tlocal tween = TweenService:Create(\n\t\t\tplatform,\n\t\t\tTweenInfo.new(Config.MovingSpeed * math.abs(offset), Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, true),\n\t\t\t{ Position = position + Vector3.new(offset, 0, 0) }\n\t\t)\n\t\ttable.insert(movingPlatforms, tween)\n\t\ttween:Play()\n\tend\nend\n\n-- Checkpoint startowy (etap 1) na pierwszej platformie.\nmakeCheckpoint(1, Vector3.new(Config.StartPoint.X, Config.StartPoint.Y + 1.1, Config.StartPoint.Z), Vector3.new(12, 1.5, 12))\n\n-- Monety na losowych platformach (rotują, bo to lubią gracze).\nfor _ = 1, Config.CoinCount do\n\tlocal platform = platforms[rng:NextInteger(3, #platforms)]\n\tlocal coin = makeCoin(platform.Position + Vector3.new(0, 3, 0))\n\tlocal spin = TweenService:Create(coin, TweenInfo.new(1.2, Enum.EasingStyle.Linear, Enum.EasingDirection.InOut, -1, true), { Orientation = Vector3.new(0, 180, 90) })\n\tspin:Play()\nend\n\n-- Meta – duża zielona platforma z informacją o nagrodzie.\nlocal finish = platforms[#platforms]\nlocal finishPad = newPart({\n\tName = \"FinishPad\",\n\tSize = Vector3.new(14, 0.6, 14),\n\tPosition = finish.Position + Vector3.new(0, 1.1, 0),\n\tColor = Color3.fromHex(Config.Colors.Finish),\n\tMaterial = Enum.Material.Neon,\n\tCanCollide = false,\n\tParent = folder,\n})\nfinishPad.Touched:Connect(function(hit)\n\tlocal player = hit.Parent and Players:GetPlayerFromCharacter(hit.Parent)\n\tif not player then\n\t\treturn\n\tend\n\tlocal stats = player:FindFirstChild(\"leaderstats\")\n\tif stats and stats:FindFirstChild(\"Coins\") then\n\t\tstats.Coins.Value += 100\n\tend\n\tlocal remotes = ReplicatedStorage:FindFirstChild(\"Remotes\")\n\tlocal notify = remotes and remotes:FindFirstChild(Config.Remotes.Notify)\n\tif notify then\n\t\tnotify:FireClient(player, \"META! +100 monet. Gratulacje!\", Color3.fromHex(Config.Colors.Finish))\n\tend\nend)\n\nprint(\"[LevelBuilder] Tor gotowy: \" .. #platforms .. \" platform, \" .. #movingPlatforms .. \" ruchomych.\")\n",
		},
		{
			path = "src/server/Stats.server.luau",
			content = "--[[\n\tStats – leaderstats (Etap, Monety), statystyki postaci i wspólna obsługa\n\tRemoteEventu Reset. Serwer jest jedynym miejscem, które zmienia te liczby.\n]]\nlocal ReplicatedStorage = game:GetService(\"ReplicatedStorage\")\nlocal Players = game:GetService(\"Players\")\n\nlocal Shared = ReplicatedStorage:WaitForChild(\"Shared\")\nlocal Config = require(Shared:WaitForChild(\"Config\"))\nlocal CheckpointService = require(script.Parent:WaitForChild(\"CheckpointService\"))\n\nlocal remotes = ReplicatedStorage:FindFirstChild(\"Remotes\")\nif not remotes then\n\tremotes = Instance.new(\"Folder\")\n\tremotes.Name = \"Remotes\"\n\tremotes.Parent = ReplicatedStorage\nend\n\nfor _, remoteName in pairs(Config.Remotes) do\n\tif not remotes:FindFirstChild(remoteName) then\n\t\tlocal remote = Instance.new(\"RemoteEvent\")\n\t\tremote.Name = remoteName\n\t\tremote.Parent = remotes\n\tend\nend\n\nlocal resetRemote = remotes:WaitForChild(Config.Remotes.Reset)\n\nlocal function applyCharacter(player, character)\n\tlocal humanoid = character:WaitForChild(\"Humanoid\")\n\thumanoid.WalkSpeed = Config.WalkSpeed\n\thumanoid.JumpPower = Config.JumpPower\n\thumanoid.UseJumpPower = true\nend\n\nlocal function setupPlayer(player)\n\tlocal stats = Instance.new(\"Folder\")\n\tstats.Name = \"leaderstats\"\n\n\tlocal stage = Instance.new(\"IntValue\")\n\tstage.Name = \"Stage\"\n\tstage.Value = 1\n\tstage.Parent = stats\n\n\tlocal coins = Instance.new(\"IntValue\")\n\tcoins.Name = \"Coins\"\n\tcoins.Value = 0\n\tcoins.Parent = stats\n\n\tstats.Parent = player\n\tCheckpointService.reset(player)\n\n\tif player.Character then\n\t\tapplyCharacter(player, player.Character)\n\tend\n\tplayer.CharacterAdded:Connect(function(character)\n\t\tapplyCharacter(player, character)\n\tend)\nend\n\nfor _, player in ipairs(Players:GetPlayers()) do\n\ttask.spawn(setupPlayer, player)\nend\nPlayers.PlayerAdded:Connect(function(player)\n\tsetupPlayer(player)\nend)\n\n-- Reset postaci na życzenie klienta (np. gdy gracz utknie).\nresetRemote.OnServerEvent:Connect(function(player)\n\tlocal character = player.Character\n\tif character then\n\t\tlocal humanoid = character:FindFirstChildOfClass(\"Humanoid\")\n\t\tif humanoid and humanoid.Health > 0 then\n\t\t\thumanoid.Health = 0\n\t\tend\n\tend\nend)\n\n-- Monety zbierane przez Touched (serwer sprawdza dystans i flagę, więc nie da się\n-- podwójnie zaliczyć tej samej monety).\nlocal levelFolder = workspace:WaitForChild(Config.LevelFolderName, 30)\nif levelFolder then\n\tfor _, coin in ipairs(levelFolder:GetChildren()) do\n\t\tif coin:IsA(\"BasePart\") and coin.Name == \"Coin\" then\n\t\t\tcoin.Touched:Connect(function(hit)\n\t\t\t\tlocal player = hit.Parent and Players:GetPlayerFromCharacter(hit.Parent)\n\t\t\t\tif not player or coin:GetAttribute(\"Collected\") then\n\t\t\t\t\treturn\n\t\t\t\tend\n\t\t\t\tcoin:SetAttribute(\"Collected\", true)\n\t\t\t\tcoin.Transparency = 1\n\t\t\t\tcoin.CanTouch = false\n\n\t\t\t\tlocal statsFolder = player:FindFirstChild(\"leaderstats\")\n\t\t\t\tif statsFolder and statsFolder:FindFirstChild(\"Coins\") then\n\t\t\t\t\tstatsFolder.Coins.Value += 1\n\t\t\t\tend\n\n\t\t\t\ttask.delay(12, function()\n\t\t\t\t\tcoin:SetAttribute(\"Collected\", false)\n\t\t\t\t\tcoin.Transparency = 0\n\t\t\t\t\tcoin.CanTouch = true\n\t\t\t\tend)\n\t\t\tend)\n\t\tend\n\tend\nend\n\nprint(\"[Stats] Serwer obby wystartował.\")\n",
		},
		{
			path = "src/client/Hud.client.luau",
			content = "--[[\n\tHUD – cały interfejs rysowany w kodzie (bez plików graficznych).\n\tKlient tylko czyta stan i wyświetla; nic tu nie decyduje o rozgrywce.\n]]\nlocal Players = game:GetService(\"Players\")\nlocal ReplicatedStorage = game:GetService(\"ReplicatedStorage\")\nlocal RunService = game:GetService(\"RunService\")\nlocal TweenService = game:GetService(\"TweenService\")\n\nlocal player = Players.LocalPlayer\nlocal playerGui = player:WaitForChild(\"PlayerGui\")\n\nlocal Shared = ReplicatedStorage:WaitForChild(\"Shared\")\nlocal Config = require(Shared:WaitForChild(\"Config\"))\n\nlocal gui = Instance.new(\"ScreenGui\")\ngui.Name = \"ObbyHUD\"\ngui.IgnoreGuiInset = true\ngui.ResetOnSpawn = false\ngui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling\ngui.Parent = playerGui\n\nlocal function panel(name, anchor, position, size, color)\n\tlocal frame = Instance.new(\"Frame\")\n\tframe.Name = name\n\tframe.AnchorPoint = anchor\n\tframe.Position = position\n\tframe.Size = size\n\tframe.BackgroundColor3 = color\n\tframe.BackgroundTransparency = 0.25\n\tframe.BorderSizePixel = 0\n\tframe.Parent = gui\n\n\tlocal corner = Instance.new(\"UICorner\")\n\tcorner.CornerRadius = UDim.new(0, 12)\n\tcorner.Parent = frame\n\n\tlocal stroke = Instance.new(\"UIStroke\")\n\tstroke.Color = Color3.fromHex(\"#FFFFFF\")\n\tstroke.Transparency = 0.75\n\tstroke.Parent = frame\n\n\treturn frame\nend\n\nlocal function label(parent, name, text, textSize, color)\n\tlocal textLabel = Instance.new(\"TextLabel\")\n\ttextLabel.Name = name\n\ttextLabel.BackgroundTransparency = 1\n\ttextLabel.Size = UDim2.fromScale(1, 1)\n\ttextLabel.Font = Enum.Font.GothamBold\n\ttextLabel.TextScaled = true\n\ttextLabel.Text = text\n\ttextLabel.TextColor3 = color\n\ttextLabel.Parent = parent\n\tlocal constrain = Instance.new(\"UITextSizeConstraint\")\n\tconstrain.MaxTextSize = textSize\n\tconstrain.Parent = textLabel\n\treturn textLabel\nend\n\nlocal stagePanel = panel(\"StagePanel\", Vector2.new(0, 0), UDim2.new(0, 18, 0, 18), UDim2.fromOffset(190, 54), Color3.fromHex(\"#141828\"))\nlocal stageLabel = label(stagePanel, \"Stage\", \"ETAP 1\", 30, Color3.fromHex(Config.Colors.Platform))\n\nlocal coinPanel = panel(\"CoinPanel\", Vector2.new(1, 0), UDim2.new(1, -18, 0, 18), UDim2.fromOffset(170, 54), Color3.fromHex(\"#141828\"))\nlocal coinLabel = label(coinPanel, \"Coins\", \"0 monet\", 28, Color3.fromHex(Config.Colors.Coin))\n\nlocal timerPanel = panel(\"TimerPanel\", Vector2.new(1, 0), UDim2.new(1, -18, 0, 84), UDim2.fromOffset(170, 40), Color3.fromHex(\"#141828\"))\ntimerPanel.BackgroundTransparency = 0.5\nlocal timerLabel = label(timerPanel, \"Time\", \"0:00\", 24, Color3.fromHex(\"#E0E6FF\"))\n\nlocal toastHolder = Instance.new(\"Frame\")\ntoastHolder.Name = \"Toasts\"\ntoastHolder.AnchorPoint = Vector2.new(0.5, 1)\ntoastHolder.Position = UDim2.new(0.5, 0, 1, -28)\ntoastHolder.Size = UDim2.fromOffset(420, 200)\ntoastHolder.BackgroundTransparency = 1\ntoastHolder.Parent = gui\n\nlocal function toast(text, color)\n\tlocal frame = Instance.new(\"Frame\")\n\tframe.Size = UDim2.fromOffset(400, 46)\n\tframe.Position = UDim2.new(0.5, -200, 1, 0)\n\tframe.BackgroundColor3 = Color3.fromHex(\"#101427\")\n\tframe.BackgroundTransparency = 0.1\n\tframe.BorderSizePixel = 0\n\tframe.Parent = toastHolder\n\n\tlocal corner = Instance.new(\"UICorner\")\n\tcorner.CornerRadius = UDim.new(0, 10)\n\tcorner.Parent = frame\n\n\tlocal textLabel = Instance.new(\"TextLabel\")\n\ttextLabel.BackgroundTransparency = 1\n\ttextLabel.Size = UDim2.fromScale(1, 1)\n\ttextLabel.Font = Enum.Font.GothamBold\n\ttextLabel.TextScaled = true\n\ttextLabel.Text = text\n\ttextLabel.TextColor3 = color or Color3.fromHex(\"#FFFFFF\")\n\ttextLabel.Parent = frame\n\n\tlocal constrain = Instance.new(\"UITextSizeConstraint\")\n\tconstrain.MaxTextSize = 26\n\tconstrain.Parent = textLabel\n\n\tlocal tweenIn = TweenService:Create(frame, TweenInfo.new(0.25), { Position = UDim2.new(0.5, -200, 0, #toastHolder:GetChildren() * -52) })\n\ttweenIn:Play()\n\ttask.delay(2.6, function()\n\t\tlocal fade = TweenService:Create(frame, TweenInfo.new(0.4), { BackgroundTransparency = 1 })\n\t\tfade:Play()\n\t\tlocal textFade = TweenService:Create(textLabel, TweenInfo.new(0.4), { TextTransparency = 1 })\n\t\ttextFade:Play()\n\t\ttask.wait(0.45)\n\t\tframe:Destroy()\n\tend)\nend\n\n-- Reset przyciskiem R (klient prosi serwer, to serwer decyduje).\nlocal UserInputService = game:GetService(\"UserInputService\")\nlocal remotes = ReplicatedStorage:WaitForChild(\"Remotes\")\nlocal notify = remotes:WaitForChild(Config.Remotes.Notify)\nlocal resetRemote = remotes:WaitForChild(Config.Remotes.Reset)\n\nnotify.OnClientEvent:Connect(function(message, color)\n\ttoast(message, color)\nend)\n\nUserInputService.InputBegan:Connect(function(input, gameProcessed)\n\tif gameProcessed then\n\t\treturn\n\tend\n\tif input.KeyCode == Enum.KeyCode.R then\n\t\tresetRemote:FireServer()\n\tend\n\tif input.KeyCode == Enum.KeyCode.H then\n\t\tgui.Enabled = not gui.Enabled\n\tend\nend)\n\nlocal startedAt = os.clock()\nlocal statsFolder = player:WaitForChild(\"leaderstats\")\n\nstatsFolder:WaitForChild(\"Stage\").Changed:Connect(function(value)\n\tstageLabel.Text = \"ETAP \" .. tostring(value)\n\tstageLabel.TextColor3 = Color3.fromHex(Config.Colors.Finish)\n\tTweenService:Create(stageLabel, TweenInfo.new(0.3), { TextTransparency = 0.4 }):Play()\n\ttask.delay(0.3, function()\n\t\tTweenService:Create(stageLabel, TweenInfo.new(0.3), { TextTransparency = 0 }):Play()\n\tend)\nend)\n\nstatsFolder:WaitForChild(\"Coins\").Changed:Connect(function(value)\n\tcoinLabel.Text = tostring(value) .. \" monet\"\nend)\n\nRunService.RenderStepped:Connect(function()\n\tlocal elapsed = math.floor(os.clock() - startedAt)\n\ttimerLabel.Text = string.format(\"%d:%02d\", math.floor(elapsed / 60), elapsed % 60)\nend)\n",
		},
		{
			path = "src/client/Effects.client.luau",
			content = "--[[\n\tEffects – odczucia gracza: rozmycie prędkości (FOV), efekt śmierci,\n\tlekki wstrząs kamery przy upadku. Wyłącznie warstwa klienta.\n]]\nlocal Players = game:GetService(\"Players\")\nlocal RunService = game:GetService(\"RunService\")\nlocal TweenService = game:GetService(\"TweenService\")\nlocal Lighting = game:GetService(\"Lighting\")\n\nlocal player = Players.LocalPlayer\nlocal camera = workspace.CurrentCamera\n\nlocal BASE_FOV = 70\nlocal FAST_FOV = 88\nlocal currentFov = BASE_FOV\n\nlocal colorCorrection = Lighting:FindFirstChild(\"ObbyGrading\")\nif not colorCorrection then\n\tcolorCorrection = Instance.new(\"ColorCorrectionEffect\")\n\tcolorCorrection.Name = \"ObbyGrading\"\n\tcolorCorrection.Saturation = 0.08\n\tcolorCorrection.Contrast = 0.06\n\tcolorCorrection.Parent = Lighting\nend\n\nlocal function onCharacter(character)\n\tlocal humanoid = character:WaitForChild(\"Humanoid\")\n\tlocal root = character:WaitForChild(\"HumanoidRootPart\")\n\n\thumanoid.Died:Connect(function()\n\t\t-- Czerwony błysk + mocny zoom = czytelny sygnał \"przegrałeś\".\n\t\tlocal flash = Instance.new(\"ColorCorrectionEffect\")\n\t\tflash.Name = \"DeathFlash\"\n\t\tflash.Saturation = -0.4\n\t\tflash.Contrast = 0.5\n\t\tflash.TintColor = Color3.fromHex(\"#FF4A4A\")\n\t\tflash.Parent = Lighting\n\n\t\tcamera.FieldOfView = 92\n\t\tTweenService:Create(camera, TweenInfo.new(0.5), { FieldOfView = BASE_FOV }):Play()\n\t\tTweenService:Create(flash, TweenInfo.new(0.9), { Contrast = 0, Saturation = 0, TintColor = Color3.new(1, 1, 1) }):Play()\n\t\ttask.wait(1)\n\t\tflash:Destroy()\n\tend)\n\n\t-- Wstrząs kamery podczas szybkiego spadania: im szybciej, tym mocniej.\n\tRunService.RenderStepped:Connect(function(dt)\n\t\tif not root or not root.Parent or humanoid.Health <= 0 then\n\t\t\treturn\n\t\tend\n\t\tlocal velocity = root.AssemblyLinearVelocity\n\t\tlocal fallSpeed = math.clamp(-velocity.Y, 0, 220)\n\n\t\tlocal targetFov = BASE_FOV + (FAST_FOV - BASE_FOV) * (fallSpeed / 220)\n\t\tcurrentFov += (targetFov - currentFov) * math.clamp(dt * 6, 0, 1)\n\t\tcamera.FieldOfView = currentFov\n\n\t\tif fallSpeed > 140 then\n\t\t\tlocal strength = (fallSpeed - 140) / 80 * 0.6\n\t\t\tcamera.CFrame = camera.CFrame * CFrame.new(\n\t\t\t\t(math.random() - 0.5) * strength * 0.35,\n\t\t\t\t(math.random() - 0.5) * strength * 0.35,\n\t\t\t\t0\n\t\t\t)\n\t\tend\n\tend)\nend\n\nif player.Character then\n\ttask.spawn(onCharacter, player.Character)\nend\nplayer.CharacterAdded:Connect(onCharacter)\n",
		},
	},
	world = {
		className = "Folder",
		name = "World",
		properties = {},
		children = {
			{
				className = "Part",
				name = "LobbyBase",
				properties = {
					Size = {
						44,
						2,
						44,
					},
					Position = {
						0,
						-1,
						0,
					},
					Color = "#2B2F45",
					Material = "SmoothPlastic",
					Anchored = true,
					CanCollide = true,
				},
			},
			{
				className = "SpawnLocation",
				name = "LobbySpawn",
				properties = {
					Size = {
						12,
						1,
						12,
					},
					Position = {
						0,
						1,
						0,
					},
					Color = "#4FC3F7",
					Material = "Neon",
					Duration = 0,
					Anchored = true,
				},
			},
			{
				className = "Part",
				name = "RulesBoard",
				properties = {
					Size = {
						26,
						12,
						1,
					},
					Position = {
						0,
						8,
						-20,
					},
					Color = "#141828",
					Material = "SmoothPlastic",
					Anchored = true,
				},
				children = {
					{
						className = "SurfaceGui",
						name = "BoardGui",
						properties = {
							Face = "Front",
							CanvasSize = {
								800,
								400,
							},
							LightInfluence = 0,
						},
						children = {
							{
								className = "TextLabel",
								name = "Rules",
								properties = {
									Size = {
										1,
										1,
									},
									BackgroundTransparency = 1,
									TextScaled = true,
									Font = "GothamBold",
									TextColor3 = "#8FE3FF",
									Text = "NEON SKYWAY OBBY  |  Skacz po platformach, zbieraj monety, dotrzyj do zielonej mety. R = reset, H = HUD.",
								},
							},
						},
					},
				},
			},
			{
				className = "Folder",
				name = "GeneratedLevel",
				properties = {},
			},
			{
				className = "Folder",
				name = "Decor",
				properties = {},
				children = {
					{
						className = "Part",
						name = "GlowPillarLeft",
						properties = {
							Size = {
								2,
								16,
								2,
							},
							Position = {
								-18,
								8,
								-16,
							},
							Color = "#7E57C2",
							Material = "Neon",
							Anchored = true,
						},
						children = {
							{
								className = "PointLight",
								name = "Glow",
								properties = {
									Color = "#9C7BFF",
									Brightness = 3,
									Range = 40,
								},
							},
						},
					},
					{
						className = "Part",
						name = "GlowPillarRight",
						properties = {
							Size = {
								2,
								16,
								2,
							},
							Position = {
								18,
								8,
								-16,
							},
							Color = "#4FC3F7",
							Material = "Neon",
							Anchored = true,
						},
						children = {
							{
								className = "PointLight",
								name = "Glow",
								properties = {
									Color = "#7FE7FF",
									Brightness = 3,
									Range = 40,
								},
							},
						},
					},
				},
			},
		},
	},
	lighting = {
		ClockTime = 15,
		Ambient = "#6E7B94",
		OutdoorAmbient = "#8A94A8",
		Brightness = 2,
		GlobalShadows = true,
		Technology = "ShadowMap",
		FogEnd = 1200,
		FogColor = "#20233A",
	},
}

-- ==================================================================
--  Część wykonawcza wtyczki: buduje grę w otwartym miejscu.
-- ==================================================================
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local Selection = game:GetService("Selection")
local Lighting = game:GetService("Lighting")

local SERVICES = {
	server = "ServerScriptService",
	client = "StarterPlayer",
	shared = "ReplicatedStorage",
	startergui = "StarterGui",
	replicatedstorage = "ReplicatedStorage",
	workspace = "Workspace",
	serverstorage = "ServerStorage",
	soundservice = "SoundService",
	lighting = "Lighting",
}

local ENUMS = {
	Material = Enum.Material,
	SurfaceType = Enum.SurfaceType,
	PartType = Enum.PartType,
	Font = Enum.Font,
	EasingStyle = Enum.EasingStyle,
	Technology = Enum.Technology,
	NormalId = Enum.NormalId,
	Face = Enum.NormalId,
	Shape = Enum.PartType,
	TopSurface = Enum.SurfaceType,
	BottomSurface = Enum.SurfaceType,
	FrontSurface = Enum.SurfaceType,
	BackSurface = Enum.SurfaceType,
	LeftSurface = Enum.SurfaceType,
	RightSurface = Enum.SurfaceType,
}

local function hexToColor3(hex)
	local cleaned = string.gsub(string.upper(tostring(hex)), "#", "")
	if #cleaned ~= 6 then
		return Color3.fromRGB(163, 163, 163)
	end
	local r = tonumber(string.sub(cleaned, 1, 2), 16) or 163
	local g = tonumber(string.sub(cleaned, 3, 4), 16) or 163
	local b = tonumber(string.sub(cleaned, 5, 6), 16) or 163
	return Color3.fromRGB(r, g, b)
end

local function isHex(value)
	return type(value) == "string" and string.match(value, "^#?%x%x%x%x%x%x$") ~= nil
end

-- Ustawia właściwość instancji niezależnie od tego, jak zapisał ją generator.
local function applyProperty(instance, key, value)
	local enum = ENUMS[key]
	if enum and type(value) == "string" then
		local ok, item = pcall(function()
			return enum[value]
		end)
		if ok and item then
			pcall(function()
				instance[key] = item
			end)
			return
		end
	end

	if key == "CFrame" then
		if type(value) == "table" then
			local position = value.position or value.Position or { 0, 0, 0 }
			local rotation = value.rotation or { 0, 0, 0 }
			local pos = Vector3.new(position[1] or 0, position[2] or 0, position[3] or 0)
			local ok = pcall(function()
				instance.CFrame = CFrame.new(pos) * CFrame.Angles(
					math.rad(rotation[1] or 0), math.rad(rotation[2] or 0), math.rad(rotation[3] or 0)
				)
			end)
			if ok then
				return
			end
		end
	end

	if type(value) == "table" then
		if #value == 3 and (isHex(value[1]) or type(value[1]) == "number") then
			if isHex(value[1]) or (value[1] <= 1 and value[2] <= 1 and value[3] <= 1 and (value[1] % 1 ~= 0)) then
				pcall(function()
					instance[key] = Color3.new(value[1], value[2], value[3])
				end)
			else
				pcall(function()
					instance[key] = Vector3.new(value[1], value[2], value[3])
				end)
			end
			return
		end
		if key == "NumberRange" and #value == 2 then
			pcall(function()
				instance[key] = NumberRange.new(value[1], value[2])
			end)
			return
		end
		if #value == 4 and string.match(key, "^UDim2?") then
			pcall(function()
				instance[key] = UDim2.new(value[1], value[2], value[3], value[4])
			end)
			return
		end
	end

	if type(value) == "string" and isHex(value) then
		pcall(function()
			instance[key] = hexToColor3(value)
		end)
		return
	end

	pcall(function()
		instance[key] = value
	end)
end

local function buildNode(parent, node, counters, log)
	if type(node) ~= "table" then
		return nil
	end

	local className = node.className or "Folder"
	local ok, instance = pcall(Instance.new, className)
	if not ok or not instance then
		log("Pominięto nieznaną klasę: " .. tostring(className))
		counters.skipped += 1
		return nil
	end

	instance.Name = node.name or className
	for key, value in pairs(node.properties or {}) do
		if key ~= "Name" then
			applyProperty(instance, key, value)
		end
	end
	if node.source then
		local sourceOk = pcall(function()
			instance.Source = node.source
		end)
		if not sourceOk then
			log("Nie udało się ustawić kodu (brak uprawnień): " .. instance.Name)
		end
	end

	instance.Parent = parent
	counters.nodes += 1

	for _, child in ipairs(node.children or {}) do
		buildNode(instance, child, counters, log)
	end
	return instance
end

--- Zamienia listę plików Luau (Rojo) na skrypty w odpowiednich usługach.
local function buildScripts(root, files, counters, log)
	local function folderAt(parent, name)
		local existing = parent:FindFirstChild(name)
		if existing and existing:IsA("Folder") then
			return existing
		end
		local folder = Instance.new("Folder")
		folder.Name = name
		folder.Parent = parent
		return folder
	end

	for _, file in ipairs(files) do
		local parts = {}
		for segment in string.gmatch(file.path, "[^/]+") do
			table.insert(parts, segment)
		end
		if parts[1] == "src" then
			table.remove(parts, 1)
		end

		local fileName = table.remove(parts) or "Script"
		local bucket = string.lower(table.remove(parts) or "")
		local serviceName = SERVICES[bucket] or "ServerStorage"
		local service = game:GetService(serviceName)

		local container = service
		if bucket == "client" then
			container = service:FindFirstChild("StarterPlayerScripts") or service
		elseif bucket == "shared" then
			container = folderAt(service, "Shared")
		elseif bucket == "server" then
			container = service
		end

		for _, segment in ipairs(parts) do
			container = folderAt(container, segment)
		end

		-- Ta sama reguła co w eksporcie .rbxmx:
		--   *.server.luau -> Script, *.client.luau -> LocalScript, reszta -> ModuleScript
		local isServerScript = string.match(fileName, "%.server%.luau?$") ~= nil
		local isClientScript = string.match(fileName, "%.client%.luau?$") ~= nil

		local instanceName = string.gsub(string.gsub(fileName, "%.luau$", ""), "%.lua$", "")
		instanceName = string.gsub(string.gsub(instanceName, "%.server$", ""), "%.client$", "")

		local className = "ModuleScript"
		if isServerScript then
			className = "Script"
		elseif isClientScript then
			className = "LocalScript"
		end

		local script = Instance.new(className)
		script.Name = instanceName
		local ok = pcall(function()
			script.Source = file.content
		end)
		if not ok then
			log("Nie udało się zapisać kodu: " .. file.path)
		end
		script.Parent = container
		counters.scripts += 1
	end
end

--- Buduje całą grę w otwartym miejscu (idempotentnie: nadpisuje poprzedni folder).
local function buildGame(log)
	local counters = { nodes = 0, scripts = 0, skipped = 0 }
	local recording = ChangeHistoryService:TryBeginRecording("Roblox AI Game Builder")

	local existing = workspace:FindFirstChild(PROJECT.name)
	if existing then
		existing:Destroy()
	end

	local root = Instance.new("Folder")
	root.Name = PROJECT.name
	root.Parent = workspace

	if PROJECT.world then
		buildNode(root, PROJECT.world, counters, log)
	end
	for key, value in pairs(PROJECT.lighting or {}) do
		applyProperty(Lighting, key, value)
	end

	buildScripts(root, PROJECT.files, counters, log)

	if recording then
		ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit)
	end

	log(string.format("Gotowe: %d instancji, %d skryptów.", counters.nodes, counters.scripts))
	return root
end

-- ==================================================================
--  Interfejs wtyczki
-- ==================================================================
local toolbar = plugin:CreateToolbar("Roblox AI Game Builder")
local buildButton = toolbar:CreateButton("Buduj grę", "Buduje wygenerowaną grę w tym miejscu", "rbxasset://textures/AnimationEditor/icon_play.png")
local selectButton = toolbar:CreateButton("Zaznacz folder", "Zaznacza folder gry", "rbxasset://textures/AnimationEditor/icon_pause.png")

local function log(message)
	print("[RobloxAIGameBuilder] " .. message)
end

buildButton.Click:Connect(function()
	local root = buildGame(log)
	if root then
		Selection:Set({ root })
		log("Folder gry: " .. root.Name .. " (skrypty są już w usługach)")
	end
end)

selectButton.Click:Connect(function()
	local root = workspace:FindFirstChild(PROJECT.name)
	if root then
		Selection:Set({ root })
	else
		log("Najpierw zbuduj grę.")
	end
end)

log("Wtyczka gotowa. Gra: " .. PROJECT.name .. " (" .. tostring(#PROJECT.files) .. " plików Luau). Naciśnij \"Buduj grę\".");
