/**
 * Bring-your-own-key LLM clients.
 *
 * Every provider is called with fetch() directly – no SDKs, no dependencies.
 * Three wire protocols cover all of them:
 *   - openai    : POST {baseUrl}/chat/completions      (OpenAI, OpenRouter, DeepSeek, Groq, Mistral, xAI, Ollama, LM Studio, vLLM, any compatible gateway)
 *   - anthropic : POST {baseUrl}/messages              (Claude)
 *   - gemini    : POST {baseUrl}/models/{model}:generateContent (Google AI Studio)
 *
 * Keys are only ever used for the outbound request; the server keeps them in
 * memory for the session and never logs or persists them.
 */

export const PROVIDERS = [
  {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    needsKey: true,
    keyUrl: 'https://platform.openai.com/api-keys',
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o4-mini'],
    defaultModel: 'gpt-4.1-mini',
    supportsJsonMode: true,
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    needsKey: true,
    keyUrl: 'https://console.anthropic.com/settings/keys',
    models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-3-7-sonnet-latest', 'claude-3-5-haiku-latest'],
    defaultModel: 'claude-sonnet-4-5',
    supportsJsonMode: false,
  },
  {
    id: 'google',
    label: 'Google Gemini',
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    needsKey: true,
    keyUrl: 'https://aistudio.google.com/app/apikey',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    defaultModel: 'gemini-2.5-flash',
    supportsJsonMode: true,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    needsKey: true,
    keyUrl: 'https://openrouter.ai/keys',
    models: [
      'anthropic/claude-sonnet-4.5', 'openai/gpt-4.1', 'google/gemini-2.5-pro',
      'deepseek/deepseek-chat-v3.1', 'qwen/qwen3-coder', 'x-ai/grok-4',
    ],
    defaultModel: 'anthropic/claude-sonnet-4.5',
    supportsJsonMode: false,
    extraHeaders: { 'HTTP-Referer': 'https://github.com/rejson59/RobloxAIGameBuilder', 'X-Title': 'Roblox AI Game Builder' },
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    needsKey: true,
    keyUrl: 'https://platform.deepseek.com/api_keys',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat',
    supportsJsonMode: true,
  },
  {
    id: 'groq',
    label: 'Groq',
    protocol: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    needsKey: true,
    keyUrl: 'https://console.groq.com/keys',
    models: ['llama-3.3-70b-versatile', 'moonshotai/kimi-k2-instruct', 'qwen/qwen3-32b'],
    defaultModel: 'llama-3.3-70b-versatile',
    supportsJsonMode: true,
  },
  {
    id: 'mistral',
    label: 'Mistral',
    protocol: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    needsKey: true,
    keyUrl: 'https://console.mistral.ai/api-keys',
    models: ['mistral-large-latest', 'mistral-medium-latest', 'codestral-latest', 'mistral-small-latest'],
    defaultModel: 'mistral-large-latest',
    supportsJsonMode: true,
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    protocol: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    needsKey: true,
    keyUrl: 'https://console.x.ai',
    models: ['grok-4', 'grok-3', 'grok-3-mini'],
    defaultModel: 'grok-3-mini',
    supportsJsonMode: false,
  },
  {
    id: 'ollama',
    label: 'Ollama (lokalnie, bez klucza)',
    protocol: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    needsKey: false,
    keyUrl: 'https://ollama.com/download',
    models: ['qwen2.5-coder:14b', 'qwen2.5-coder:7b', 'llama3.1:8b', 'deepseek-coder-v2:16b'],
    defaultModel: 'qwen2.5-coder:14b',
    supportsJsonMode: false,
  },
  {
    id: 'custom',
    label: 'Własny endpoint (OpenAI-compatible)',
    protocol: 'openai',
    baseUrl: '',
    needsKey: false,
    keyUrl: '',
    models: [],
    defaultModel: '',
    supportsJsonMode: false,
  },
];

// Potoczne nazwy, które użytkownicy wpisują w konfiguracji/CLI.
const PROVIDER_ALIASES = {
  gemini: 'google',
  googleai: 'google',
  claude: 'anthropic',
  gpt: 'openai',
  chatgpt: 'openai',
  local: 'ollama',
  llama: 'groq',
  openrouter: 'openrouter',
};

export function getProvider(id) {
  const key = String(id || '').toLowerCase().trim();
  const direct = PROVIDERS.find((p) => p.id === key);
  if (direct) return direct;
  const alias = PROVIDER_ALIASES[key];
  return alias ? PROVIDERS.find((p) => p.id === alias) || null : null;
}

export function publicProviders() {
  return PROVIDERS.map(({ id, label, protocol, baseUrl, needsKey, keyUrl, models, defaultModel }) => ({
    id, label, protocol, baseUrl, needsKey, keyUrl, models, defaultModel,
  }));
}

