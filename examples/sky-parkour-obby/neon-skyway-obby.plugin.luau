--[[
	Roblox AI Game Builder – wtyczka Studio z wbudowaną grą i generatorem AI.

	Gra: Neon Skyway Obby
	Pokonaj 26 ruchomych platform nad jeziorem lawy – checkpoint po checkpoincie.
	Pliki Luau: 6 | Wygenerowano: 2026-09-20
	Adres lokalnego buildera: http://127.0.0.1:5173
	Klucz API nie jest zapisany w tym pliku – bezpieczniej.

	INSTALACJA
	  1. Zapisz ten plik jako RobloxAIGameBuilder.plugin.luau
	  2. W Roblox Studio: Plugins -> Plugins Folder (otworzy folder w eksploratorze)
	  3. Skopiuj plik do tego folderu i zrestartuj Studio
	  4. Na pasku wtyczek: "Roblox AI Game Builder"
	       - "Buduj grę"  -> wstawia mapę i skrypty w otwarte miejsce
	       - "AI Builder" -> panel: zmiany przez AI, skan zaślepek, darmowe assety, ikona

	ZMIANY PRZEZ AI wymagają uruchomionego lokalnego buildera (w folderze projektu: npm start)
	oraz włączonego "Allow HTTP Requests" w Game Settings -> Security.
]]
--!nocheck

