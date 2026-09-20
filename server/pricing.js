/**
 * Cost estimation and budget guard.
 *
 * Prices are USD per 1M tokens and are only an estimate – providers change them,
 * and some models have cached/priority tiers. Edit the table (or set your own
 * rates) if your invoice disagrees. Local providers (Ollama, custom endpoints)
 * are treated as free.
 */

const FREE = { input: 0, output: 0, label: 'lokalny (bez opłat)' };

const TABLE = [
  // OpenAI
  { provider: 'openai', match: /^gpt-4\.1-mini/, label: 'GPT-4.1 mini', input: 0.4, output: 1.6 },
  { provider: 'openai', match: /^gpt-4\.1-nano/, label: 'GPT-4.1 nano', input: 0.1, output: 0.4 },
  { provider: 'openai', match: /^gpt-4\.1/, label: 'GPT-4.1', input: 2, output: 8 },
  { provider: 'openai', match: /^gpt-4o-mini/, label: 'GPT-4o mini', input: 0.15, output: 0.6 },
  { provider: 'openai', match: /^gpt-4o/, label: 'GPT-4o', input: 2.5, output: 10 },
  { provider: 'openai', match: /^o4-mini/, label: 'o4-mini', input: 1.1, output: 4.4 },
  { provider: 'openai', match: /^o3/, label: 'o3', input: 2, output: 8 },
  // Anthropic
  { provider: 'anthropic', match: /opus/, label: 'Claude Opus', input: 15, output: 75 },
  { provider: 'anthropic', match: /sonnet/, label: 'Claude Sonnet', input: 3, output: 15 },
  { provider: 'anthropic', match: /haiku/, label: 'Claude Haiku', input: 0.8, output: 4 },
  // Google
  { provider: 'google', match: /gemini-2\.5-pro/, label: 'Gemini 2.5 Pro', input: 1.25, output: 10 },
  { provider: 'google', match: /gemini-2\.5-flash/, label: 'Gemini 2.5 Flash', input: 0.3, output: 2.5 },
  { provider: 'google', match: /gemini/, label: 'Gemini', input: 0.5, output: 2 },
  // DeepSeek
  { provider: 'deepseek', match: /reasoner/, label: 'DeepSeek Reasoner', input: 0.55, output: 2.19 },
  { provider: 'deepseek', match: /./, label: 'DeepSeek Chat', input: 0.27, output: 1.1 },
  // Others
  { provider: 'groq', match: /70b/, label: 'Llama 70B (Groq)', input: 0.59, output: 0.79 },
  { provider: 'groq', match: /./, label: 'Groq', input: 0.2, output: 0.4 },
  { provider: 'mistral', match: /large/, label: 'Mistral Large', input: 2, output: 6 },
  { provider: 'mistral', match: /./, label: 'Mistral', input: 0.4, output: 1.2 },
  { provider: 'xai', match: /grok-4/, label: 'Grok 4', input: 3, output: 15 },
  { provider: 'xai', match: /./, label: 'Grok', input: 0.3, output: 0.5 },
  { provider: 'openrouter', match: /./, label: 'OpenRouter (zależnie od modelu)', input: 1, output: 3 },
];

/** Rate (USD / 1M tokens) for a provider + model. */
export function rateFor(provider, model) {
  const id = String(provider || '').toLowerCase();
  if (id === 'ollama' || id === 'custom') return { ...FREE, known: true, provider: id };
  const name = String(model || '').toLowerCase();
  for (const entry of TABLE) {
    if (entry.provider === id && entry.match.test(name)) {
      return { input: entry.input, output: entry.output, label: entry.label, known: true, provider: id };
    }
  }
  // Unknown model: assume a mid-tier rate so the budget guard still works.
  return { input: 1, output: 3, label: 'nieznany model (szacunek)', known: false, provider: id };
}

/** Cost of a single call (or of accumulated usage). */
export function costOf({ provider, model, inputTokens = 0, outputTokens = 0 }) {
  const rate = rateFor(provider, model);
  const usd = (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
  return { usd, rate: rate.label, rated: rate.known, provider: rate.provider };
}

export function formatUsd(usd) {
  if (!Number.isFinite(usd)) return '—';
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** Optional spending cap: `MAX_COST_USD` env or per-run `maxCostUsd`. */
export function budgetFor(config = {}) {
  const raw = config.maxCostUsd ?? process.env.MAX_COST_USD;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export class BudgetExceededError extends Error {
  constructor(limit, spent) {
    super(`Przekroczono limit wydatków (${formatUsd(limit)}, wydano ${formatUsd(spent)}). Zwiększ limit albo dokończ projekt na innym modelu.`);
    this.name = 'BudgetExceededError';
    this.limit = limit;
    this.spent = spent;
  }
}

/**
 * Accumulates usage for one project and enforces the budget.
 * The pipeline calls `add()` after every model call.
 */
export class CostTracker {
  constructor({ provider, model, budget = null } = {}) {
    this.provider = provider;
    this.model = model;
    this.budget = budget;
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.calls = 0;
  }

  /** @returns {{usd:number, total:number, call:string}} */
  add(usage = {}) {
    this.inputTokens += usage.inputTokens || 0;
    this.outputTokens += usage.outputTokens || 0;
    this.calls += 1;
    const { usd, rate, rated } = costOf({
      provider: this.provider,
      model: this.model,
      inputTokens: usage.inputTokens || 0,
      outputTokens: usage.outputTokens || 0,
    });
    this.rate = rate;
    this.rated = rated;
    if (this.budget && this.total() > this.budget) {
      throw new BudgetExceededError(this.budget, this.total());
    }
    return { usd, total: this.total(), call: rate };
  }

  total() {
    return costOf({ provider: this.provider, model: this.model, inputTokens: this.inputTokens, outputTokens: this.outputTokens }).usd;
  }

  /** Serializable snapshot stored on the project (`project.usage`). */
  snapshot() {
    const { usd, rate, rated } = costOf({ provider: this.provider, model: this.model, inputTokens: this.inputTokens, outputTokens: this.outputTokens });
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      calls: this.calls,
      provider: this.provider,
      model: this.model,
      usd: Number(usd.toFixed(6)),
      rate,
      rated,
      budget: this.budget,
    };
  }
}

export const PRICING_NOTE = 'Szacunek na podstawie cenników publicznych (USD za 1 mln tokenów). Edytuj tabelę w server/pricing.js, jeśli Twój cennik się różni.';
