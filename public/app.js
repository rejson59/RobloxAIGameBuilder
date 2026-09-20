/* Roblox AI Game Builder – frontend (bez frameworków, bez zależności). */

const state = {
  mode: 'demo',
  scale: 'standard',
  providers: [],
  demos: [],
  project: null,
  projectId: null,
  selectedFile: null,
  jobId: null,
  stream: null,
  busy: false,
  library: [],
  chat: [],
  pluginSource: '',
};

const $ = (id) => document.getElementById(id);
const examples = [
  'Obby: parkour nad lawą z checkpointami i sklepem',
  'Tycoon: piekarnia — kupuj maszyny, zarabiaj, rozbudowuj',
  'Tower Defense: potwory idą ścieżką do bazy, 3 typy wież',
  'Symulator: łowienie ryb z rzadkościami i rankingiem',
  'Arena PvP: dwie drużyny, rundy po 3 minuty, kill feed',
  'Horror: nawiedzony szpital, latarka, generatory do naprawy',
  'Battle Royale dla 8 graczy: kurczące się pole, skrzynki z lootem',
  'Wyścigi: tory z przeszkodami, boost, tabela czasów',
];
const refineIdeas = [
  'dodaj sklep z ulepszeniami',
  'dodaj ranking graczy i zapis postępu',
  'zwiększ trudność i dodaj bossa',
  'dodaj drugą broń / drugą mechanikę',
  'popraw balans: tempo rozgrywki ma być szybsze',
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
  }, 5400);
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
    let message = text;
    try { message = JSON.parse(text).error || text; } catch { /* zwykły tekst */ }
    throw new Error(message || `HTTP ${res.status}`);
  }
  return res.json();
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function download(format) {
  if (!state.project) return;
  try {
    toast(`Przygotowuję plik (${format})...`);
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        project: state.project,
        format,
        serverUrl: $('plugin-server-url').value.trim() || undefined,
        provider: $('provider-select').value || undefined,
        model: $('model-input').value.trim() || undefined,
        language: $('language-select').value,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);
    downloadBlob(blob, match ? match[1] : `${state.projectId || 'game'}.${format}`);
    toast('Pobrano plik.', 'ok');
  } catch (err) {
    toast(`Nie udało się wyeksportować: ${err.message}`, 'err');
  }
}

/* ------------------------------------------------------------------ *
 * Syntax highlighting + markdown
 * ------------------------------------------------------------------ */