export class ProviderError extends Error {
  constructor(message, { status = 0, provider = '', detail = '' } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.provider = provider;
    this.detail = detail;
  }
}

function friendlyHttpError(status, provider, bodyText) {
  const detail = String(bodyText || '').slice(0, 600);
  const map = {
    400: 'Dostawca odrzucił zapytanie (400). Najczęściej: zła nazwa modelu albo parametr nieobsługiwany przez ten model.',
    401: 'Klucz API został odrzucony (401). Sprawdź, czy klucz jest poprawny i aktywny.',
    402: 'Brak środków na koncie dostawcy (402).',
    403: 'Dostęp zabroniony (403). Klucz nie ma uprawnień do tego modelu lub region jest zablokowany.',
    404: 'Nie znaleziono modelu/endpointu (404). Sprawdź nazwę modelu i adres bazowy.',
    413: 'Zapytanie za duże (413). Zmniejsz opis gry lub liczbę plików w projekcie.',
    422: 'Dostawca odrzucił treść zapytania (422).',
    429: 'Limit zapytań przekroczony (429). Poczekaj chwilę albo wybierz mniejszy model.',
    500: 'Błąd po stronie dostawcy (500). Spróbuj ponownie.',
    502: 'Zła brama dostawcy (502). Spróbuj ponownie.',
    503: 'Model przeciążony (503). Spróbuj ponownie za chwilę.',
    529: 'Model przeciążony (529). Spróbuj ponownie za chwilę.',
  };
  const msg = map[status] || `Dostawca zwrócił błąd HTTP ${status}.`;
  return new ProviderError(msg, { status, provider, detail });
}

async function readError(res) {
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      const inner = json.error?.message || json.message || json.error || text;
      return typeof inner === 'string' ? inner : JSON.stringify(inner);
    } catch {
      return text;
    }
  } catch {
    return '';
  }
}

function joinUrl(base, path) {
  return `${String(base || '').replace(/\/+$/, '')}${path}`;
}

/**
 * One-shot chat completion.
 * @param {object} opts
 * @param {string} opts.provider    provider id
 * @param {string} opts.apiKey
 * @param {string} [opts.baseUrl]   override (custom endpoints)
 * @param {string} opts.model
 * @param {string} opts.system
 * @param {Array<{role:'user'|'assistant',content:string}>} opts.messages
 * @param {number} [opts.maxTokens=8192]
 * @param {number} [opts.temperature=0.6]
 * @param {AbortSignal} [opts.signal]
 * @param {boolean} [opts.jsonMode]
 * @returns {Promise<{text:string, usage:object, model:string, provider:string}>}
 */
export async function chat(opts) {
  const provider = getProvider(opts.provider);
  if (!provider) throw new ProviderError(`Nieznany dostawca: ${opts.provider}`, { provider: opts.provider });
  const baseUrl = (opts.baseUrl || provider.baseUrl || '').trim();
  if (!baseUrl) throw new ProviderError('Brak adresu bazowego (baseUrl) dla tego dostawcy.', { provider: provider.id });
  if (provider.needsKey && !opts.apiKey) {
    throw new ProviderError(`Podaj klucz API dla ${provider.label}.`, { provider: provider.id, status: 401 });
  }
  const model = (opts.model || provider.defaultModel || '').trim();
  if (!model) throw new ProviderError('Brak nazwy modelu.', { provider: provider.id });

  const attempt = async (useJsonMode) => {
    const url = buildUrl({ provider, baseUrl, model });
    const { headers, body } = buildRequest({ provider, apiKey: opts.apiKey, model, system: opts.system, messages: opts.messages, maxTokens: opts.maxTokens ?? 8192, temperature: opts.temperature ?? 0.6, jsonMode: useJsonMode });
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: opts.signal });
    if (!res.ok) {
      const detail = await readError(res);
      throw friendlyHttpError(res.status, provider.label, detail);
    }
    const json = await res.json();
    return parseResponse(provider, json);
  };

  const wantJson = opts.jsonMode && provider.supportsJsonMode;
  try {
    const out = await attempt(wantJson);
    return { ...out, provider: provider.id, model };
  } catch (err) {
    // Some OpenAI-compatible gateways reject response_format – retry once without it.
    if (wantJson && err instanceof ProviderError && err.status === 400 && /response_format|json_object|json mode/i.test(err.detail || '')) {
      const out = await attempt(false);
      return { ...out, provider: provider.id, model };
    }
    if (err instanceof ProviderError) throw err;
    if (err?.name === 'AbortError') throw err;
    throw new ProviderError(`Nie udało się połączyć z ${provider.label}: ${err.message}`, { provider: provider.id, detail: String(err.cause?.message || '') });
  }
}

