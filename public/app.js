/* Roblox AI Game Builder – frontend (bez frameworków, bez zależności). */

const state = {
  mode: 'demo',
  scale: 'standard',
  providers: [],
  demos: [],
  project: null,
  selectedFile: null,
  jobId: null,
  controller: null,
  busy: false,
};

const $ = (id) => document.getElementById(id);
const examples = [
  'Obby: parkour nad lawą z checkpointami i sklepem',
  'Tycoon: piekarnia — kupuj maszyny, zatrudniaj NPC, zarabiaj na chleb',
  'Tower Defense: potwory idą ścieżką do bazy, 3 typy wież',
  'Symulator: łowienie ryb z rzadkościami i rankingiem',
  'Arena PvP: dwie drużyny, rundy po 3 minuty, kill feed',
  'Horror: nawiedzony szpital, latarka, generator do naprawy',
  'Battle Royale dla 8 graczy: kurczące się pole, skrzynki z lootem',
  'Wyścigi: tory z przeszkodami, boost, tabela czasów',
];

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  $('toasts').appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .4s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 400);
  }, 5200);
}

function logLine(message, kind = '') {
  const box = $('log');
  const el = document.createElement('div');
  el.className = kind ? `line-${kind}` : '';
  el.textContent = message;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

function setProgress(ratio) {
  $('progress-bar').style.width = `${Math.max(3, Math.min(100, Math.round(ratio * 100)))}%`;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

async function download(format) {
  if (!state.project) return;
  try {
    toast(`Przygotowuję plik (${format})...`);
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: state.project, format }),
    });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : `game.${format}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast(`Pobrano ${filename}`, 'ok');
  } catch (err) {
    toast(`Nie udało się wyeksportować: ${err.message}`, 'err');
  }
}

/* ------------------------------------------------------------------ *
 * Syntax highlighting + markdown
 * ------------------------------------------------------------------ */
const LUAU_TOKEN = /(--\[\[[\s\S]*?\]\]|--[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\[\[[\s\S]*?\]\])|(\b\d+(?:\.\d+)?\b)|(\b(?:local|function|end|if|then|else|elseif|for|while|do|repeat|until|return|break|continue|and|or|not|in|nil|true|false|self)\b)|(\b(?:game|workspace|script|plugin|Instance|Enum|task|Vector3|Vector2|CFrame|Color3|UDim2|UDim|TweenInfo|Random|NumberRange|Ray|Region3|BrickColor|TweenService|Players|ReplicatedStorage|ServerScriptService|ServerStorage|StarterGui|StarterPlayer|RunService|UserInputService|ContextActionService|CollectionService|Debris|Lighting|Teams|ChangeHistoryService|Selection|os|math|string|table|ipairs|pairs|pcall|xpcall|type|typeof|tostring|tonumber|select|warn|require|print|error|assert|setmetatable|getmetatable|next|coroutine|bit32|utf8)\b)|(\b[A-Za-z_]\w*(?=\s*\())|(\b[A-Z][A-Za-z0-9]*\b)/g;

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function highlightLuau(source) {
  let out = '';
  let last = 0;
  const text = String(source);
  for (const match of text.matchAll(LUAU_TOKEN)) {
    const index = match.index;
    out += escapeHtml(text.slice(last, index));
    const [full, comment, str, num, keyword, globalName, func, typeName] = match;
    let cls = '';
    if (comment) cls = 'tok-comment';
    else if (str) cls = 'tok-string';
    else if (num) cls = 'tok-number';
    else if (keyword) cls = 'tok-keyword';
    else if (globalName) cls = 'tok-global';
    else if (func) cls = 'tok-func';
    else if (typeName) cls = 'tok-builtin';
    out += cls ? `<span class="${cls}">${escapeHtml(full)}</span>` : escapeHtml(full);
    last = index + full.length;
  }
  out += escapeHtml(text.slice(last));
  return out;
}

function markdown(source) {
  const lines = String(source || '').split('\n');
  let html = '';
  let inList = false;
  let inTable = false;

  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  const closeTable = () => { if (inTable) { html += '</table>'; inTable = false; } };
  const inline = (text) => escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)\*([^*]+)\*/g, '$1<em>$2</em>');

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (/^\s*\|/.test(line)) {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (/^[\s|:-]+$/.test(line)) continue;
      if (!inTable) {
        closeList();
        html += '<table>';
        html += `<tr>${cells.map((c) => `<th>${inline(c)}</th>`).join('')}</tr>`;
        inTable = true;
      } else {
        html += `<tr>${cells.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`;
      }
      continue;
    }
    closeTable();

    if (/^#{1,4}\s/.test(line)) {
      closeList();
      const level = line.match(/^#+/)[0].length;
      html += `<h${Math.min(level + 1, 5)}>${inline(line.replace(/^#+\s*/, ''))}</h${Math.min(level + 1, 5)}>`;
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`;
    } else if (/^\s*\d+\.\s+/.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(line.replace(/^\s*\d+\.\s+/, ''))}</li>`;
    } else if (/^\s*>\s?/.test(line)) {
      closeList();
      html += `<blockquote>${inline(line.replace(/^\s*>\s?/, ''))}</blockquote>`;
    } else if (!line.trim()) {
      closeList();
    } else {
      closeList();
      html += `<p>${inline(line)}</p>`;
    }
  }
  closeList();
  closeTable();
  return `<div class="md">${html}</div>`;
}

/* ------------------------------------------------------------------ *
 * Providers / demos boot
 * ------------------------------------------------------------------ */
async function loadHealth() {
  try {
    const health = await api('/api/health');
    $('health-pill').textContent = `v${health.version} · Node ${health.node}`;
  } catch {
    $('health-pill').textContent = 'offline';
  }
}

async function loadProviders() {
  try {
    const data = await api('/api/providers');
    state.providers = data.providers;
    const select = $('provider-select');
    select.innerHTML = '';
    for (const provider of state.providers) {
      const option = document.createElement('option');
      option.value = provider.id;
      option.textContent = provider.needsKey ? provider.label : `${provider.label}`;
      select.appendChild(option);
    }
    select.value = 'openai';
    applyProvider('openai');
    select.addEventListener('change', () => applyProvider(select.value));
  } catch (err) {
    toast(`Nie udało się pobrać listy dostawców: ${err.message}`, 'err');
  }
}

function applyProvider(id) {
  const provider = state.providers.find((p) => p.id === id);
  if (!provider) return;
  const modelInput = $('model-input');
  if (!modelInput.value || !provider.models.includes(modelInput.value)) {
    modelInput.value = provider.defaultModel || provider.models[0] || '';
  }
  const list = $('model-list');
  list.innerHTML = '';
  for (const model of provider.models) {
    const option = document.createElement('option');
    option.value = model;
    list.appendChild(option);
  }
  $('base-url-field').classList.toggle('hidden', !(id === 'custom' || id === 'ollama' || !provider.baseUrl));
  if (id === 'custom') $('base-url-input').value = $('base-url-input').value || 'http://127.0.0.1:8080/v1';
  if (id === 'ollama') $('base-url-input').value = provider.baseUrl;
  $('api-key-input').placeholder = provider.needsKey ? (id === 'openai' ? 'sk-…' : 'klucz API') : 'nie jest wymagany';
  updateModelSummary();
}

async function loadDemos() {
  try {
    const data = await api('/api/demos');
    state.demos = data.demos;
    const list = $('demo-list');
    list.innerHTML = '';
    for (const demo of state.demos) {
      const button = document.createElement('button');
      button.className = 'demo-item';
      button.innerHTML = `<strong>${escapeHtml(demo.name)}</strong><span>${escapeHtml(demo.tagline || '')}</span><br><em>${escapeHtml(demo.genre)} · ${demo.files} plików Luau</em>`;
      button.addEventListener('click', () => loadDemo(demo.id));
      list.appendChild(button);
    }
  } catch (err) {
    toast(`Nie udało się pobrać dem: ${err.message}`, 'err');
  }
}

async function loadDemo(id) {
  try {
    setBusy(true);
    showProgress();
    logLine(`Wczytuję projekt demo: ${id}...`);
    const data = await api('/api/demo', { method: 'POST', body: JSON.stringify({ id }) });
    setProgress(1);
    logLine('Projekt demo gotowy (bez wywołań API).', 'ok');
    renderProject(data.project);
    toast(`Wczytano demo: ${data.project.name}`, 'ok');
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    setBusy(false);
  }
}

/* ------------------------------------------------------------------ *
 * Generation
 * ------------------------------------------------------------------ */
function showProgress() {
  $('progress-card').classList.remove('hidden');
  $('log').innerHTML = '';
  setProgress(0.03);
}

function setBusy(busy) {
  state.busy = busy;
  $('generate-btn').disabled = busy;
  $('cancel-btn').classList.toggle('hidden', !busy);
  $('generate-btn').textContent = busy ? 'Generuję…' : 'Zbuduj grę';
}

function buildConfig() {
  return {
    provider: $('provider-select').value,
    apiKey: $('api-key-input').value.trim(),
    model: $('model-input').value.trim(),
    baseUrl: $('base-url-input').value.trim(),
  };
}

function buildOptions() {
  const mustHave = $('musthave-input').value.split(',').map((s) => s.trim()).filter(Boolean);
  return {
    scale: state.scale,
    language: $('language-select').value,
    mustHave,
    demo: state.mode === 'demo',
  };
}

async function generate() {
  if (state.busy) return;
  const idea = $('idea-input').value.trim();
  if (!idea && state.mode === 'api') {
    toast('Opisz swoją grę (albo wybierz demo po lewej).', 'err');
    return;
  }

  const config = buildConfig();
  if (state.mode === 'api') {
    const provider = state.providers.find((p) => p.id === config.provider);
    if (provider?.needsKey && !config.apiKey) {
      toast(`Podaj klucz API dla ${provider.label}.`, 'err');
      return;
    }
    if (!config.model) {
      toast('Podaj nazwę modelu.', 'err');
      return;
    }
  }

  showProgress();
  setBusy(true);
  state.project = null;
  state.jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  state.controller = new AbortController();

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: state.jobId, idea, options: buildOptions(), config }),
      signal: state.controller.signal,
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() || '';
      for (const chunk of chunks) {
        const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (!dataLine) continue;
        let event;
        try {
          event = JSON.parse(dataLine.slice(6));
        } catch {
          continue;
        }
        handleEvent(event);
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      logLine('Generowanie przerwane.', 'warn');
      toast('Przerwano generowanie.');
    } else {
      logLine(`Błąd: ${err.message}`, 'err');
      toast(err.message, 'err');
    }
  } finally {
    setBusy(false);
    state.controller = null;
  }
}

