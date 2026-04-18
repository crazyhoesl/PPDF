// Provider adapters. Each provider exposes:
//   id       — short internal identifier (used as key in results)
//   name     — display name
//   model    — the specific model name used
//   envKey   — name of the environment variable holding the API key
//   call(apiKey, prompt, { timeoutMs }) → string (raw model text response)

async function fetchWithTimeout(url, opts, timeoutMs = 30_000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ac.signal });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    try { return JSON.parse(text); } catch { return text; }
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`timeout after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Gemini ───────────────────────────────────────────────────────────────────
async function callGemini(apiKey, prompt, { timeoutMs } = {}) {
  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      maxOutputTokens: 2000,
      // Disable "thinking" — for this simple JSON extraction task the
      // internal reasoning budget would otherwise eat the token allowance
      // and truncate the visible response.
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  const data = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, timeoutMs);
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    // Could be a safety block — surface what we know
    const reason = data?.candidates?.[0]?.finishReason || 'empty response';
    throw new Error(`gemini: ${reason}`);
  }
  return text;
}

// ── OpenAI-compatible helper ─────────────────────────────────────────────────
async function callOpenAICompat({ url, apiKey, model, prompt, extraHeaders = {}, jsonMode = true, timeoutMs }) {
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    max_tokens: 800,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const data = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  }, timeoutMs);

  const text = data?.choices?.[0]?.message?.content;
  const finishReason = data?.choices?.[0]?.finish_reason;
  if (!text) throw new Error(`empty response (finish_reason: ${finishReason || 'unknown'})`);
  return text;
}

async function callMistral(apiKey, prompt, opts = {}) {
  return callOpenAICompat({
    ...opts,
    url: 'https://api.mistral.ai/v1/chat/completions',
    apiKey,
    model: 'mistral-large-latest',
    prompt,
    jsonMode: true,
  });
}

async function callGroq(apiKey, prompt, opts = {}) {
  return callOpenAICompat({
    ...opts,
    url: 'https://api.groq.com/openai/v1/chat/completions',
    apiKey,
    model: 'llama-3.3-70b-versatile',
    prompt,
    jsonMode: true,
  });
}

async function callOpenRouter(apiKey, prompt, opts = {}) {
  // JSON mode support on OpenRouter varies per model — DeepSeek free tier
  // often rejects response_format, so we rely on prompt discipline + our
  // fallback prose scanner.
  return callOpenAICompat({
    ...opts,
    url: 'https://openrouter.ai/api/v1/chat/completions',
    apiKey,
    model: 'deepseek/deepseek-chat-v3.1:free',
    prompt,
    jsonMode: false,
    extraHeaders: {
      'HTTP-Referer': 'https://github.com/crazyhoesl/PPDF',
      'X-Title': 'PPDF',
    },
  });
}

async function callCerebras(apiKey, prompt, opts = {}) {
  return callOpenAICompat({
    ...opts,
    url: 'https://api.cerebras.ai/v1/chat/completions',
    apiKey,
    model: 'llama-3.3-70b',
    prompt,
    jsonMode: true,
  });
}

export const providers = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    model: 'gemini-2.5-flash',
    envKey: 'GEMINI_API_KEY',
    call: callGemini,
  },
  {
    id: 'mistral',
    name: 'Mistral',
    model: 'mistral-large-latest',
    envKey: 'MISTRAL_API_KEY',
    call: callMistral,
  },
  {
    id: 'groq',
    name: 'Groq',
    model: 'llama-3.3-70b-versatile',
    envKey: 'GROQ_API_KEY',
    call: callGroq,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    model: 'deepseek-chat-v3.1:free',
    envKey: 'OPENROUTER_API_KEY',
    call: callOpenRouter,
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    model: 'llama-3.3-70b',
    envKey: 'CEREBRAS_API_KEY',
    call: callCerebras,
  },
];
