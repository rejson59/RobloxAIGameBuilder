/**
 * Studio plugin generator.
 *
 * Emits a single .luau file that Studio can install as a plugin. The file
 * carries the whole generated game inside it (Luau source + world tree) and
 * builds it into the place with one button press:
 *   - Script        -> ServerScriptService
 *   - LocalScript   -> StarterPlayer.StarterPlayerScripts
 *   - ModuleScript  -> ReplicatedStorage.Shared
 *   - world tree    -> Workspace (folders, parts, spawns, GUI, lights)
 * The plugin mirrors server/rbxmx.js so both export paths behave identically.
 */

const ESCAPES = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t' };

function luaString(value) {
  return `"${String(value ?? '').replace(/[\\"\n\r\t]/g, (c) => ESCAPES[c])}"`;
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

/** JSON-ish value -> Luau literal source. */
export function toLuau(value, indent = 0) {
  const pad = '\t'.repeat(indent);
  const padInner = '\t'.repeat(indent + 1);

  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return luaString(value);

  if (Array.isArray(value)) {
    if (!value.length) return '{}';
    const items = value.map((v) => `${padInner}${toLuau(v, indent + 1)},`);
    return `{\n${items.join('\n')}\n${pad}}`;
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (!keys.length) return '{}';
    const items = keys.map((key) => {
      const safeKey = /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : `[${luaString(key)}]`;
      return `${padInner}${safeKey} = ${toLuau(value[key], indent + 1)},`;
    });
    return `{\n${items.join('\n')}\n${pad}}`;
  }

  return luaString(String(value));
}

const BUILD_RUNTIME = `
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

log("Wtyczka gotowa. Gra: " .. PROJECT.name .. " (" .. tostring(#PROJECT.files) .. " plików Luau). Naciśnij \\"Buduj grę\\".");
`;

/**
 * Build the plugin source for a project.
 * @param {object} project
 * @returns {string} Luau source of the plugin
 */
export function buildPlugin(project) {
  const files = (project.files || []).map((f) => ({ path: f.path, content: f.content }));
  const worldRoot = project.world?.world || project.world || { name: 'World', className: 'Folder', children: [] };
  const lighting = project.world?.lighting || {};

  const payload = {
    name: project.name || 'AI Game',
    tagline: project.tagline || '',
    files,
    world: {
      className: worldRoot.className || 'Folder',
      name: worldRoot.name || 'World',
      properties: worldRoot.properties || {},
      children: worldRoot.children || [],
    },
    lighting,
  };

  return `--[[
	Roblox AI Game Builder – wygenerowana wtyczka z wbudowaną grą.

	Gra: ${project.name || 'AI Game'}
	${project.tagline || ''}
	Pliki Luau: ${files.length} | Wygenerowano: ${new Date().toISOString().slice(0, 10)}

	Instalacja:
	  1. Zapisz ten plik na dysku jako RobloxAIGameBuilder.plugin.luau
	  2. W Roblox Studio: Plugins -> Plugins Folder (otworzy folder w eksploratorze plików)
	  3. Skopiuj plik do tego folderu
	  4. Wróć do Studio: Plugins -> Manage Plugins i włącz wtyczkę (albo zrestartuj Studio)
	  5. Na pasku wtyczek pojawi się "Roblox AI Game Builder" -> "Buduj grę"
]]
--!nocheck

local PROJECT = ${toLuau(payload, 0)}
${BUILD_RUNTIME}`;
}