function handleEvent(event) {
  switch (event.type) {
    case 'stage':
      logLine(event.message, 'stage');
      if (typeof event.progress === 'number') setProgress(0.15 + event.progress * 0.8);
      else setProgress(Math.min(0.9, (parseFloat($('progress-bar').style.width) || 3) / 100 + 0.06));
      break;
    case 'plan':
      logLine(event.message, 'ok');
      setProgress(0.35);
      break;
    case 'files':
      logLine(`Pliki: ${event.files.length}`, '');
      break;
    case 'warn':
      logLine(event.message, 'warn');
      break;
    case 'done':
      logLine(event.message, 'ok');
      setProgress(1);
      break;
    case 'error':
      logLine(event.message, 'err');
      if (event.detail) logLine(String(event.detail).slice(0, 500), 'warn');
      setProgress(1);
      toast(event.message, 'err');
      break;
    case 'project':
      setProgress(1);
      renderProject(event.project);
      toast(`Gotowe: ${event.project.name}`, 'ok');
      break;
    default:
      break;
  }
}

async function cancel() {
  if (!state.jobId) return;
  try {
    await api(`/api/jobs/${state.jobId}/cancel`, { method: 'POST', body: '{}' });
  } catch {
    /* ignore */
  }
  state.controller?.abort();
}