/* ------------------------------------------------------------------ *
 * Strumieniowanie (SSE) – podgląd pisania kodu na żywo.
 * Obsługujemy wszystkie trzy protokoły; jeśli dostawca nie poda zużycia
 * tokenów w strumieniu, szacujemy je z długości tekstu.
 * ------------------------------------------------------------------ */

/** Odczytuje strumień SSE z odpowiedzi fetch i zwraca kolejne obiekty JSON. */
async function* sseLines(response) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line || line.startsWith(':')) continue;
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        yield JSON.parse(payload);
      } catch {
        /* pomijamy niepełne linie */
      }
    }
  }
}

/**
 * Strumieniowane uzupełnienie czatu.
 *
 * @param {object} opts  jak w `chat()`, dodatkowo:
 * @param {(text:string, full:string)=>void} [opts.onDelta]  wywoływane dla każdego fragmentu
 * @returns {Promise<{text:string, usage:object, streamed:boolean}>}
 */
export async function chatStream(opts) {
  const provider = getProvider(opts.provider);
  if (!provider) throw new ProviderError(`Nieznany dostawca: ${opts.provider}`, { provider: opts.provider });
  const baseUrl = (opts.baseUrl || provider.baseUrl || '').trim();
  if (!baseUrl) throw new ProviderError('Brak adresu bazowego (baseUrl) dla tego dostawcy.', { provider: provider.id });
  if (provider.needsKey && !opts.apiKey) {
    throw new ProviderError(`Podaj klucz API dla ${provider.label}.`, { provider: provider.id, status: 401 });
  }
  const model = (opts.model || provider.defaultModel || '').trim();
  if (!model) throw new ProviderError('Brak nazwy modelu.', { provider: provider.id });

  let url = buildUrl({ provider, baseUrl, model, stream: true });
  const { headers, body } = buildRequest({
    provider,
    apiKey: opts.apiKey,
    model,
    system: opts.system,
    messages: opts.messages,
    maxTokens: opts.maxTokens ?? 8192,
    temperature: opts.temperature ?? 0.6,
    jsonMode: false,
  });

  if (provider.protocol === 'gemini') {
    url = `${url}?alt=sse`;
    body.generationConfig = { ...(body.generationConfig || {}), maxOutputTokens: opts.maxTokens ?? 8192 };
  } else if (provider.protocol === 'anthropic') {
    body.stream = true;
  } else {
    body.stream = true;
    // OpenAI zgodzi się na podsumowanie zużycia; inne bramki po prostu to zignorują.
    body.stream_options = { include_usage: true };
  }

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: opts.signal });
  if (!res.ok) {
    const detail = await readError(res);
    throw friendlyHttpError(res.status, provider.label, detail);
  }
  if (!res.body) throw new ProviderError('Dostawca nie zwrócił strumienia.', { provider: provider.id });

  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let sawUsage = false;

  for await (const event of sseLines(res)) {
    let piece = '';
    if (provider.protocol === 'anthropic') {
      if (event.type === 'message_start') {
        inputTokens = event.message?.usage?.input_tokens ?? inputTokens;
        sawUsage = true;
      } else if (event.type === 'content_block_delta') {
        piece = event.delta?.text || '';
      } else if (event.type === 'message_delta') {
        outputTokens = event.usage?.output_tokens ?? outputTokens;
        sawUsage = true;
      } else if (event.type === 'error') {
        throw new ProviderError(event.error?.message || 'Błąd strumienia dostawcy.', { provider: provider.label });
      }
    } else if (provider.protocol === 'gemini') {
      piece = (event.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join('');
      if (event.usageMetadata) {
        inputTokens = event.usageMetadata.promptTokenCount ?? inputTokens;
        outputTokens = event.usageMetadata.candidatesTokenCount ?? outputTokens;
        sawUsage = true;
      }
    } else {
      piece = event.choices?.[0]?.delta?.content ?? '';
      if (event.usage) {
        inputTokens = event.usage.prompt_tokens ?? inputTokens;
        outputTokens = event.usage.completion_tokens ?? outputTokens;
        sawUsage = true;
      }
      if (event.error) {
        throw new ProviderError(event.error.message || 'Błąd strumienia dostawcy.', { provider: provider.label });
      }
    }
    if (piece) {
      text += piece;
      opts.onDelta?.(piece, text);
    }
  }

  // Część bramek nie przysyła zużycia w strumieniu – szacujemy z długości tekstu,
  // żeby licznik kosztów i budżet nadal działały.
  const approximate = !sawUsage || (outputTokens === 0 && text.length > 0);
  if (approximate) {
    outputTokens = Math.max(outputTokens, Math.ceil(text.length / 4));
    if (!inputTokens) {
      const promptChars = String(opts.system || '').length + (opts.messages || []).reduce((sum, m) => sum + String(m.content || '').length, 0);
      inputTokens = Math.ceil(promptChars / 4);
    }
  }

  return {
    text,
    usage: { inputTokens, outputTokens, approximated: approximate },
    streamed: true,
    provider: provider.id,
    model,
  };
}

