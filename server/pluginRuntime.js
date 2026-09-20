/**
 * Luau source of the in-Studio plugin runtime.
 *
 * This is the code that runs *inside Roblox Studio*: it builds the project
 * into the open place, talks to the local builder server (generation, refine,
 * validation), finds placeholder assets, inserts free assets and saves an icon.
 * Kept as a plain string so it ships with every generated `.plugin.luau`.
 */

export const PLUGIN_ENGINE = String.raw`
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
`;

export const PLUGIN_UI = String.raw`
--==================================================================
--  ŚCIEŻKI W STUDIO: plik z projektu -> instancja w miejscu
--  (te same reguły co przy budowaniu, więc live sync trafia w ten sam skrypt)
--==================================================================
local function studioContainer(target)
	local ok, service = pcall(game.GetService, game, target.service)
	if not ok or not service then
		return nil
	end
	local container = service
	if target.service == "StarterPlayer" then
		container = service:FindFirstChild("StarterPlayerScripts") or service
	end
	for _, folderName in ipairs(target.folders or {}) do
		local nextFolder = container:FindFirstChild(folderName)
		if not (nextFolder and nextFolder:IsA("Folder")) then
			return nil
		end
		container = nextFolder
	end
	return container
end

local function findScriptForTarget(target)
	local container = studioContainer(target)
	if not container then
		return nil
	end
	local existing = container:FindFirstChild(target.name)
	if existing and existing:IsA("LuaSourceContainer") then
		return existing
	end
	return nil
end

local function ensureScriptForTarget(target)
	local existing = findScriptForTarget(target)
	if existing then
		return existing, false
	end
	local ok, service = pcall(game.GetService, game, target.service)
	if not ok or not service then
		return nil, false
	end
	local container = service
	if target.service == "StarterPlayer" then
		container = service:FindFirstChild("StarterPlayerScripts") or service
	end
	for _, folderName in ipairs(target.folders or {}) do
		local nextFolder = container:FindFirstChild(folderName)
		if not (nextFolder and nextFolder:IsA("Folder")) then
			nextFolder = Instance.new("Folder")
			nextFolder.Name = folderName
			nextFolder.Parent = container
		end
		container = nextFolder
	end
	local created = Instance.new(target.className or "ModuleScript")
	created.Name = target.name
	created.Parent = container
	return created, true
end

--==================================================================
--  LIVE SYNC: dociąganie tylko zmienionych skryptów z buildera
--==================================================================
local liveState = { revision = tonumber(PROJECT.revision) or 0, enabled = false, lastMessage = "" }

local function fetchDiff(since)
	if not PROJECT.projectId then
		return nil, "Ta wtyczka nie zna id projektu – wyeksportuj ją ponownie z aplikacji webowej."
	end
	return request("GET", "/api/projects/" .. PROJECT.projectId .. "/diff?since=" .. tostring(since or 0), nil)
end

--- Wstawia różnicę do miejsca. Zwraca (zaktualizowane, utworzone, usunięte).
local function applyDiff(diff)
	local updated, created, removed = 0, 0, 0
	local recording = ChangeHistoryService:TryBeginRecording("AI Builder: live sync")
	for _, change in ipairs(diff.changed or {}) do
		local target = {
			service = change.service,
			folders = change.folders,
			name = change.name,
			className = change.className,
		}
		local script_, wasCreated = ensureScriptForTarget(target)
		if script_ then
			local ok = pcall(function()
				script_.Source = change.content or ""
			end)
			if ok then
				updated = updated + 1
				if wasCreated then
					created = created + 1
				end
			end
		end
	end
	for _, change in ipairs(diff.removed or {}) do
		local script_ = findScriptForTarget({ service = change.service, folders = change.folders, name = change.name })
		if script_ then
			script_:Destroy()
			removed = removed + 1
		end
	end
	if recording then
		ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit)
	end
	return updated, created, removed
end

--- Pełna synchronizacja projektu z serwera (świat + skrypty).
local function adoptProject(project)
	PROJECT.name = project.name or PROJECT.name
	PROJECT.summary = project.summary or PROJECT.summary
	PROJECT.genre = project.genre or PROJECT.genre
	PROJECT.design = project.design or PROJECT.design
	PROJECT.plan = project.plan or PROJECT.plan
	PROJECT.world = project.world and project.world.world or PROJECT.world
	PROJECT.lighting = project.world and project.world.lighting or PROJECT.lighting
	PROJECT.files = {}
	for _, file in ipairs(project.files or {}) do
		table.insert(PROJECT.files, { path = file.path, content = file.content })
	end
	PROJECT.projectId = project.projectId or PROJECT.projectId
	PROJECT.revision = project.revision or PROJECT.revision
	liveState.revision = tonumber(project.revision) or liveState.revision
end

local function rebuildFromProject(project, counters)
	adoptProject(project)
	local root = buildProject({ world = PROJECT.world, lighting = PROJECT.lighting, files = PROJECT.files }, counters or { nodes = 0, scripts = 0, skipped = 0 })
	return root
end

--==================================================================
--  BŁĘDY RUNTIME: LogService łapie wszystko, co dzieje się podczas Play
--==================================================================
local LogService = game:GetService("LogService")
local runtimeErrors = {}
local runtimeErrorCount = 0

LogService.MessageOut:Connect(function(message, messageType)
	if messageType ~= Enum.MessageType.MessageError then
		return
	end
	local text = tostring(message)
	if string.find(text, "%[AI Builder%]") then
		return -- nasze własne komunikaty, nie błąd gry
	end
	table.insert(runtimeErrors, text)
	runtimeErrorCount = runtimeErrorCount + 1
	if #runtimeErrors > 80 then
		table.remove(runtimeErrors, 1)
	end
end)

local function runtimeErrorsText(limit)
	limit = limit or 25
	local unique, seen = {}, {}
	for index = #runtimeErrors, 1, -1 do
		local text = runtimeErrors[index]
		local key = string.sub(text, 1, 140)
		if not seen[key] then
			seen[key] = true
			table.insert(unique, text)
			if #unique >= limit then
				break
			end
		end
	end
	return table.concat(unique, "\n")
end

local function clearRuntimeErrors()
	runtimeErrors = {}
end

--==================================================================
--  ZNACZNIKI ASSETÓW: placeholder:tag -> darmowy asset z katalogu
--==================================================================
local function placeholderTag(value)
	if type(value) ~= "string" then
		return nil
	end
	local start = string.find(value, "placeholder:", 1, true)
	if not start then
		return nil
	end
	local tag = string.sub(value, start + #"placeholder:")
	tag = string.gsub(tag, "%s", "")
	if tag == "" then
		return nil
	end
	return string.lower(tag)
end

--- Znajduje właściwości assetów ustawione na placeholder:<tag>.
local function findPlaceholderTags(limit)
	limit = limit or 200
	local found = {}
	for _, serviceName in ipairs({ "Workspace", "ReplicatedStorage", "StarterGui", "StarterPlayer", "ServerStorage", "SoundService" }) do
		local service = game:GetService(serviceName)
		local ok, descendants = pcall(function()
			return service:GetDescendants()
		end)
		if ok then
			for _, instance in ipairs(descendants) do
				for _, field in ipairs(ASSET_FIELDS) do
					if instance:IsA(field.className) then
						local okValue, value = pcall(function()
							return instance[field.property]
						end)
						local tag = okValue and placeholderTag(value) or nil
						if tag then
							table.insert(found, {
								instance = instance,
								property = field.property,
								tag = tag,
								path = instance:GetFullName(),
							})
							if #found >= limit then
								return found
							end
						end
					end
				end
			end
		end
	end
	return found
end

--- Zamienia znaczniki na prawdziwe assety z katalogu serwera (jeden klik).
local function fillPlaceholderTags(onProgress)
	local found = findPlaceholderTags(200)
	if #found == 0 then
		return 0, 0, "Brak znaczników placeholder:… w tym miejscu."
	end
	local catalogResponse = request("GET", "/api/assets", nil)
	if not catalogResponse then
		return 0, #found, "Brak połączenia z builderem – nie mogę pobrać katalogu assetów."
	end
	local byTag = {}
	for _, asset in ipairs(catalogResponse.assets or {}) do
		if asset.placeholder then
			byTag[string.lower(asset.placeholder)] = asset
		end
		for _, tag in ipairs(asset.tags or {}) do
			local key = "placeholder:" .. string.lower(tag)
			if not byTag[key] then
				byTag[key] = asset
			end
		end
	end

	local recording = ChangeHistoryService:TryBeginRecording("AI Builder: znaczniki assetów")
	local filled, skipped = 0, 0
	for index, item in ipairs(found) do
		if onProgress then
			onProgress(index / #found, string.format("Podmieniam %d/%d: %s", index, #found, item.tag))
		end
		local asset = byTag["placeholder:" .. item.tag]
		if asset then
			local ok = pcall(function()
				item.instance[item.property] = asset.rbxAssetId
			end)
			if ok then
				filled = filled + 1
			else
				skipped = skipped + 1
			end
		else
			skipped = skipped + 1
		end
	end
	if recording then
		ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit)
	end
	return filled, skipped, nil
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
scroll.CanvasSize = UDim2.new(0, 0, 0, 1350)
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
makeLabel(header, (PROJECT.tagline or PROJECT.summary or ""), UDim2.new(1, -20, 0, 22), UDim2.fromOffset(12, 32), theme.muted)
makeLabel(header, "projekt: " .. tostring(PROJECT.projectId or "(bez id)") .. " · rewizja " .. tostring(PROJECT.revision or "?"),
	UDim2.new(1, -20, 0, 14), UDim2.fromOffset(12, 54), theme.muted)

-- Sekcja 1: budowanie ---------------------------------------------
local sectionBuild = makeFrame(pad, UDim2.new(1, 0, 0, 152), UDim2.fromOffset(0, 80), theme.panel)
makeLabel(sectionBuild, "1. ZBUDUJ / PRZEBUDUJ GRĘ", UDim2.new(1, -20, 0, 16), UDim2.fromOffset(12, 8), theme.muted, true)
local buildBtn = makeButton(sectionBuild, "Buduj grę w tym miejscu", UDim2.new(1, -24, 0, 34), UDim2.fromOffset(12, 28), true)
local selectBtn = makeButton(sectionBuild, "Zaznacz folder gry", UDim2.new(0.5, -16, 0, 28), UDim2.fromOffset(12, 68), false)
local undoBtn = makeButton(sectionBuild, "Cofnij budowanie (Ctrl+Z)", UDim2.new(0.5, -16, 0, 28), UDim2.fromOffset(24 + 158, 68), false)
local buildStatus = makeLabel(sectionBuild, "Skrypty: " .. tostring(#(PROJECT.files or {})) .. " · mapa: gotowa do zbudowania", UDim2.new(1, -20, 0, 16), UDim2.fromOffset(12, 98), theme.muted)

-- Live sync: wtyczka pilnuje rewizji projektu i dociąga TYLKO zmienione skrypty.
local syncCheck = Instance.new("TextButton")
syncCheck.Size = UDim2.new(0, 18, 0, 18)
syncCheck.Position = UDim2.fromOffset(12, 124)
syncCheck.BackgroundColor3 = Color3.fromRGB(12, 15, 28)
syncCheck.BorderSizePixel = 0
syncCheck.Text = ""
syncCheck.AutoButtonColor = false
syncCheck.Parent = sectionBuild
corner(syncCheck, 5)
local syncDot = Instance.new("Frame")
syncDot.Size = UDim2.fromScale(1, 1)
syncDot.BackgroundColor3 = theme.muted
syncDot.BorderSizePixel = 0
syncDot.Parent = syncCheck
corner(syncDot, 5)
makeLabel(sectionBuild, "Live sync: dociągaj zmiany z aplikacji (bez przebudowy całej gry)", UDim2.new(1, -50, 0, 18), UDim2.fromOffset(36, 124), theme.muted)

-- Sekcja 2: zmiany przez AI ---------------------------------------
local sectionRefine = makeFrame(pad, UDim2.new(1, 0, 0, 246), UDim2.fromOffset(0, 240), theme.panel)
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
local sectionProgress = makeFrame(pad, UDim2.new(1, 0, 0, 132), UDim2.fromOffset(0, 494), theme.panel)
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
-- Błędy z Play (LogService) – po teście gry można je wysłać do modelu i naprawić.
local errorsLabel = makeLabel(sectionProgress, "Błędy z Play: 0", UDim2.new(1, -24, 0, 16), UDim2.fromOffset(12, 76), theme.muted)
local fixErrorsBtn = makeButton(sectionProgress, "Napraw błędy z Play (AI)", UDim2.new(0.55, -18, 0, 28), UDim2.fromOffset(12, 96), false)
local clearErrorsBtn = makeButton(sectionProgress, "Wyczyść listę", UDim2.new(0.45, -18, 0, 28), UDim2.fromOffset(196, 96), false)

-- Sekcja 4: assety i zaślepki -------------------------------------
local sectionAssets = makeFrame(pad, UDim2.new(1, 0, 0, 296), UDim2.fromOffset(0, 634), theme.panel)
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
local assetHint = makeLabel(sectionAssets, "Kliknij, aby znaleźć Decal/Sound/Mesh bez wartości (zaślepki po AI i importach).", UDim2.new(1, -20, 0, 34), UDim2.fromOffset(12, 166), theme.muted)
local fillTagsBtn = makeButton(sectionAssets, "Podmień znaczniki placeholder:… na darmowe assety", UDim2.new(1, -24, 0, 30), UDim2.fromOffset(12, 206), true)
local fillTagsStatus = makeLabel(sectionAssets, "Kod AI może zawierać znaczniki, np. SoundId = \"placeholder:coin\".", UDim2.new(1, -20, 0, 46), UDim2.fromOffset(12, 240), theme.muted)

-- Sekcja 5: darmowe assety + ikona ---------------------------------
local sectionFree = makeFrame(pad, UDim2.new(1, 0, 0, 196), UDim2.fromOffset(0, 940), theme.panel)
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

-- Sekcja 6: historia wersji i rollback ---------------------------
local sectionHistory = makeFrame(pad, UDim2.new(1, 0, 0, 200), UDim2.fromOffset(0, 1146), theme.panel)
makeLabel(sectionHistory, "5. HISTORIA WERSJI (COFNIJ ZMIANĘ)", UDim2.new(1, -20, 0, 16), UDim2.fromOffset(12, 8), theme.muted, true)
local versionsBtn = makeButton(sectionHistory, "Pokaż wersje projektu", UDim2.new(1, -24, 0, 28), UDim2.fromOffset(12, 28), false)
local versionList = Instance.new("ScrollingFrame")
versionList.Size = UDim2.new(1, -24, 0, 104)
versionList.Position = UDim2.fromOffset(12, 62)
versionList.BackgroundColor3 = Color3.fromRGB(12, 15, 28)
versionList.BorderSizePixel = 0
versionList.ScrollBarThickness = 4
versionList.CanvasSize = UDim2.new(0, 0, 0, 0)
versionList.AutomaticCanvasSize = Enum.AutomaticSize.Y
versionList.Parent = sectionHistory
corner(versionList, 7)
local versionLayout = Instance.new("UIListLayout")
versionLayout.Padding = UDim.new(0, 4)
versionLayout.SortOrder = Enum.SortOrder.LayoutOrder
versionLayout.Parent = versionList
local historyStatus = makeLabel(sectionHistory, "Rollback tworzy nową wersję – nic nie ginie z historii.", UDim2.new(1, -20, 0, 28), UDim2.fromOffset(12, 170), theme.muted)

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
	liveState.revision = tonumber(PROJECT.revision) or liveState.revision
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
		-- Rewizja z serwera trafia do stanu live sync, żeby nie dociągać tej samej zmiany dwa razy.
		liveState.revision = tonumber(project.revision) or liveState.revision

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

-- Live sync ------------------------------------------------------
syncCheck.MouseButton1Click:Connect(function()
	liveState.enabled = not liveState.enabled
	syncDot.BackgroundColor3 = liveState.enabled and theme.accent or theme.muted
	if liveState.enabled then
		local diff, err = fetchDiff(liveState.revision)
		if not diff then
			liveState.enabled = false
			syncDot.BackgroundColor3 = theme.muted
			stopBusy("Live sync wyłączony: " .. tostring(err), theme.warn)
			return
		end
		if diff.full then
			stopBusy("Live sync włączony – pierwsza synchronizacja całego projektu...", theme.muted)
			local counters = { nodes = 0, scripts = 0, skipped = 0 }
			buildProject({ world = PROJECT.world, lighting = PROJECT.lighting, files = PROJECT.files }, counters)
			liveState.revision = diff.revision
			stopBusy("Zsynchronizowano (rewizja " .. tostring(diff.revision) .. ").", theme.accent)
		else
			stopBusy("Live sync włączony. Pilnuję rewizji " .. tostring(liveState.revision) .. ".", theme.accent)
		end
	else
		stopBusy("Live sync wyłączony.", theme.muted)
	end
end)

task.spawn(function()
	while true do
		task.wait(2.5)
		if liveState.enabled and not busy and PROJECT.projectId then
			local diff, err = fetchDiff(liveState.revision)
			if not diff then
				liveState.lastMessage = tostring(err)
			elseif diff.revision ~= liveState.revision then
				if diff.full then
					local counters = { nodes = 0, scripts = 0, skipped = 0 }
					buildProject({ world = PROJECT.world, lighting = PROJECT.lighting, files = PROJECT.files }, counters)
					liveState.revision = diff.revision
					buildStatus.Text = "Live sync: pełna przebudowa (rewizja " .. tostring(diff.revision) .. ")."
				else
					local updated, created, removed = applyDiff(diff)
					liveState.revision = diff.revision
					-- Kod zmieniony w Studiu jest ważniejszy: aktualizujemy tylko wpisy z serwera.
					for _, change in ipairs(diff.changed or {}) do
						local found = false
						for index, file in ipairs(PROJECT.files) do
							if file.path == change.path then
								PROJECT.files[index] = { path = change.path, content = change.content }
								found = true
							end
						end
						if not found then
							table.insert(PROJECT.files, { path = change.path, content = change.content })
						end
					end
					for _, change in ipairs(diff.removed or {}) do
						for index = #PROJECT.files, 1, -1 do
							if PROJECT.files[index].path == change.path then
								table.remove(PROJECT.files, index)
							end
						end
					end
					buildStatus.Text = string.format("Live sync: %d skrypt(ów) zaktualizowanych, %d nowych, %d usuniętych (rewizja %d).",
						updated, created, removed, diff.revision)
				end
			end
		end
	end
end)

-- Błędy runtime ---------------------------------------------------
task.spawn(function()
	local lastCount = -1
	while true do
		task.wait(1)
		if runtimeErrorCount ~= lastCount then
			lastCount = runtimeErrorCount
			errorsLabel.Text = string.format("Błędy z Play: %d%s", runtimeErrorCount,
				runtimeErrorCount > 0 and "  (kliknij „Napraw błędy z Play”)" or "")
			errorsLabel.TextColor3 = runtimeErrorCount > 0 and theme.warn or theme.muted
		end
	end
end)

clearErrorsBtn.MouseButton1Click:Connect(function()
	clearRuntimeErrors()
	runtimeErrorCount = 0
	errorsLabel.Text = "Błędy z Play: 0"
	errorsLabel.TextColor3 = theme.muted
end)

fixErrorsBtn.MouseButton1Click:Connect(function()
	if busy then
		return
	end
	if runtimeErrorCount == 0 then
		stopBusy("Najpierw przetestuj grę (Play) – wtedy zbiorę błędy.", theme.warn)
		return
	end
	if not PROJECT.projectId then
		stopBusy("Ta wtyczka nie zna id projektu – wyeksportuj ją z aplikacji webowej.", theme.warn)
		return
	end
	local errors = runtimeErrorsText(25)
	local instruction = "Gra wyrzuciła poniższe błędy podczas testu w Roblox Studio. Napraw przyczyny (nie komentuj kodu, napraw logikę):\n\n" .. errors
	refineBox.Text = instruction
	doRefine()
	clearRuntimeErrors()
	runtimeErrorCount = 0
end)

-- Znaczniki assetów ----------------------------------------------
fillTagsBtn.MouseButton1Click:Connect(function()
	if busy then
		return
	end
	startBusy("Szukam znaczników placeholder:…")
	task.spawn(function()
		local filled, skipped, err = fillPlaceholderTags(function(ratio, message)
			setProgress(ratio, message)
		end)
		if err then
			stopBusy(err, theme.warn)
			fillTagsStatus.Text = err
			return
		end
		local message = string.format("Podmieniono %d znacznik(ów)%s.", filled, skipped > 0 and (", pominięto " .. skipped) or "")
		fillTagsStatus.Text = message .. " Assety pochodzą z katalogu lokalnego buildera."
		stopBusy(message, filled > 0 and theme.accent or theme.warn)
	end)
end)

-- Historia wersji -------------------------------------------------
local function refreshVersions()
	if not PROJECT.projectId then
		stopBusy("Brak id projektu – wersje są w aplikacji webowej.", theme.warn)
		return
	end
	for _, child in ipairs(versionList:GetChildren()) do
		if child:IsA("TextButton") then
			child:Destroy()
		end
	end
	local response, err = request("GET", "/api/library/" .. PROJECT.projectId .. "/versions", nil)
	if not response then
		historyStatus.Text = tostring(err)
		return
	end
	historyStatus.Text = string.format("Aktualna rewizja: %s · wersji w historii: %d", tostring(response.revision), #(response.versions or {}))
	for index, version in ipairs(response.versions or {}) do
		local row = Instance.new("TextButton")
		row.Size = UDim2.new(1, -8, 0, 28)
		row.BackgroundColor3 = Color3.fromRGB(26, 31, 54)
		row.BorderSizePixel = 0
		row.Font = Enum.Font.Code
		row.TextSize = 11
		row.TextColor3 = theme.text
		row.TextXAlignment = Enum.TextXAlignment.Left
		row.Text = string.format("  rewizja %s · %s · %s", tostring(version.revision), tostring(version.note), tostring(version.at))
		row.LayoutOrder = index
		row.Parent = versionList
		corner(row, 6)
		row.MouseButton1Click:Connect(function()
			if busy then
				return
			end
			startBusy("Przywracam wersję...")
			task.spawn(function()
				local restored, restoreErr = request("POST", "/api/library/" .. PROJECT.projectId .. "/restore", { index = version.index })
				if not restored then
					stopBusy("Nie udało się: " .. tostring(restoreErr), theme.err)
					return
				end
				local counters = { nodes = 0, scripts = 0, skipped = 0 }
				pcall(function()
					rebuildFromProject(restored.project, counters)
				end)
				buildStatus.Text = string.format("Przywrócono wersję %s (rewizja %s): %d instancji, %d skryptów.",
					tostring(version.index), tostring(restored.revision), counters.nodes, counters.scripts)
				stopBusy("Przywrócono i przebudowano miejsce.", theme.accent)
				refreshVersions()
			end)
		end)
	end
end

versionsBtn.MouseButton1Click:Connect(refreshVersions)

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
`;