/* ------------------------------------------------------------------ *
 * Rendering the result
 * ------------------------------------------------------------------ */
function renderProject(project) {
  state.project = project;
  state.selectedFile = project.files?.[0]?.path || null;

  $('result-card').classList.remove('hidden');
  $('game-name').textContent = project.name || 'AI Game';
  $('game-tagline').textContent = project.tagline || project.summary || '';
  $('tab-files-count').textContent = `(${project.files?.length || 0})`;

  renderStats(project);
  renderOverview(project);
  renderFiles(project);
  renderWorld(project);
  renderArch(project);
  renderExportHelp(project);

  $('result-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderStats(project) {
  const stats = project.validation?.stats || {};
  const items = [
    ['Pliki Luau', stats.files ?? project.files?.length ?? 0],
    ['Linii kodu', stats.lines ?? '—'],
    ['Instancje świata', stats.worldNodes ?? '—'],
    ['Rozmiar', stats.bytes ? `${(stats.bytes / 1024).toFixed(1)} kB` : '—'],
    ['Model', project.meta?.model || (project.demo ? 'demo offline' : '—')],
    ['Tokeny', project.usage?.calls ? `${project.usage.inputTokens} / ${project.usage.outputTokens}` : '—'],
  ];
  $('stats').innerHTML = items
    .map(([label, value]) => `<div class="stat"><b>${escapeHtml(String(value))}</b><span>${escapeHtml(label)}</span></div>`)
    .join('');
}

function renderOverview(project) {
  const design = project.design || {};
  const validation = project.validation || {};
  const parts = [];

  if (validation.errors?.length) {
    parts.push(`<div class="warn-box"><strong>Błędy (${validation.errors.length}):</strong><ul>${validation.errors.slice(0, 12).map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul></div>`);
  }
  if (validation.warnings?.length) {
    parts.push(`<div class="warn-box"><strong>Ostrzeżenia walidatora (${validation.warnings.length}):</strong><ul>${validation.warnings.slice(0, 12).map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul></div>`);
  } else if (!validation.errors?.length) {
    parts.push('<div class="ok-box">Walidator nie znalazł problemów: brak przestarzałych API, placeholdery nie występują, moduły mają <code>return</code>.</div>');
  }

  parts.push('<dl class="kv">');
  const rows = [
    ['Gatunek', design.genre || project.genre],
    ['Pętla rozgrywki', design.coreLoop],
    ['Długość sesji', design.sessionLength],
    ['Grupa docelowa', design.audience],
    ['Progresja', design.progression],
  ];
  for (const [key, value] of rows) {
    if (value) parts.push(`<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(String(value))}</dd>`);
  }
  parts.push('</dl>');

  if (project.summary) parts.push(`<p>${escapeHtml(project.summary)}</p>`);

  if (Array.isArray(design.systems) && design.systems.length) {
    parts.push('<h3 style="color:var(--green);font-size:15px;margin-top:18px">Systemy gry</h3>');
    parts.push('<table class="md" style="width:100%"><tr><th>System</th><th>Cel</th><th>Autorytet serwera</th><th>Kluczowe liczby</th></tr>');
    for (const system of design.systems) {
      parts.push(`<tr><td>${escapeHtml(system.name || '')}</td><td>${escapeHtml(system.purpose || '')}</td><td>${escapeHtml(system.serverAuthority || '')}</td><td><code>${escapeHtml(JSON.stringify(system.keyParameters || {}))}</code></td></tr>`);
    }
    parts.push('</table>');
  }

  if (design.designDoc) parts.push(markdown(design.designDoc));
  if (Array.isArray(project.notes) && project.notes.length) {
    parts.push('<h3 style="color:var(--green);font-size:15px;margin-top:18px">Notatki z generowania</h3><ul>');
    for (const note of project.notes.slice(0, 12)) parts.push(`<li>${escapeHtml(String(note))}</li>`);
    parts.push('</ul>');
  }

  $('panel-overview').innerHTML = parts.join('');
}

function fileKind(path) {
  if (/\.server\.luau?$/.test(path)) return 'Script';
  if (/\.client\.luau?$/.test(path)) return 'LocalScript';
  if (/\.luau?$/.test(path)) return 'ModuleScript';
  return 'plik';
}

function renderFiles(project) {
  const tree = $('file-tree');
  tree.innerHTML = '';
  const files = project.files || [];
  if (!files.length) {
    tree.innerHTML = '<li>Brak plików Luau.</li>';
    return;
  }
  if (!state.selectedFile || !files.some((f) => f.path === state.selectedFile)) {
    state.selectedFile = files[0].path;
  }
  for (const file of files) {
    const li = document.createElement('li');
    const lines = String(file.content || '').split('\n').length;
    li.innerHTML = `${escapeHtml(file.path)}<span class="badge">${lines} linii · ${fileKind(file.path)}</span>`;
    if (file.path === state.selectedFile) li.classList.add('active');
    li.addEventListener('click', () => {
      state.selectedFile = file.path;
      renderFiles(project);
    });
    tree.appendChild(li);
  }
  showFile(project.files.find((f) => f.path === state.selectedFile));
}

function showFile(file) {
  if (!file) {
    $('code-view').textContent = '';
    $('code-path').textContent = '—';
    return;
  }
  $('code-path').textContent = `${file.path}  (${fileKind(file.path)})`;
  $('code-view').innerHTML = highlightLuau(file.content || '');
}

function renderWorld(project) {
  const root = project.world?.world || project.world;
  const lighting = project.world?.lighting || {};
  const lines = [];

  const walk = (node, depth) => {
    const pad = '  '.repeat(depth);
    const props = node.properties && Object.keys(node.properties).length
      ? ` <span class="props">${escapeHtml(JSON.stringify(node.properties).slice(0, 160))}</span>`
      : '';
    lines.push(`${pad}<span class="node">${escapeHtml(node.name || node.className)}</span> <span class="cls">[${escapeHtml(node.className)}]</span>${props}`);
    for (const child of node.children || []) walk(child, depth + 1);
  };

  if (root) walk(root, 0);

  const lightingLines = Object.entries(lighting).map(([k, v]) => `  ${k} = ${JSON.stringify(v)}`).join('\n');

  $('panel-world').innerHTML = `
    <p class="hint">Ten szkielet jest zapisywany do Workspace przy imporcie .rbxmx oraz budowany przez wtyczkę Studio. Część geometrii gry może powstawać proceduralnie w Luau (np. <code>LevelBuilder</code>).</p>
    <pre class="tree">${lines.join('\n') || '(brak świata)'}</pre>
    <h3 style="color:var(--green);font-size:15px;margin:16px 0 8px">Lighting</h3>
    <pre class="tree">${escapeHtml(lightingLines || '(domyślne)')}</pre>
  `;
}

function renderArch(project) {
  const plan = project.plan || {};
  const parts = [];

  if (plan.architecture) parts.push(markdown(plan.architecture));

  if (Array.isArray(plan.files) && plan.files.length) {
    parts.push('<h3 style="color:var(--green);font-size:15px;margin-top:16px">Plan plików</h3>');
    parts.push('<table class="md" style="width:100%"><tr><th>Plik</th><th>Rola</th><th>Eksportuje</th><th>Linie</th></tr>');
    for (const file of plan.files) {
      parts.push(`<tr><td><code>${escapeHtml(file.path)}</code></td><td>${escapeHtml(file.purpose || '')}</td><td>${escapeHtml((file.exports || []).join(', ') || '—')}</td><td>${escapeHtml(String(file.lines || '—'))}</td></tr>`);
    }
    parts.push('</table>');
  }

  if (Array.isArray(plan.remoteEvents) && plan.remoteEvents.length) {
    parts.push('<h3 style="color:var(--green);font-size:15px;margin-top:16px">RemoteEventy</h3>');
    parts.push('<table class="md" style="width:100%"><tr><th>Nazwa</th><th>Kierunek</th><th>Payload</th></tr>');
    for (const remote of plan.remoteEvents) {
      parts.push(`<tr><td><code>${escapeHtml(remote.name)}</code></td><td>${escapeHtml(remote.direction)}</td><td>${escapeHtml(remote.payload || '')}</td></tr>`);
    }
    parts.push('</table>');
  }

  $('panel-arch').innerHTML = parts.join('') || '<p class="hint">Brak danych o architekturze.</p>';
}

function renderExportHelp(project) {
  const slug = (project.name || 'ai-game').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  $('panel-export').innerHTML = `
    <ol class="steps">
      <li><strong>Najprościej (bez Rojo):</strong> pobierz <code>${escapeHtml(slug)}.rbxmx</code>, otwórz Roblox Studio → nowy Baseplate → przeciągnij plik do okna Studio (albo Model → Import from file). Skrypty wejdą do ServerScriptService / StarterPlayerScripts, a mapa do Workspace.</li>
      <li><strong>Wtyczka z wbudowaną grą:</strong> pobierz <code>${escapeHtml(slug)}.plugin.luau</code> → Studio: <em>Plugins → Plugins Folder</em> → wrzuć plik do folderu → restart Studio → na pasku wtyczek kliknij <strong>Buduj grę</strong>. Gra zbuduje się w otwartym miejscu jednym kliknięciem.</li>
      <li><strong>Dla programistów (Rojo):</strong> pobierz ZIP, rozpakuj, zainstaluj <a href="https://rojo.space" target="_blank" rel="noreferrer">Rojo</a>, w folderze uruchom <code>rojo serve</code>, w Studio kliknij <em>Connect</em>.</li>
      <li><strong>Zapisz projekt:</strong> plik <code>ai-builder.json</code> w ZIP-ie pozwala wrócić do projektu (przycisk „Wczytaj projekt” po lewej).</li>
    </ol>
    <div class="ok-box">Wskazówka: generowane gry nie używają żadnych assetów z Toolboxa (zero <code>rbxassetid</code>) — geometria, UI i dźwięki powstają proceduralnie, więc nic nie zniknie i nie zostanie zmoderowane.</div>
  `;
}

/* ------------------------------------------------------------------ *
 * Tabs
 * ------------------------------------------------------------------ */
function setupTabs() {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      for (const other of document.querySelectorAll('.tab')) other.classList.remove('active');
      tab.classList.add('active');
      for (const panel of ['overview', 'files', 'world', 'arch', 'export']) {
        $(`panel-${panel}`).classList.toggle('hidden', panel !== tab.dataset.tab);
      }
    });
  }
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */
function setupEvents() {
  for (const button of $('mode-switch').querySelectorAll('.seg')) {
    button.addEventListener('click', () => {
      for (const other of $('mode-switch').querySelectorAll('.seg')) other.classList.remove('active');
      button.classList.add('active');
      state.mode = button.dataset.mode;
      const isApi = state.mode === 'api';
      $('api-fields').classList.toggle('hidden', !isApi);
      $('mode-pill').textContent = isApi ? 'Własny klucz API' : 'Tryb demo';
      $('mode-hint').textContent = isApi
        ? 'Użyj własnego klucza (OpenAI, Claude, Gemini, OpenRouter, DeepSeek, Groq, Mistral, xAI, Ollama).'
        : 'Gotowe projekty bez żadnego klucza — idealne na start i testy.';
      updateModelSummary();
    });
  }

  for (const button of $('scale-switch').querySelectorAll('.seg')) {
    button.addEventListener('click', () => {
      for (const other of $('scale-switch').querySelectorAll('.seg')) other.classList.remove('active');
      button.classList.add('active');
      state.scale = button.dataset.scale;
    });
  }

  for (const chip of examples) {
    const element = document.createElement('button');
    element.className = 'chip';
    element.textContent = chip;
    element.addEventListener('click', () => { $('idea-input').value = chip; });
    $('example-chips').appendChild(element);
  }

  $('generate-btn').addEventListener('click', generate);
  $('cancel-btn').addEventListener('click', cancel);
  $('export-zip-btn').addEventListener('click', () => download('zip'));
  $('export-rbxmx-btn').addEventListener('click', () => download('rbxmx'));
  $('export-plugin-btn').addEventListener('click', () => download('plugin'));
  $('model-input').addEventListener('input', updateModelSummary);
  $('provider-select').addEventListener('change', updateModelSummary);

  $('copy-code-btn').addEventListener('click', async () => {
    const file = state.project?.files?.find((f) => f.path === state.selectedFile);
    if (!file) return;
    try {
      await navigator.clipboard.writeText(file.content);
      toast('Skopiowano kod do schowka', 'ok');
    } catch {
      toast('Przeglądarka zablokowała schowek — zaznacz i skopiuj ręcznie.', 'err');
    }
  });

  $('download-file-btn').addEventListener('click', () => {
    const file = state.project?.files?.find((f) => f.path === state.selectedFile);
    if (!file) return;
    const blob = new Blob([file.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.path.split('/').pop();
    a.click();
    URL.revokeObjectURL(url);
  });

  $('test-key-btn').addEventListener('click', async () => {
    const result = $('test-result');
    result.textContent = 'Testuję…';
    result.className = 'test-result';
    try {
      const data = await api('/api/test', { method: 'POST', body: JSON.stringify({ config: buildConfig() }) });
      if (data.ok) {
        result.textContent = `Działa (${data.ms} ms) · odpowiedź: „${data.reply}”`;
        result.className = 'test-result ok';
      } else {
        result.textContent = data.error || 'Błąd testu.';
        result.className = 'test-result err';
      }
    } catch (err) {
      result.textContent = err.message;
      result.className = 'test-result err';
    }
  });

  $('list-models-btn').addEventListener('click', async () => {
    const result = $('test-result');
    result.textContent = 'Pobieram listę modeli…';
    try {
      const data = await api('/api/models', { method: 'POST', body: JSON.stringify({ config: buildConfig() }) });
      const list = $('model-list');
      list.innerHTML = '';
      for (const model of data.models) {
        const option = document.createElement('option');
        option.value = model;
        list.appendChild(option);
      }
      result.textContent = `Znaleziono ${data.models.length} modeli — lista podpowiedzi zaktualizowana.`;
      result.className = 'test-result ok';
    } catch (err) {
      result.textContent = err.message;
      result.className = 'test-result err';
    }
  });

  $('import-btn').addEventListener('click', () => $('idea-file-input').click());
  $('idea-file-input').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed.files || !Array.isArray(parsed.files)) throw new Error('To nie jest plik ai-builder.json');
      const data = await api('/api/validate', { method: 'POST', body: JSON.stringify({ project: parsed }) });
      renderProject({ ...parsed, validation: data.validation });
      toast(`Wczytano projekt: ${parsed.name || file.name}`, 'ok');
    } catch (err) {
      toast(`Nie udało się wczytać: ${err.message}`, 'err');
    }
  });
}

function updateModelSummary() {
  $('model-summary').textContent = state.mode === 'demo'
    ? 'tryb demo — kliknij demo po lewej albo wpisz obby / td / arena'
    : `${$('provider-select').value} · ${$('model-input').value || 'brak modelu'}`;
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */
setupTabs();
setupEvents();
loadHealth();
loadProviders();
loadDemos();