function buildUrl({ provider, baseUrl, model, stream = false }) {
  switch (provider.protocol) {
    case 'anthropic':
      return joinUrl(baseUrl, '/messages');
    case 'gemini':
      // Strumień i zwykłe zapytanie mają różne metody w API Google.
      return joinUrl(baseUrl, `/models/${encodeURIComponent(model)}:${stream ? 'streamGenerateContent' : 'generateContent'}`);
    case 'openai':
    default:
      return joinUrl(baseUrl, '/chat/completions');
  }
}

function buildRequest({ provider, apiKey, model, system, messages, maxTokens, temperature, jsonMode }) {
  const msgs = (messages || []).map((m) => ({ role: m.role, content: String(m.content ?? '') }));

  if (provider.protocol === 'anthropic') {
    return {
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        ...(provider.extraHeaders || {}),
      },
      body: { model, system, messages: msgs, max_tokens: maxTokens, temperature },
    };
  }

  if (provider.protocol === 'gemini') {
    return {
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey, ...(provider.extraHeaders || {}) },
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: msgs.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature,
          ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
        },
      },
    };
  }

  return {
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      ...(provider.extraHeaders || {}),
    },
    body: {
      model,
      messages: [{ role: 'system', content: system }, ...msgs],
      max_tokens: maxTokens,
      temperature,
      stream: false,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    },
  };
}

function parseResponse(provider, json) {
  if (provider.protocol === 'anthropic') {
    const text = (json.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    return {
      text,
      usage: { inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0 },
    };
  }
  if (provider.protocol === 'gemini') {
    const cand = json.candidates?.[0];
    const text = (cand?.content?.parts || []).map((p) => p.text || '').join('');
    const finish = cand?.finishReason;
    if (!text && finish) {
      throw new ProviderError(`Model nie zwrócił treści (finishReason: ${finish}). Spróbuj ponownie lub użyj innego modelu.`, { provider: provider.label });
    }
    return {
      text,
      usage: { inputTokens: json.usageMetadata?.promptTokenCount ?? 0, outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0 },
      finishReason: finish,
    };
  }
  const choice = json.choices?.[0];
  const text = choice?.message?.content ?? choice?.text ?? '';
  if (!text && json.error) {
    throw new ProviderError(json.error.message || 'Dostawca zwrócił błąd.', { provider: provider.label });
  }
  return {
    text: typeof text === 'string' ? text : String(text ?? ''),
    usage: { inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: json.usage?.completion_tokens ?? 0 },
    finishReason: choice?.finish_reason,
  };
}

/** Lightweight key/model check used by the "Testuj klucz" button. */
export async function testConnection({ provider, apiKey, model, baseUrl }) {
  const started = Date.now();
  const res = await chat({
    provider,
    apiKey,
    baseUrl,
    model,
    system: 'Jesteś asystentem. Odpowiadaj minimalnie.',
    messages: [{ role: 'user', content: 'Odpowiedz dokładnie jednym słowem: dziala' }],
    maxTokens: 64,
    temperature: 0,
  });
  return { ok: true, ms: Date.now() - started, reply: res.text.trim().slice(0, 120), model: res.model, usage: res.usage };
}

/** Best-effort model list; failures are non-fatal (UI keeps free-text input). */
export async function listModels({ provider: providerId, apiKey, baseUrl }) {
  const provider = getProvider(providerId);
  if (!provider) return [];
  const base = (baseUrl || provider.baseUrl || '').replace(/\/+$/, '');
  try {
    if (provider.protocol === 'gemini') {
      const res = await fetch(`${base}/models`, { headers: { 'x-goog-api-key': apiKey } });
      if (!res.ok) return provider.models;
      const json = await res.json();
      return (json.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => String(m.name || '').replace(/^models\//, ''))
        .slice(0, 100);
    }
    if (provider.protocol === 'anthropic') {
      const res = await fetch(`${base}/models`, { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } });
      if (!res.ok) return provider.models;
      const json = await res.json();
      return (json.data || []).map((m) => m.id).slice(0, 100);
    }
    const res = await fetch(`${base}/models`, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {} });
    if (!res.ok) return provider.models;
    const json = await res.json();
    const list = (json.data || json.models || []).map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
    return list.length ? list.slice(0, 200) : provider.models;
  } catch {
    return provider.models;
  }
}