local PROJECT = {
	name = "Neon Skyway Obby",
	tagline = "Pokonaj 26 ruchomych platform nad jeziorem lawy – checkpoint po checkpoincie.",
	summary = "Proceduralny tor parkour nad przepaścią z lawą. Każda platforma jest inna, część jeździ w bok, a każdy szósty etap to checkpoint, do którego wracasz po śmierci. Zbierasz monety i ścigasz się z czasem.",
	genre = "Obby",
	projectId = nil,
	notes = {
		"Tor buduje się proceduralnie z seeda Config.Seed – zmiana liczby = nowy level, bez rysowania w Studio.",
		"Checkpointy to SpawnLocation-y ustawiane jako player.RespawnLocation, więc respawn działa \"z pudelka\" i jest po stronie serwera.",
		"Całe UI powstaje w kodzie, więc projekt nie zależy od żadnego assetu z Toolboxa.",
	},
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
	design = {
		name = "Neon Skyway Obby",
		tagline = "Pokonaj 26 ruchomych platform nad jeziorem lawy – checkpoint po checkpoincie.",
		genre = "Obby / Platformówka",
		summary = "Proceduralny tor parkour nad przepaścią z lawą. Każda platforma jest inna, część jeździ w bok, a każdy szósty etap to checkpoint, do którego wracasz po śmierci. Zbierasz monety i ścigasz się z czasem.",
		coreLoop = "1. Skok na kolejną platformę. 2. Unikaj lawy i ruchomych przeszkód. 3. Zaliczenie checkpointu zapisuje postęp. 4. Zbieraj monety po drodze. 5. Dotrzyj do mety po nagrodę.",
		sessionLength = "3-8 min",
		audience = "9-14 lat, gracze obby i speedrunów",
		monetizationIdeas = {
			"Gamepass \"Respawn w miejscu śmierci\" – najczęstszy zakup w obby, bo skraca frustrację.",
			"Gamepass \"Podwójne monety\" dla graczy farmiących sklep.",
			"Dev product \"Pomiń etap\" – ratunek dla graczy tkwiących na trudnym skoku.",
		},
		systems = {
			{
				name = "Proceduralny tor",
				purpose = "Nieograniczona regrywalność z jednego seeda",
				serverAuthority = "Seed i geometria istnieją tylko na serwerze",
				keyParameters = {
					PlatformCount = 26,
					GapMin = 9,
					GapMax = 18,
					HeightStep = 2,
				},
			},
			{
				name = "Checkpointy",
				purpose = "Postęp bez frustracji",
				serverAuthority = "Serwer trzyma numer etapu; klient nie może go podnieść",
				keyParameters = {
					CheckpointEvery = 6,
					StartStage = 1,
				},
			},
			{
				name = "Lawa (KillBricks)",
				purpose = "Kara za błąd bez utraty całego postępu",
				serverAuthority = "Kolizja i śmierć liczone na serwerze",
				keyParameters = {
					LavaDrop = 6,
				},
			},
			{
				name = "Monety",
				purpose = "Opłata za sklep i nagroda za eksplorację",
				serverAuthority = "Flaga Collected na instancji, 12 s respawn",
				keyParameters = {
					CoinCount = 14,
					Reward = 1,
					FinishBonus = 100,
				},
			},
			{
				name = "Ruchome platformy",
				purpose = "Zmienia timing skoków, podnosi skill ceiling",
				serverAuthority = "Tween serwerowy (deterministyczny)",
				keyParameters = {
					MovingEvery = 5,
					MovingSpeed = 0.35,
				},
			},
			{
				name = "Statystyki (leaderstats)",
				purpose = "Widoczna rywalizacja: etap i monety",
				serverAuthority = "Tylko serwer zapisuje wartości",
				keyParameters = {
					RankedStats = {
						"Stage",
						"Coins",
					},
				},
			},
		},
		controls = {
			{
				input = "WASD",
				action = "Ruch postaci (WalkSpeed 18)",
			},
			{
				input = "Space",
				action = "Skok (JumpPower 52)",
			},
			{
				input = "R",
				action = "Reset postaci po utknięciu",
			},
			{
				input = "H",
				action = "Ukryj/pokaż HUD",
			},
			{
				input = "Kółko myszy",
				action = "Zoom kamery",
			},
		},
		objectives = {
			"Przejdź wszystkie 26 etapów i dotrzyj do zielonej mety.",
			"Zbierz 14 monet po drodze.",
			"Pobij swój czas na torze (timer w HUD).",
		},
		progression = "Monety (1 za sztukę, 100 za metę) → sklep z gamepassami: podwójne monety, respawn w miejscu śmierci. Etapy zapisane w leaderstats = ranking na serwerze.",
		balancing = {
			WalkSpeed = 18,
			JumpPower = 52,
			GapMin = 9,
			GapMax = 18,
			HeightStep = 2,
			CheckpointEvery = 6,
			MovingEvery = 5,
			LavaDrop = 6,
			CoinCount = 14,
			FinishBonus = 100,
		},
		worldLayout = "Lobby to ciemna platforma 40x40 studsów z neapolitańskim spawnem i tablicą z zasadami. Za lobby (rosnące Z) rozciąga się wygenerowany tor: 26 platform, każda 5-12 studsów, różnice wysokości do 2 studsów, odstępy 9-18 studsów. Pod platformami na Y-6 znajduje się lawa pokrywająca wszystkie szczeliny. Co 6. platforma ma świecący checkpoint, co 5. jeździ w bok o 6-12 studsów. Meta to zielona platforma 24x24 z bonusem 100 monet.",
		designDoc = "## Koncept\nNeon Skyway Obby to klasyk gatunku obby w wersji \"neonowej\": ciemne tło, jaskrawe platformy, \nproceduralny tor, który za każdym razem wygląda inaczej (bo seed zmieniasz jednym numerem), ale jest sprawiedliwy – \nwszystkie skoki są do policzenia z parametrów ruchu gracza.\n\n## Pętla rozgrywki\n1. Gracz spawnuje się w lobby i widzi tablicę z zasadami.\n2. Wchodzi na tor: skok, skok, ryzyko, śmierć lub postęp.\n3. Checkpoint co 6 etapów daje satysfakcjonujące \"zapisano\".\n4. Monety po drodze tworzą drugi, opcjonalny cel.\n5. Meta daje 100 monet i wpis w leaderstats.\n\n## Systemy\n| System | Rola | Parametry |\n| --- | --- | --- |\n| LevelBuilder | Generuje tor z seeda | 26 platform, gap 9-18 |\n| CheckpointService | Zapamiętuje etap gracza | co 6 platform |\n| Lawa | Kara za błąd | Y-6 pod platformami |\n| Monety | Waluta | 14 monet, respawn 12 s |\n| Ruchome platformy | Timing | co 5 platform |\n\n## Balans\nPrzy WalkSpeed 18 i JumpPower 52 gracz przeskakuje ~9-13 studsów w poziomie. Największa szczelina (18) \njest celowo na granicy – wymaga rozpędu, ale nie jest niemożliwa. Wysokość zmienia się maksymalnie o 2 studs na skok.\n\n## Mapa\nLiniowy tor wzdłuż osi Z, lobby na Z=0, meta około Z=450. Boczny rozrzut +/-7 studsów daje wrażenie swobody \nbez gubienia gracza. Światło: popołudniowe (ClockTime 15) + cienie (ShadowMap).\n\n## UI\nHUD w lewym górnym rogu: etap. Prawy górny: monety i timer. Dolny środek: toasty (checkpoint, meta, monety). \nCałe UI generowane w kodzie – zero plików graficznych, zero problemów z moderacją assetów.\n\n## Onboarding gracza\nTablica z 3 krokami (\"Skacz\", \"Zbieraj monety\", \"Dotrzyj do mety\"), spawn na wygodnej platformie 12x12, \npierwsze 4 platformy są szerokie i płaskie, trudność rośnie dopiero od 5. etapu.\n\n## Ryzyka\n* Gracz utknie między platformami → przycisk R (reset) i checkpoint co 6 etapów.\n* Zbyt duże szczeliny → wszystkie limity w Config: GapMin/GapMax do zmiany bez czytania logiki.\n* Spadki FPS od lawy → lawa to proste Part-y z Materiałem Neon, bez cząstek na każdej platformie.",
	},
	plan = {
		architecture = "Serwer jest autorytetem: buduje tor (LevelBuilder), pilnuje postępu (CheckpointService), trzyma walutę i leaderstats (Stats).\nKlient (HUD, Effects) nie modyfikuje stanu gry – wysyła tylko prośbę o reset przez RemoteEvent \"Reset\".\nSerwer wysyła komunikaty UI przez RemoteEvent \"Notify\" (tekst + kolor), które HUD pokazuje jako toast.\nConfig w ReplicatedStorage.Shared jest wspólny: te same kolory, te same nazwy remotów po obu stronach.",
		remoteEvents = {
			{
				name = "Notify",
				direction = "server->client",
				payload = "message: string, color: Color3?",
			},
			{
				name = "Reset",
				direction = "client->server",
				payload = "(brak) – prośba o respawn postaci",
			},
		},
		files = {
			{
				path = "src/shared/Config.luau",
				kind = "module",
				purpose = "Liczby balansu, kolory, nazwy remotów",
				exports = {
					"Config",
				},
				requires = {},
				lines = 45,
			},
			{
				path = "src/server/CheckpointService.luau",
				kind = "module",
				purpose = "Postęp gracza i RespawnLocation",
				exports = {
					"CheckpointService",
				},
				requires = {
					"src/shared/Config.luau",
				},
				lines = 70,
			},
			{
				path = "src/server/LevelBuilder.server.luau",
				kind = "server",
				purpose = "Proceduralna budowa toru",
				exports = {},
				requires = {
					"src/shared/Config.luau",
					"src/server/CheckpointService.luau",
				},
				lines = 200,
			},
			{
				path = "src/server/Stats.server.luau",
				kind = "server",
				purpose = "leaderstats, statystyki postaci, monety, remotes",
				exports = {},
				requires = {
					"src/shared/Config.luau",
					"src/server/CheckpointService.luau",
				},
				lines = 110,
			},
			{
				path = "src/client/Hud.client.luau",
				kind = "client",
				purpose = "HUD: etap, monety, timer, toasty",
				exports = {},
				requires = {
					"src/shared/Config.luau",
				},
				lines = 170,
			},
			{
				path = "src/client/Effects.client.luau",
				kind = "client",
				purpose = "FOV, efekt śmierci, wstrząs kamery",
				exports = {},
				requires = {},
				lines = 90,
			},
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

local PROJECT_CONFIG = {
	serverUrl = "http://127.0.0.1:5173",
	language = "pl",
	model = {
		provider = "",
		model = "",
		apiKey = "",
		baseUrl = "",
	},
}


--==================================================================
--  SILNIK: budowanie projektu, serializacja, HTTP, placeholdery
--==================================================================
local HttpService = game:GetService("HttpService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local Selection = game:GetService("Selection")
local Lighting = game:GetService("Lighting")
local TweenService = game:GetService("TweenService")
local Players = game:GetService("Players")

local SERVER_URL = PROJECT_CONFIG.serverUrl
local PROJECT_FOLDER_NAME = PROJECT.name
local HIDDEN_ROOT = "__AIGame_" .. PROJECT_FOLDER_NAME

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

local function log(message)
	print("[AI Builder] " .. tostring(message))
end

local function warnOnce(message)
	warn("[AI Builder] " .. tostring(message))
end

-- ---------------------------------------------------------------- --
--  Konwersje właściwości (identyczne z eksportem .rbxmx)
-- ---------------------------------------------------------------- --
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

	if key == "CFrame" and type(value) == "table" then
		local position = value.position or value.Position or { 0, 0, 0 }
		local rotation = value.rotation or { 0, 0, 0 }
		local ok = pcall(function()
			instance.CFrame = CFrame.new(Vector3.new(position[1] or 0, position[2] or 0, position[3] or 0))
				* CFrame.Angles(math.rad(rotation[1] or 0), math.rad(rotation[2] or 0), math.rad(rotation[3] or 0))
		end)
		if ok then
			return
		end
	end

	if type(value) == "table" then
		if #value == 4 and string.match(key, "^UDim2?") then
			pcall(function()
				instance[key] = UDim2.new(value[1], value[2], value[3], value[4])
			end)
			return
		end
		if key == "NumberRange" and #value == 2 then
			pcall(function()
				instance[key] = NumberRange.new(value[1], value[2])
			end)
			return
		end
		if #value == 3 then
			local isColour = isHex(value[1]) or (#value == 3 and value[1] <= 1 and value[2] <= 1 and value[3] <= 1 and value[1] % 1 ~= 0)
			if isColour then
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
	end

	if isHex(value) and key ~= "Name" then
		pcall(function()
			instance[key] = hexToColor3(value)
		end)
		return
	end

	pcall(function()
		instance[key] = value
	end)
end

-- ---------------------------------------------------------------- --
--  Budowanie
-- ---------------------------------------------------------------- --
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

local function buildNode(parent, node, counters)
	if type(node) ~= "table" then
		return nil
	end
	local className = node.className or "Folder"
	local ok, instance = pcall(Instance.new, className)
	if not ok or not instance then
		counters.skipped = counters.skipped + 1
		return nil
	end
	pcall(function()
		instance.Name = node.name or className
	end)
	for key, value in pairs(node.properties or {}) do
		if key ~= "Name" then
			applyProperty(instance, key, value)
		end
	end
	if node.source then
		pcall(function()
			instance.Source = node.source
		end)
	end
	instance.Parent = parent
	counters.nodes = counters.nodes + 1
	for _, child in ipairs(node.children or {}) do
		buildNode(instance, child, counters)
	end
	return instance
end

local function scriptClassFor(fileName, bucket)
	if string.match(fileName, "%.server%.luau?$") then
		return "Script"
	end
	if string.match(fileName, "%.client%.luau?$") then
		return "LocalScript"
	end
	if bucket == "client" then
		return "ModuleScript"
	end
	return "ModuleScript"
end

local function buildScripts(files, counters)
	for _, file in ipairs(files) do
		local parts = {}
		for segment in string.gmatch(file.path, "[^/]+") do
			table.insert(parts, segment)
		end
		if parts[1] == "src" then
			table.remove(parts, 1)
		end
		local fileName = table.remove(parts) or "Script"
		if string.match(fileName, "%.md$") then
			continue
		end
		local bucket = string.lower(table.remove(parts) or "")
		local serviceName = SERVICES[bucket] or "ServerStorage"
		local service = game:GetService(serviceName)
		local container = service

		if bucket == "client" then
			container = service:FindFirstChild("StarterPlayerScripts") or service
		elseif bucket == "shared" then
			container = folderAt(service, "Shared")
		end
		for _, segment in ipairs(parts) do
			container = folderAt(container, segment)
		end

		local className = scriptClassFor(fileName, bucket)
		local instanceName = string.gsub(string.gsub(string.gsub(fileName, "%.luau$", ""), "%.lua$", ""), "%.server$", "")
		instanceName = string.gsub(instanceName, "%.client$", "")

		local script_ = Instance.new(className)
		script_.Name = instanceName
		local ok = pcall(function()
			script_.Source = file.content
		end)
		if not ok then
			warnOnce("Nie udało się zapisać kodu: " .. file.path)
		end
		script_.Parent = container
		counters.scripts = counters.scripts + 1
	end
end

local function buildProject(payload, counters)
	local recording = ChangeHistoryService:TryBeginRecording("Roblox AI Game Builder")

	local existing = workspace:FindFirstChild(PROJECT_FOLDER_NAME)
	if existing then
		existing:Destroy()
	end
	local hidden = ServerStorage:FindFirstChild(HIDDEN_ROOT)
	if hidden then
		hidden:Destroy()
	end

	local root = Instance.new("Folder")
	root.Name = PROJECT_FOLDER_NAME
	root.Parent = workspace

	if payload.world then
		buildNode(root, payload.world, counters)
	end
	for key, value in pairs(payload.lighting or {}) do
		applyProperty(Lighting, key, value)
	end
	buildScripts(payload.files or {}, counters)

	if recording then
		ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit)
	end
	return root
end

-- ---------------------------------------------------------------- --
--  Serializacja otwartego miejsca (dla "poproś o zmianę")
-- ---------------------------------------------------------------- --
local function serializeInstance(instance, depth)
	if depth > 6 then
		return nil
	end
	local node = {
		className = instance.ClassName,
		name = instance.Name,
		properties = {},
		children = {},
	}
	if instance:IsA("BasePart") then
		node.properties.Size = { instance.Size.X, instance.Size.Y, instance.Size.Z }
		node.properties.Position = { instance.Position.X, instance.Position.Y, instance.Position.Z }
		node.properties.Orientation = { instance.Orientation.X, instance.Orientation.Y, instance.Orientation.Z }
		node.properties.Anchored = instance.Anchored
		node.properties.CanCollide = instance.CanCollide
		node.properties.Color = string.format("#%02X%02X%02X",
			math.floor(instance.Color.R * 255), math.floor(instance.Color.G * 255), math.floor(instance.Color.B * 255))
		node.properties.Material = instance.Material.Name
		node.properties.Transparency = instance.Transparency
	elseif instance:IsA("SpawnLocation") then
		node.properties.Duration = instance.Duration
	elseif instance:IsA("PointLight") or instance:IsA("SpotLight") then
		node.properties.Brightness = instance.Brightness
		node.properties.Range = instance.Range
		node.properties.Color = string.format("#%02X%02X%02X",
			math.floor(instance.Color.R * 255), math.floor(instance.Color.G * 255), math.floor(instance.Color.B * 255))
	elseif instance:IsA("TextLabel") or instance:IsA("TextButton") then
		node.properties.Text = instance.Text
		node.properties.TextScaled = instance.TextScaled
		node.properties.Font = instance.Font.Name
	end
	for _, child in ipairs(instance:GetChildren()) do
		if child:IsA("LuaSourceContainer") then
			continue
		end
		local serialized = serializeInstance(child, depth + 1)
		if serialized then
			table.insert(node.children, serialized)
		end
	end
	if #node.children == 0 then
		node.children = nil
	end
	return node
end

local function findProjectRoot()
	local root = workspace:FindFirstChild(PROJECT_FOLDER_NAME)
	if root then
		return root
	end
	return nil
end

local function collectFiles(root)
	local files = {}
	if not root then
		return files
	end
	for _, serviceName in ipairs({ "ServerScriptService", "ReplicatedStorage", "StarterPlayer", "StarterGui", "ServerStorage" }) do
		local service = game:GetService(serviceName)
		local ok = pcall(function()
			for _, descendant in ipairs(service:GetDescendants()) do
				if descendant:IsA("LuaSourceContainer") and descendant.Source ~= "" then
					table.insert(files, { path = "src/" .. serviceName .. "/" .. descendant.Name .. ".luau", content = descendant.Source })
				end
			end
		end)
		if not ok then
			-- ServerStorage/ServerScriptService są dostępne w Studio, więc to nie powinno się zdarzyć
		end
	end
	return files
end

local function projectPayloadForRefine()
	local root = findProjectRoot()
	local files = PROJEKT_FILES()
	if root then
		local liveFiles = collectFiles(root)
		if #liveFiles > #files then
			files = liveFiles
		end
	end
	return {
		name = PROJECT.name,
		summary = PROJECT.summary or "",
		genre = PROJECT.genre or "",
		design = PROJECT.design,
		plan = PROJECT.plan,
		notes = PROJECT.notes or {},
		files = files,
		world = PROJECT.world and { world = PROJECT.world, lighting = PROJECT.lighting or {} } or nil,
	}
end

function PROJEKT_FILES()
	local files = {}
	for _, file in ipairs(PROJECT.files or {}) do
		table.insert(files, { path = file.path, content = file.content })
	end
	return files
end

-- ---------------------------------------------------------------- --
--  HTTP
-- ---------------------------------------------------------------- --
local function httpEnabled()
	local ok, enabled = pcall(function()
		return HttpService.HttpEnabled
	end)
	return ok and enabled
end

local function request(method, path, body)
	if not httpEnabled() then
		return nil, "HttpService jest wyłączony. Włącz: Game Settings → Security → Allow HTTP Requests."
	end
	local options = {
		Url = SERVER_URL .. path,
		Method = method,
		Headers = { ["Content-Type"] = "application/json" },
	}
	if body ~= nil then
		options.Body = HttpService:JSONEncode(body)
	end
	local ok, response = pcall(function()
		return HttpService:RequestAsync(options)
	end)
	if not ok then
		return nil, "Nie mogę połączyć się z lokalnym builderem (" .. SERVER_URL .. "). Uruchom: npm start"
	end
	if not response.Success then
		local detail = response.Body
		local okDecode, decoded = pcall(HttpService.JSONDecode, HttpService, response.Body)
		if okDecode and decoded and decoded.error then
			detail = decoded.error
		end
		return nil, "Serwer odpowiedział " .. tostring(response.StatusCode) .. ": " .. tostring(detail)
	end
	local okDecode, decoded = pcall(HttpService.JSONDecode, HttpService, response.Body)
	if not okDecode then
		return nil, "Nie mogę odczytać odpowiedzi serwera."
	end
	return decoded, nil
end

local function serverAlive()
	local health = request("GET", "/api/health", nil)
	return health ~= nil
end

local function pollJob(jobId, onProgress, isCancelled)
	while true do
		if isCancelled and isCancelled() then
			request("POST", "/api/jobs/" .. jobId .. "/cancel", {})
			return nil, "Anulowano."
		end
		local snapshot, err = request("GET", "/api/jobs/" .. jobId, nil)
		if not snapshot then
			return nil, err
		end
		if onProgress then
			onProgress(snapshot.progress or 0, snapshot.message or "", snapshot)
		end
		if snapshot.status == "done" then
			return snapshot.project, nil
		elseif snapshot.status == "error" then
			return nil, snapshot.error or "Generowanie nie udało się."
		elseif snapshot.status == "cancelled" then
			return nil, "Anulowano."
		end
		task.wait(0.8)
	end
end

-- ---------------------------------------------------------------- --
--  Placeholdery assetów + darmowe zamienniki
-- ---------------------------------------------------------------- --
local ASSET_FIELDS = {
	{ className = "Decal", property = "Texture", label = "Decal" },
	{ className = "ImageLabel", property = "Image", label = "Obraz w GUI" },
	{ className = "ImageButton", property = "Image", label = "Przycisk GUI" },
	{ className = "Texture", property = "Texture", label = "Tekstura" },
	{ className = "Sound", property = "SoundId", label = "Dźwięk" },
	{ className = "MeshPart", property = "MeshId", label = "Siatka 3D" },
	{ className = "SpecialMesh", property = "MeshId", label = "Siatka 3D" },
	{ className = "Animation", property = "AnimationId", label = "Animacja" },
	{ className = "ParticleEmitter", property = "Texture", label = "Cząstki" },
	{ className = "Beam", property = "Texture", label = "Wiązka" },
	{ className = "Trail", property = "Texture", label = "Ślad" },
}

local FREE_ASSETS = {
	{
		label = "Dźwięk: klik/UI",
		className = "Sound",
		property = "SoundId",
		id = "rbxassetid://9114221322",
		note = "Krótki beep – do przycisków i HUD",
	},
	{
		label = "Dźwięk: moneta",
		className = "Sound",
		property = "SoundId",
		id = "rbxassetid://9114222000",
		note = "Klasyczny dźwięk nagrody",
	},
	{
		label = "Dźwięk: eksplozja",
		className = "Sound",
		property = "SoundId",
		id = "rbxassetid://9114238056",
		note = "Do wybuchów i skoków",
	},
	{
		label = "Dźwięk: kroki",
		className = "Sound",
		property = "SoundId",
		id = "rbxassetid://9114422766",
		note = "Pętla kroków postaci",
	},
	{
		label = "Tekstura: siatka neonowa",
		className = "Texture",
		property = "Texture",
		id = "rbxassetid://7529565370",
		note = "Świecąca siatka – motyw neonowy",
	},
	{
		label = "Tekstura: metalowa płyta",
		className = "Texture",
		property = "Texture",
		id = "rbxassetid://6560377203",
		note = "Powierzchnia przemysłowa",
	},
}

local function isPlaceholderValue(value)
	if type(value) ~= "string" then
		return false
	end
	local trimmed = string.gsub(value, "%s", "")
	return trimmed == "" or trimmed == "rbxassetid://0" or trimmed == "rbxassetid://" or trimmed == "0"
end

--- Skanuje miejsce i zwraca listę propercji assetów bez wartości.
local function findPlaceholders(limit)
	limit = limit or 120
	local found = {}
	local scanned = 0
	for _, serviceName in ipairs({ "Workspace", "ReplicatedStorage", "StarterGui", "StarterPlayer", "ServerStorage", "SoundService" }) do
		local service = game:GetService(serviceName)
		local ok, descendants = pcall(function()
			return service:GetDescendants()
		end)
		if ok then
			for _, instance in ipairs(descendants) do
				scanned = scanned + 1
				for _, field in ipairs(ASSET_FIELDS) do
					if instance:IsA(field.className) then
						local okValue, value = pcall(function()
							return instance[field.property]
						end)
						if okValue and isPlaceholderValue(value) then
							table.insert(found, {
								instance = instance,
								className = instance.ClassName,
								property = field.property,
								label = field.label,
								path = instance:GetFullName(),
							})
							if #found >= limit then
								return found, scanned
							end
						end
					end
				end
			end
		end
	end
	return found, scanned
end

local function insertFreeAsset(asset, parent)
	local instance = Instance.new(asset.className)
	instance.Name = string.gsub(asset.label, "[^%w]", "_")
	pcall(function()
		instance[asset.property] = asset.id
	end)
	if instance:IsA("Sound") then
		pcall(function()
			instance.Volume = 0.5
			instance.RollOffMaxDistance = 120
		end)
	end
	instance.Parent = parent or (findProjectRoot() or workspace)
	return instance
end

-- ---------------------------------------------------------------- --
--  Ikona gry
-- ---------------------------------------------------------------- --
local function saveIcon(projectId, name, genre)
	local ok, body = pcall(function()
		return HttpService:GetAsync(SERVER_URL .. "/api/thumbnail?project=" .. tostring(projectId or "")
			.. "&name=" .. HttpService:UrlEncode(name or PROJECT.name)
			.. "&genre=" .. HttpService:UrlEncode(genre or PROJECT.genre or ""), true)
	end)
	if not ok or type(body) ~= "string" or #body < 100 then
		return nil, "Nie udało się pobrać ikony (sprawdź, czy lokalny builder działa)."
	end
	local fileName = string.gsub(PROJECT.name, "[^%w%-_]", "_") .. "-icon.png"
	local writeOk = pcall(function()
		writefile(fileName, body)
	end)
	if not writeOk then
		return nil, "Nie mogę zapisać pliku w folderze wtyczek."
	end
	return fileName, nil
end


--==================================================================
--  INTERFEJS: pasek narzędzi + dock widget z generatorem
--==================================================================
local toolbar = plugin:CreateToolbar("Roblox AI Game Builder")
local buildButton = toolbar:CreateButton("Buduj grę", "Buduje wygenerowaną grę w tym miejscu", "rbxasset://textures/AnimationEditor/icon_play.png")
local uiButton = toolbar:CreateButton("AI Builder", "Panel generatora: zmiany w grze, asset, ikona", "rbxasset://textures/AnimationEditor/icon_pause.png")

local widgetInfo = DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Right, false, false, 400, 620, 340, 480)
local widget = plugin:CreateDockWidgetPluginGui("RobloxAIGameBuilderPanel", widgetInfo)
widget.Title = "Roblox AI Game Builder"

local theme = {
	bg = Color3.fromRGB(16, 19, 34),
	panel = Color3.fromRGB(24, 28, 48),
	line = Color3.fromRGB(66, 74, 116),
	text = Color3.fromRGB(232, 236, 255),
	muted = Color3.fromRGB(154, 163, 199),
	accent = Color3.fromRGB(0, 229, 160),
	warn = Color3.fromRGB(255, 196, 0),
	err = Color3.fromRGB(255, 82, 82),
}

local function corner(parent, radius)
	local instance = Instance.new("UICorner")
	instance.CornerRadius = UDim.new(0, radius or 8)
	instance.Parent = parent
	return instance
end

local function makeFrame(parent, size, position, colour, transparency)
	local frame = Instance.new("Frame")
	frame.Size = size
	frame.Position = position
	frame.BackgroundColor3 = colour or theme.panel
	frame.BackgroundTransparency = transparency or 0
	frame.BorderSizePixel = 0
	frame.Parent = parent
	corner(frame, 8)
	return frame
end

local function makeLabel(parent, text, size, position, colour, bold)
	local label = Instance.new("TextLabel")
	label.Size = size
	label.Position = position
	label.BackgroundTransparency = 1
	label.Font = bold and Enum.Font.GothamBold or Enum.Font.Gotham
	label.Text = text
	label.TextColor3 = colour or theme.text
	label.TextSize = 13
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.TextWrapped = true
	label.Parent = parent
	return label
end

local function makeButton(parent, text, size, position, primary)
	local button = Instance.new("TextButton")
	button.Size = size
	button.Position = position
	button.BackgroundColor3 = primary and theme.accent or Color3.fromRGB(40, 46, 74)
	button.BorderSizePixel = 0
	button.Font = Enum.Font.GothamBold
	button.Text = text
	button.TextSize = 13
	button.TextColor3 = primary and Color3.fromRGB(6, 18, 14) or theme.text
	button.AutoButtonColor = true
	button.Parent = parent
	corner(button, 7)
	return button
end

local scroll = Instance.new("ScrollingFrame")
scroll.Size = UDim2.fromScale(1, 1)
scroll.BackgroundColor3 = theme.bg
scroll.BorderSizePixel = 0
scroll.ScrollBarThickness = 6
scroll.CanvasSize = UDim2.new(0, 0, 0, 1010)
scroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
scroll.Parent = widget

local pad = Instance.new("Frame")
pad.Size = UDim2.new(1, -20, 0, 0)
pad.Position = UDim2.fromOffset(10, 10)
pad.BackgroundTransparency = 1
pad.Parent = scroll

-- Nagłówek --------------------------------------------------------
local header = makeFrame(pad, UDim2.new(1, 0, 0, 72), UDim2.fromOffset(0, 0), theme.panel)
makeLabel(header, PROJECT.name, UDim2.new(1, -20, 0, 22), UDim2.fromOffset(12, 8), theme.accent, true)
makeLabel(header, (PROJECT.tagline or PROJECT.summary or ""), UDim2.new(1, -20, 0, 34), UDim2.fromOffset(12, 32), theme.muted)

-- Sekcja 1: budowanie ---------------------------------------------
local sectionBuild = makeFrame(pad, UDim2.new(1, 0, 0, 116), UDim2.fromOffset(0, 80), theme.panel)
makeLabel(sectionBuild, "1. ZBUDUJ / PRZEBUDUJ GRĘ", UDim2.new(1, -20, 0, 16), UDim2.fromOffset(12, 8), theme.muted, true)
local buildBtn = makeButton(sectionBuild, "Buduj grę w tym miejscu", UDim2.new(1, -24, 0, 34), UDim2.fromOffset(12, 28), true)
local selectBtn = makeButton(sectionBuild, "Zaznacz folder gry", UDim2.new(0.5, -16, 0, 28), UDim2.fromOffset(12, 68), false)
local undoBtn = makeButton(sectionBuild, "Cofnij budowanie (Ctrl+Z)", UDim2.new(0.5, -16, 0, 28), UDim2.fromOffset(24 + 158, 68), false)
local buildStatus = makeLabel(sectionBuild, "Skrypty: " .. tostring(#(PROJECT.files or {})) .. " · mapa: gotowa do zbudowania", UDim2.new(1, -20, 0, 16), UDim2.fromOffset(12, 98), theme.muted)

-- Sekcja 2: zmiany przez AI ---------------------------------------
local sectionRefine = makeFrame(pad, UDim2.new(1, 0, 0, 246), UDim2.fromOffset(0, 204), theme.panel)
makeLabel(sectionRefine, "2. POPROŚ O ZMIANĘ (AI)", UDim2.new(1, -20, 0, 16), UDim2.fromOffset(12, 8), theme.muted, true)
local refineBox = Instance.new("TextBox")
refineBox.Size = UDim2.new(1, -24, 0, 62)
refineBox.Position = UDim2.fromOffset(12, 28)
refineBox.BackgroundColor3 = Color3.fromRGB(12, 15, 28)
refineBox.BorderSizePixel = 0
refineBox.Font = Enum.Font.Gotham
refineBox.TextSize = 12
refineBox.TextColor3 = theme.text
refineBox.PlaceholderText = "np. dodaj sklep z ulepszeniami i ranking graczy"
refineBox.TextXAlignment = Enum.TextXAlignment.Left
refineBox.TextYAlignment = Enum.TextYAlignment.Top
refineBox.TextWrapped = true
refineBox.ClearTextOnFocus = false
refineBox.Parent = sectionRefine
corner(refineBox, 7)

-- Klucz API: trzymany wyłącznie w pamięci tej sesji Studio (nie jest zapisywany na dysku).
local keyBox = Instance.new("TextBox")
keyBox.Size = UDim2.new(1, -24, 0, 28)
keyBox.Position = UDim2.fromOffset(12, 96)
keyBox.BackgroundColor3 = Color3.fromRGB(12, 15, 28)
keyBox.BorderSizePixel = 0
keyBox.Font = Enum.Font.Code
keyBox.TextSize = 11
keyBox.TextColor3 = theme.text
keyBox.PlaceholderText = "Klucz API (opcjonalnie, tylko ta sesja) – dla zmian przez AI"
keyBox.Text = PROJECT_CONFIG.model.apiKey or ""
keyBox.ClearTextOnFocus = false
keyBox.Parent = sectionRefine
corner(keyBox, 7)

local refineBtn = makeButton(sectionRefine, "Zastosuj zmianę", UDim2.new(0.62, -18, 0, 32), UDim2.fromOffset(12, 132), true)
local refineFullBtn = makeButton(sectionRefine, "Tylko kod", UDim2.new(0.38, -18, 0, 32), UDim2.fromOffset(190, 132), false)
local refineStatus = makeLabel(sectionRefine, "Zmiana wymaga działającego lokalnego buildera (npm start).", UDim2.new(1, -20, 0, 60), UDim2.fromOffset(12, 172), theme.muted)

-- Sekcja 3: postęp ------------------------------------------------
local sectionProgress = makeFrame(pad, UDim2.new(1, 0, 0, 74), UDim2.fromOffset(0, 458), theme.panel)
local progressBar = makeFrame(sectionProgress, UDim2.new(1, -24, 0, 10), UDim2.fromOffset(12, 14), Color3.fromRGB(12, 15, 28))
local progressFill = Instance.new("Frame")
progressFill.Size = UDim2.fromScale(0, 1)
progressFill.BackgroundColor3 = theme.accent
progressFill.BorderSizePixel = 0
progressFill.Parent = progressBar
corner(progressFill, 5)
local progressLabel = makeLabel(sectionProgress, "Gotowe do pracy.", UDim2.new(1, -120, 0, 40), UDim2.fromOffset(12, 30), theme.muted)
local cancelBtn = makeButton(sectionProgress, "Przerwij", UDim2.new(0, 96, 0, 26), UDim2.new(1, -108, 0, 32), false)
cancelBtn.Visible = false

-- Sekcja 4: assety i zaślepki -------------------------------------
local sectionAssets = makeFrame(pad, UDim2.new(1, 0, 0, 250), UDim2.fromOffset(0, 540), theme.panel)
makeLabel(sectionAssets, "3. ZAŚLEPKI ASSETÓW", UDim2.new(1, -20, 0, 16), UDim2.fromOffset(12, 8), theme.muted, true)
local scanBtn = makeButton(sectionAssets, "Znajdź brakujące assety", UDim2.new(1, -24, 0, 30), UDim2.fromOffset(12, 28), false)
local assetList = Instance.new("ScrollingFrame")
assetList.Size = UDim2.new(1, -24, 0, 96)
assetList.Position = UDim2.fromOffset(12, 64)
assetList.BackgroundColor3 = Color3.fromRGB(12, 15, 28)
assetList.BorderSizePixel = 0
assetList.ScrollBarThickness = 4
assetList.CanvasSize = UDim2.new(0, 0, 0, 0)
assetList.AutomaticCanvasSize = Enum.AutomaticSize.Y
assetList.Parent = sectionAssets
corner(assetList, 7)
local assetListLayout = Instance.new("UIListLayout")
assetListLayout.Padding = UDim.new(0, 4)
assetListLayout.SortOrder = Enum.SortOrder.LayoutOrder
assetListLayout.Parent = assetList
local assetHint = makeLabel(sectionAssets, "Kliknij, aby znaleźć Decal/Sound/Mesh bez wartości (zaślepki po AI i importach).", UDim2.new(1, -20, 0, 30), UDim2.fromOffset(12, 166), theme.muted)

-- Sekcja 5: darmowe assety + ikona ---------------------------------
local sectionFree = makeFrame(pad, UDim2.new(1, 0, 0, 196), UDim2.fromOffset(0, 800), theme.panel)
makeLabel(sectionFree, "4. DARMOWE ASSETY I IKONA", UDim2.new(1, -20, 0, 16), UDim2.fromOffset(12, 8), theme.muted, true)
local freeButtons = {}
for index, asset in ipairs(FREE_ASSETS) do
	local column = (index - 1) % 2
	local row = math.floor((index - 1) / 2)
	local button = makeButton(sectionFree, asset.label, UDim2.new(0.5, -18, 0, 28), UDim2.fromOffset(12 + column * 190, 30 + row * 34), false)
	button.TextSize = 11
	button.MouseButton1Click:Connect(function()
		local inserted = insertFreeAsset(asset, Selection:Get()[1])
		Selection:Set({ inserted })
		progressLabel.Text = "Wstawiono: " .. asset.label .. " (" .. asset.note .. ")"
	end)
	table.insert(freeButtons, button)
end
local iconBtn = makeButton(sectionFree, "Zapisz ikonę gry (PNG 512x512)", UDim2.new(1, -24, 0, 30), UDim2.fromOffset(12, 136), true)
local iconHint = makeLabel(sectionFree, "Ikona trafi do folderu wtyczek – wgraj ją na create.roblox.com.", UDim2.new(1, -20, 0, 28), UDim2.fromOffset(12, 170), theme.muted)

--==================================================================
--  Logika interfejsu
--==================================================================
local busy = false
local cancelRequested = false

local function setProgress(value, message)
	progressFill.Size = UDim2.fromScale(math.clamp(value, 0, 1), 1)
	if message then
		progressLabel.Text = message
		progressLabel.TextColor3 = theme.muted
	end
end

local function startBusy(message)
	busy = true
	cancelRequested = false
	cancelBtn.Visible = true
	buildBtn.Active = false
	refineBtn.Active = false
	setProgress(0.02, message)
end

local function stopBusy(message, colour)
	busy = false
	cancelBtn.Visible = false
	buildBtn.Active = true
	refineBtn.Active = true
	if message then
		progressLabel.Text = message
		progressLabel.TextColor3 = colour or theme.muted
	end
end

local function doBuild()
	if busy then
		return
	end
	local counters = { nodes = 0, scripts = 0, skipped = 0 }
	local ok, err = pcall(function()
		local root = buildProject({ world = PROJECT.world, lighting = PROJECT.lighting, files = PROJECT.files }, counters)
		Selection:Set({ root })
	end)
	if not ok then
		stopBusy("Budowanie nie udało się: " .. tostring(err), theme.err)
		warnOnce(err)
		return
	end
	local message = string.format("Zbudowano: %d instancji, %d skryptów%s.", counters.nodes, counters.scripts,
		counters.skipped > 0 and (", pominięto " .. counters.skipped) or "")
	buildStatus.Text = message
	stopBusy(message, theme.accent)
	log(message)
end

local function doRefine()
	if busy then
		return
	end
	local instruction = refineBox.Text
	if string.gsub(instruction, "%s", "") == "" then
		stopBusy("Opisz zmianę, np. \"dodaj sklep i ranking\".", theme.warn)
		return
	end
	startBusy("Wysyłam projekt do lokalnego buildera...")
	refineStatus.Text = "Pracuję..."

	task.spawn(function()
		-- Zawsze serializujemy aktualny stan: kod z miejsca (jeśli zbudowane) + mapa projektu.
		local payload = projectPayloadForRefine()
		local key = keyBox.Text
		if type(key) == "string" then
			key = string.gsub(key, "%s", "")
		else
			key = ""
		end
		local config = {
			provider = PROJECT_CONFIG.model.provider,
			model = PROJECT_CONFIG.model.model,
			baseUrl = PROJECT_CONFIG.model.baseUrl,
			apiKey = (#key > 0) and key or PROJECT_CONFIG.model.apiKey,
		}
		local response, err = request("POST", "/api/refine", {
			project = payload,
			instruction = instruction,
			config = config,
			options = { language = PROJECT_CONFIG.language or "pl" },
		})
		if not response then
			stopBusy("Błąd: " .. tostring(err), theme.err)
			refineStatus.Text = tostring(err)
			return
		end
		local project, jobError = pollJob(response.jobId, function(progress, message)
			setProgress(progress, message)
		end, function()
			return cancelRequested
		end)
		if not project then
			stopBusy("Nie udało się: " .. tostring(jobError), theme.err)
			if string.find(string.lower(tostring(jobError)), "klucz") then
				refineStatus.Text = "Wklej klucz API w polu powyżej (albo wypełnij go w aplikacji webowej przy eksporcie wtyczki)."
			else
				refineStatus.Text = tostring(jobError)
			end
			return
		end

		-- Zapisujemy nową wersję projektu i przebudowujemy miejsce.
		PROJECT.files = {}
		for _, file in ipairs(project.files or {}) do
			table.insert(PROJECT.files, { path = file.path, content = file.content })
		end
		PROJECT.design = project.design or PROJECT.design
		PROJECT.plan = project.plan or PROJECT.plan
		PROJECT.name = project.name or PROJECT.name
		PROJECT.projectId = project.projectId or PROJECT.projectId

		local counters = { nodes = 0, scripts = 0, skipped = 0 }
		buildProject({ world = PROJECT.world, lighting = PROJECT.lighting, files = PROJECT.files }, counters)
		setProgress(1, "Zmiana zastosowana.")
		refineStatus.Text = project.summary or (project.notes and project.notes[#project.notes]) or "Gotowe."
		stopBusy("Zmiana zastosowana i zbudowana w miejscu.", theme.accent)
		refineBox.Text = ""
	end)
end

local function doScan()
	local placeholders, scanned = findPlaceholders(120)
	for _, child in ipairs(assetList:GetChildren()) do
		if child:IsA("TextButton") then
			child:Destroy()
		end
	end
	if #placeholders == 0 then
		assetHint.Text = string.format("Przeskanowano %d instancji – brak zaślepek. Świetnie!", scanned)
		return
	end
	assetHint.Text = string.format("Znaleziono %d zaślepek (zeskanowano %d instancji).", #placeholders, scanned)
	for index, item in ipairs(placeholders) do
		local row = Instance.new("TextButton")
		row.Size = UDim2.new(1, -8, 0, 26)
		row.BackgroundColor3 = Color3.fromRGB(26, 31, 54)
		row.BorderSizePixel = 0
		row.Font = Enum.Font.Code
		row.TextSize = 11
		row.TextColor3 = theme.warn
		row.TextXAlignment = Enum.TextXAlignment.Left
		row.Text = "  " .. item.label .. ": " .. item.path .. "." .. item.property
		row.LayoutOrder = index
		row.Parent = assetList
		corner(row, 6)
		row.MouseButton1Click:Connect(function()
			Selection:Set({ item.instance })
			progressLabel.Text = "Wybrano " .. item.path
		end)
	end
end

-- Zdarzenia -------------------------------------------------------
buildBtn.MouseButton1Click:Connect(doBuild)
buildButton.Click:Connect(doBuild)
undoBtn.MouseButton1Click:Connect(function()
	local ok, err = pcall(function()
		game:GetService("ChangeHistoryService"):Undo()
	end)
	stopBusy(ok and "Cofnięto ostatnią operację." or ("Nie można cofnąć: " .. tostring(err)), ok and theme.muted or theme.err)
end)
selectBtn.MouseButton1Click:Connect(function()
	local root = findProjectRoot()
	if root then
		Selection:Set({ root })
	else
		stopBusy("Najpierw zbuduj grę.", theme.warn)
	end
end)
refineBtn.MouseButton1Click:Connect(function()
	doRefine()
end)
refineFullBtn.MouseButton1Click:Connect(function()
	doRefine()
end)
cancelBtn.MouseButton1Click:Connect(function()
	cancelRequested = true
	stopBusy("Anuluję...", theme.warn)
end)
scanBtn.MouseButton1Click:Connect(doScan)
iconBtn.MouseButton1Click:Connect(function()
	local ok, err = pcall(function()
		local fileName, iconError = saveIcon(PROJECT.projectId, PROJECT.name, PROJECT.genre)
		if not fileName then
			stopBusy(iconError, theme.err)
			return
		end
		stopBusy("Ikona zapisana: " .. fileName .. " (folder wtyczek). Wgraj ją na create.roblox.com.", theme.accent)
		log("Ikona: " .. fileName)
	end)
	if not ok then
		stopBusy("Błąd ikony: " .. tostring(err), theme.err)
	end
end)
uiButton.Click:Connect(function()
	widget.Enabled = not widget.Enabled
end)

-- Sprawdzenie połączenia z builderem ------------------------------
task.spawn(function()
	if serverAlive() then
		progressLabel.Text = "Połączono z lokalnym builderem (" .. SERVER_URL .. ")."
		if PROJECT_CONFIG.model.apiKey and PROJECT_CONFIG.model.apiKey ~= "" then
			refineStatus.Text = "Napisz, co zmienić – AI przepisze kod i zbuduje grę ponownie."
		else
			refineStatus.Text = "Napisz, co zmienić. Klucz API wklej w polu powyżej (pamiętany tylko w tej sesji Studia)."
		end
	else
		progressLabel.Text = "Brak połączenia z builderem – budowanie i assety działają offline."
		progressLabel.TextColor3 = theme.warn
	end
end)

widget.Enabled = true
log("Wtyczka gotowa. Gra: " .. PROJECT.name .. " (" .. tostring(#(PROJECT.files or {})) .. " plików Luau).")