const LUAU_TOKEN = /(--\[\[[\s\S]*?\]\]|--[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\[\[[\s\S]*?\]\])|(\b\d+(?:\.\d+)?\b)|(\b(?:local|function|end|if|then|else|elseif|for|while|do|repeat|until|return|break|continue|and|or|not|in|nil|true|false|self)\b)|(\b(?:game|workspace|script|plugin|Instance|Enum|task|Vector3|Vector2|CFrame|Color3|UDim2|UDim|TweenInfo|Random|NumberRange|Ray|Region3|BrickColor|TweenService|Players|ReplicatedStorage|ServerScriptService|ServerStorage|StarterGui|StarterPlayer|RunService|UserInputService|ContextActionService|CollectionService|Debris|Lighting|Teams|HttpService|ChangeHistoryService|Selection|os|math|string|table|ipairs|pairs|pcall|xpcall|type|typeof|tostring|tonumber|select|warn|require|print|error|assert|setmetatable|getmetatable|next|coroutine|bit32|utf8)\b)|(\b[A-Za-z_]\w*(?=\s*\())|(\b[A-Z][A-Za-z0-9]*\b)/g;

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
      if (/^[\s|:-]+$/.test(line)) continue;
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (!inTable) {
        closeList();
        html += `<table><tr>${cells.map((c) => `<th>${inline(c)}</th>`).join('')}</tr>`;
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
 * Boot: providers, demos, library
 * ------------------------------------------------------------------ */
async function loadHealth() {
  try {
    const health = await api('/api/health');
    $('health-pill').textContent = `v${health.version} · Node ${health.node}`;
    $('library-pill').textContent = `biblioteka: ${health.projects}`;
    if (!$('plugin-server-url').dataset.touched) {
      const port = window.location.port || '5173';
      $('plugin-server-url').value = `http://127.0.0.1:${port}`;
    }
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
      option.textContent = provider.label;
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
  if (id === 'custom' && !$('base-url-input').value) $('base-url-input').value = 'http://127.0.0.1:8080/v1';
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
    setProgress(0.5);
    const data = await api('/api/demo', { method: 'POST', body: JSON.stringify({ id }) });
    setProgress(1);
    logLine('Projekt demo gotowy (bez wywołań API).', 'ok');
    renderProject(data.project, data.projectId);
    toast(`Wczytano demo: ${data.project.name}`, 'ok');
    loadLibrary();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    setBusy(false);
  }
}

async function loadLibrary() {
  try {
    const data = await api('/api/library');
    state.library = data.projects;
    $('library-path').textContent = `Folder: ${data.libraryPath}`;
    $('library-pill').textContent = `biblioteka: ${data.projects.length}`;
    const list = $('library-list');
    list.innerHTML = '';
    if (!data.projects.length) {
      list.innerHTML = '<p class="hint">Brak zapisanych projektów. Wygeneruj coś — zapisze się automatycznie.</p>';
      return;
    }
    for (const item of data.projects) {
      const row = document.createElement('div');
      row.className = 'library-item';
      row.innerHTML = `
        <div class="meta">
          <strong>${escapeHtml(item.name || item.id)}</strong>
          <span>${escapeHtml(item.genre || '')} · ${item.files} plików · ${item.lines} linii · wersji: ${item.versions}${item.demo ? ' · demo' : ''}</span>
        </div>
        <div class="actions">
          <button class="btn btn-ghost btn-small" data-action="open">Otwórz</button>
          <button class="btn btn-ghost btn-small" data-action="delete">Usuń</button>
        </div>`;
      row.querySelector('[data-action="open"]').addEventListener('click', () => openLibraryProject(item.id));
      row.querySelector('[data-action="delete"]').addEventListener('click', async () => {
        await api(`/api/library/${item.id}/delete`, { method: 'POST', body: '{}' });
        toast('Usunięto projekt.', 'ok');
        loadLibrary();
      });
      list.appendChild(row);
    }
  } catch (err) {
    toast(`Biblioteka: ${err.message}`, 'err');
  }
}

async function openLibraryProject(id) {
  try {
    const data = await api(`/api/library/${id}`);
    renderProject(data.project, id);
    toast(`Otwarto: ${data.project.name}`, 'ok');
    setBusy(false);
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ------------------------------------------------------------------ *
 * Generation / refine via jobs + SSE
 * ------------------------------------------------------------------ */
function showProgress() {
  $('progress-card').classList.remove('hidden');
  $('log').innerHTML = '';
  setProgress(0.03);
}

function setBusy(busy) {
  state.busy = busy;
  $('generate-btn').disabled = busy;
  $('refine-btn').disabled = busy;
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
  return {
    scale: state.scale,
    language: $('language-select').value,
    mustHave: $('musthave-input').value.split(',').map((s) => s.trim()).filter(Boolean),
    autoRepair: $('autorepair-input').checked,
  };
}

/** Opens the SSE stream for a job and wires the handlers. */
function streamJob(jobId, { onDone } = {}) {
  state.jobId = jobId;
  state.stream?.close();
  const stream = new EventSource(`/api/jobs/${jobId}/stream`);
  state.stream = stream;

  stream.onmessage = (event) => {
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    handleEvent(payload, onDone);
  };
  stream.onerror = () => {
    if (state.busy) logLine('Strumień przerwany — sprawdź log serwera.', 'warn');
    stream.close();
  };
  return stream;
}

function handleEvent(event, onDone) {
  switch (event.type) {
    case 'open':
      logLine(`Zadanie ${event.jobId} uruchomione.`);
      break;
    case 'stage':
      logLine(event.message, 'stage');
      setProgress(typeof event.progress === 'number' ? 0.15 + event.progress * 0.75 : 0.2);
      break;
    case 'plan':
      logLine(event.message, 'ok');
      setProgress(0.42);
      break;
    case 'files':
      if (event.files) logLine(`Pliki: ${event.files.length}`, '');
      break;
    case 'progress':
      if (typeof event.progress === 'number') setProgress(event.progress);
      if (event.message) logLine(event.message, 'ok');
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
      renderProject(event.project, event.projectId || event.project?.projectId);
      toast(`Gotowe: ${event.project.name}`, 'ok');
      loadLibrary();
      logLine('Projekt zapisany w bibliotece.', 'ok');
      onDone?.(event.project);
      break;
    case 'end':
      setBusy(false);
      state.stream?.close();
      break;
    default:
      break;
  }
}

async function generate() {
  if (state.busy) return;
  const idea = $('idea-input').value.trim();

  if (state.mode === 'api') {
    const config = buildConfig();
    const provider = state.providers.find((p) => p.id === config.provider);
    if (!idea) {
      toast('Opisz swoją grę (albo wybierz demo po lewej).', 'err');
      return;
    }
    if (provider?.needsKey && !config.apiKey) {
      toast(`Podaj klucz API dla ${provider.label}.`, 'err');
      return;
    }
    if (!config.model) {
      toast('Podaj nazwę modelu.', 'err');
      return;
    }
  } else if (!idea) {
    toast('Wpisz np. "obby", "td", "arena", "tycoon" lub "horror" — albo kliknij demo po lewej.', 'err');
    return;
  }

  showProgress();
  setBusy(true);
  try {
    const { jobId } = await api('/api/generate', {
      method: 'POST',
      body: JSON.stringify({
        idea,
        options: state.mode === 'demo' ? { ...buildOptions(), demo: true, demoId: idea } : buildOptions(),
        config: buildConfig(),
      }),
    });
    streamJob(jobId);
  } catch (err) {
    logLine(`Błąd: ${err.message}`, 'err');
    toast(err.message, 'err');
    setBusy(false);
  }
}

async function refine() {
  if (state.busy) return;
  const instruction = $('refine-input').value.trim();
  if (!state.project) {
    toast('Najpierw wygeneruj albo wczytaj projekt.', 'err');
    return;
  }
  if (!instruction) {
    toast('Opisz, co chcesz zmienić.', 'err');
    return;
  }
  if (state.mode !== 'api') {
    toast('Zmiany przez AI wymagają trybu "Własny klucz API" (demo jest offline).', 'err');
    return;
  }

  state.chat.push({ role: 'user', text: instruction });
  renderChat('Zmieniam kod projektu...');
  $('refine-input').value = '';
  setBusy(true);
  showProgress();
  logLine(`Zmiana: ${instruction}`, 'stage');

  try {
    const { jobId } = await api('/api/refine', {
      method: 'POST',
      body: JSON.stringify({
        projectId: state.projectId,
        project: state.project,
        instruction,
        config: buildConfig(),
        options: { language: $('language-select').value },
      }),
    });
    streamJob(jobId, {
      onDone: (project) => {
        const summary = project.refinements?.[project.refinements.length - 1]?.summary;
        state.chat.push({ role: 'ai', text: summary || 'Zmiana wprowadzona i zwalidowana.', meta: 'model przepisał pliki i zbudował nową wersję projektu' });
        renderChat();
      },
    });
  } catch (err) {
    state.chat.push({ role: 'ai', text: `Nie udało się: ${err.message}` });
    renderChat();
    toast(err.message, 'err');
    setBusy(false);
  }
}

async function cancel() {
  if (!state.jobId) return;
  try {
    await api(`/api/jobs/${state.jobId}/cancel`, { method: 'POST', body: '{}' });
    logLine('Wysłano żądanie przerwania...', 'warn');
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */
function renderProject(project, projectId) {
  state.project = project;
  state.projectId = projectId || project.projectId || null;
  state.selectedFile = project.files?.[0]?.path || null;
  if (!state.chat.length && project.refinements?.length) {
    state.chat = project.refinements.flatMap((r) => ([
      { role: 'user', text: r.instruction },
      { role: 'ai', text: r.summary, meta: new Date(r.at).toLocaleString() },
    ]));
  }

  $('result-card').classList.remove('hidden');
  $('game-name').textContent = project.name || 'AI Game';
  $('game-tagline').textContent = project.tagline || project.summary || '';
  $('tab-files-count').textContent = `(${project.files?.length || 0})`;

  const iconUrl = thumbUrl();
  $('icon-preview').src = iconUrl;
  $('icon-preview').alt = `Ikona: ${project.name}`;

  renderNotice(project);
  renderStats(project);
  renderOverview(project);
  renderFiles(project);
  renderWorld(project);
  renderArch(project);
  renderExportHelp(project);
  renderChat();
  $('refine-hint').textContent = state.mode === 'demo'
    ? 'Tryb demo jest offline — zmiany przez AI wymagają własnego klucza API (zakładka „Własny klucz API” po lewej).'
    : `Zmiana zostanie wykonana modelem ${$('model-input').value || '—'} i zapisana jako nowa wersja projektu.`;
}

function thumbUrl() {
  const params = new URLSearchParams();
  if (state.projectId) params.set('project', state.projectId);
  params.set('name', state.project?.name || 'AI GAME');
  params.set('genre', state.project?.genre || state.project?.design?.genre || '');
  params.set('size', '512');
  params.set('t', String(Date.now()));
  return `/api/thumbnail?${params.toString()}`;
}

function renderNotice(project) {
  const parts = [];
  if (project.repairs) {
    parts.push(`<div class="ok-box">Auto-naprawa: model poprawił błędy wykryte przez walidator i przebudował projekt.</div>`);
  }
  if (state.projectId) {
    parts.push(`<div class="hint">Zapisane w bibliotece jako <code>${escapeHtml(state.projectId)}</code> — możesz wrócić do tego projektu później (zakładka „Biblioteka” po lewej).</div>`);
  }
  $('notice').innerHTML = parts.join('');
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
    parts.push('<div class="ok-box">Walidator nie znalazł problemów: brak przestarzałych API, brak placeholderów, moduły mają <code>return</code>, każdy plik przeszedł kontrolę składni Luau.</div>');
  }

  parts.push('<dl class="kv">');
  for (const [key, value] of [
    ['Gatunek', design.genre || project.genre],
    ['Pętla rozgrywki', design.coreLoop],
    ['Długość sesji', design.sessionLength],
    ['Grupa docelowa', design.audience],
    ['Progresja', design.progression],
  ]) {
    if (value) parts.push(`<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(String(value))}</dd>`);
  }
  parts.push('</dl>');

  if (project.summary) parts.push(`<p>${escapeHtml(project.summary)}</p>`);

  if (Array.isArray(design.systems) && design.systems.length) {
    parts.push('<h3 class="section-title">Systemy gry</h3>');
    parts.push('<table class="md"><tr><th>System</th><th>Cel</th><th>Autorytet serwera</th><th>Kluczowe liczby</th></tr>');
    for (const system of design.systems) {
      parts.push(`<tr><td>${escapeHtml(system.name || '')}</td><td>${escapeHtml(system.purpose || '')}</td><td>${escapeHtml(system.serverAuthority || '')}</td><td><code>${escapeHtml(JSON.stringify(system.keyParameters || {}))}</code></td></tr>`);
    }
    parts.push('</table>');
  }

  if (design.designDoc) parts.push(markdown(design.designDoc));
  if (Array.isArray(project.notes) && project.notes.length) {
    parts.push('<h3 class="section-title">Notatki z generowania</h3><ul>');
    for (const note of project.notes.slice(0, 14)) parts.push(`<li>${escapeHtml(String(note))}</li>`);
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
  showFile(files.find((f) => f.path === state.selectedFile));
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
      ? ` <span class="props">${escapeHtml(JSON.stringify(node.properties).slice(0, 150))}</span>`
      : '';
    lines.push(`${pad}<span class="node">${escapeHtml(node.name || node.className)}</span> <span class="cls">[${escapeHtml(node.className)}]</span>${props}`);
    for (const child of node.children || []) walk(child, depth + 1);
  };
  if (root) walk(root, 0);

  const lightingLines = Object.entries(lighting).map(([k, v]) => `  ${k} = ${JSON.stringify(v)}`).join('\n');

  $('panel-world').innerHTML = `
    <p class="hint">Szkielet świata trafia do Workspace przy imporcie <code>.rbxmx</code>/<code>.rbxlx</code> oraz gdy wtyczka Studio kliknie „Buduj grę”. Część geometrii może powstawać proceduralnie w Luau (np. <code>LevelBuilder</code>).</p>
    <pre class="tree">${lines.join('\n') || '(brak świata)'}</pre>
    <h3 class="section-title">Lighting</h3>
    <pre class="tree">${escapeHtml(lightingLines || '(domyślne)')}</pre>
  `;
}

function renderArch(project) {
  const plan = project.plan || {};
  const parts = [];
  if (plan.architecture) parts.push(markdown(plan.architecture));

  if (Array.isArray(plan.files) && plan.files.length) {
    parts.push('<h3 class="section-title">Plan plików</h3>');
    parts.push('<table class="md"><tr><th>Plik</th><th>Rola</th><th>Eksportuje</th><th>Linie</th></tr>');
    for (const file of plan.files) {
      parts.push(`<tr><td><code>${escapeHtml(file.path)}</code></td><td>${escapeHtml(file.purpose || '')}</td><td>${escapeHtml((file.exports || []).join(', ') || '—')}</td><td>${escapeHtml(String(file.lines || '—'))}</td></tr>`);
    }
    parts.push('</table>');
  }

  if (Array.isArray(plan.remoteEvents) && plan.remoteEvents.length) {
    parts.push('<h3 class="section-title">RemoteEventy</h3>');
    parts.push('<table class="md"><tr><th>Nazwa</th><th>Kierunek</th><th>Payload</th></tr>');
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
      <li><strong>Wtyczka Studio (najwygodniej):</strong> zakładka <em>Wtyczka Studio</em> → pobierz <code>${escapeHtml(slug)}.plugin.luau</code> → Studio: <em>Plugins → Plugins Folder</em> → restart → <em>Buduj grę</em>.</li>
      <li><strong>Model do przeciągnięcia:</strong> <code>${escapeHtml(slug)}.rbxmx</code> → Studio → nowy Baseplate → przeciągnij plik do okna (albo <em>Model → Import from file</em>).</li>
      <li><strong>Całe miejsce:</strong> <code>${escapeHtml(slug)}.rbxlx</code> → otwórz w Studio jak zwykły plik miejsca.</li>
      <li><strong>Dla programistów:</strong> ZIP z projektem Rojo → rozpakuj → <code>rojo serve</code> → w Studio wtyczka Rojo → <em>Connect</em>.</li>
      <li><strong>Ikona gry:</strong> przycisk <em>Ikona PNG</em> → wgraj na create.roblox.com (512×512, gotowe).</li>
    </ol>
    <div class="ok-box">Generowane gry nie używają assetów z Toolboxa (zero <code>rbxassetid</code>): geometria, UI i dźwięki powstają proceduralnie, więc nic nie zniknie i nie zostanie zmoderowane.</div>
  `;
}

/* ---------- chat ---------- */
function renderChat(statusMessage) {
  const history = $('refine-history');
  const bubbles = state.chat.map((message) => `
    <div class="chat-bubble ${message.role === 'user' ? 'user' : 'ai'}">
      ${escapeHtml(message.text)}
      ${message.meta ? `<span class="meta">${escapeHtml(message.meta)}</span>` : ''}
    </div>`);
  if (statusMessage) bubbles.push(`<div class="chat-bubble ai"><em>${escapeHtml(statusMessage)}</em></div>`);
  history.innerHTML = bubbles.length ? bubbles.join('') : '<p class="chat-empty">Tu pojawi się historia zmian. Napisz np. „dodaj sklep z ulepszeniami”, a AI przepisze pliki i zbuduje nową wersję projektu.</p>';
  history.scrollTop = history.scrollHeight;
}

/* ---------- plugin panel ---------- */
async function loadPluginSource() {
  if (!state.project) {
    toast('Najpierw wygeneruj projekt.', 'err');
    return;
  }
  $('plugin-source').textContent = 'Wczytuję kod wtyczki...';
  try {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        project: state.project,
        format: 'plugin',
        serverUrl: $('plugin-server-url').value.trim(),
        language: $('language-select').value,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    state.pluginSource = await res.text();
    $('plugin-source').innerHTML = highlightLuau(state.pluginSource.split('\n').slice(0, 260).join('\n')) + '\n<span class="tok-comment">-- … (podgląd pierwszych 260 linii, pełny plik pobierz przyciskiem)</span>';
  } catch (err) {
    $('plugin-source').textContent = `Nie udało się wczytać: ${err.message}`;
  }
}

/* ------------------------------------------------------------------ *
 * Tabs
 * ------------------------------------------------------------------ */
function setupTabs() {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      for (const other of document.querySelectorAll('.tab')) other.classList.remove('active');
      tab.classList.add('active');
      for (const name of ['overview', 'files', 'refine', 'studio', 'world', 'arch', 'export']) {
        $(`panel-${name}`).classList.toggle('hidden', name !== tab.dataset.tab);
      }
      if (tab.dataset.tab === 'studio' && !state.pluginSource) loadPluginSource();
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
        : '5 gotowych gier bez żadnego klucza — idealne na start i testy.';
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

  for (const idea of refineIdeas) {
    const element = document.createElement('button');
    element.className = 'chip';
    element.textContent = idea;
    element.addEventListener('click', () => { $('refine-input').value = idea; });
    $('refine-chips').appendChild(element);
  }

  $('generate-btn').addEventListener('click', generate);
  $('cancel-btn').addEventListener('click', cancel);
  $('refine-btn').addEventListener('click', refine);
  $('export-zip-btn').addEventListener('click', () => download('zip'));
  $('export-rbxmx-btn').addEventListener('click', () => download('rbxmx'));
  $('export-place-btn').addEventListener('click', () => download('place'));
  $('export-plugin-btn').addEventListener('click', () => {
    document.querySelector('.tab[data-tab="studio"]').click();
    loadPluginSource();
  });
  $('download-icon-btn').addEventListener('click', async () => {
    try {
      const res = await fetch(thumbUrl());
      const blob = await res.blob();
      downloadBlob(blob, `${(state.project?.name || 'gra').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-icon.png`);
    } catch (err) {
      toast(`Ikona: ${err.message}`, 'err');
    }
  });
  $('plugin-download').addEventListener('click', () => download('plugin'));
  $('plugin-refresh').addEventListener('click', loadPluginSource);
  $('plugin-copy').addEventListener('click', async () => {
    if (!state.pluginSource) await loadPluginSource();
    try {
      await navigator.clipboard.writeText(state.pluginSource);
      toast('Kod wtyczki w schowku — wklej go do pliku .plugin.luau', 'ok');
    } catch {
      toast('Przeglądarka zablokowała schowek — użyj przycisku pobierania.', 'err');
    }
  });
  $('plugin-server-url').addEventListener('input', () => { $('plugin-server-url').dataset.touched = '1'; });
  $('model-input').addEventListener('input', updateModelSummary);
  $('provider-select').addEventListener('change', updateModelSummary);
  $('library-refresh').addEventListener('click', loadLibrary);

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
    downloadBlob(new Blob([file.content], { type: 'text/plain' }), file.path.split('/').pop());
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
      const parsed = JSON.parse(await file.text());
      if (!parsed.files || !Array.isArray(parsed.files)) throw new Error('To nie jest plik ai-builder.json');
      const data = await api('/api/validate', { method: 'POST', body: JSON.stringify({ project: parsed }) });
      renderProject({ ...parsed, validation: data.validation }, null);
      toast(`Wczytano projekt: ${parsed.name || file.name}`, 'ok');
    } catch (err) {
      toast(`Nie udało się wczytać: ${err.message}`, 'err');
    }
  });
}

function updateModelSummary() {
  const model = `${$('provider-select').value} · ${$('model-input').value || 'brak modelu'}`;
  $('model-summary').textContent = state.mode === 'demo'
    ? 'tryb demo — kliknij demo po lewej albo wpisz obby / td / arena / tycoon / horror'
    : model;
  const info = $('plugin-model-info');
  if (info) info.textContent = model;
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */
setupTabs();
setupEvents();
loadHealth();
loadProviders();
loadDemos();
loadLibrary();
setInterval(loadHealth, 20000);
