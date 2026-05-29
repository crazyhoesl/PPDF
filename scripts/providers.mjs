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
  // "-preview" suffix required — `gemini-3.1-pro` alone returns 404.
  const model = 'gemini-3.1-pro-preview';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      maxOutputTokens: 8000,
      // Gemini 3.x switched from thinkingBudget → thinkingLevel.
      // Supported values for 3.1 Pro: 'low' | 'medium' | 'high' (default: high).
      // 'medium' balances cost/latency against more consistent reasoning —
      // 'low' gave noticeable run-to-run variance on this prompt.
      thinkingConfig: { thinkingLevel: 'medium' },
    },
  };
  const data = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, timeoutMs);
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const reason = data?.candidates?.[0]?.finishReason || 'empty response';
    throw new Error(`gemini: ${reason}`);
  }
  return text;
}

// ── OpenAI-compatible helper (Mistral, Groq, OpenAI) ────────────────────────
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

// ── xAI Grok ────────────────────────────────────────────────────────────────
// Different beast from Groq (the Llama host) — this is xAI's own frontier
// model. Reasoning variant: reasoning tokens aren't visible in the response
// but eat the max_tokens budget, so we give it more headroom.
async function callGrok(apiKey, prompt, { timeoutMs } = {}) {
  const body = {
    model: 'grok-4-1-fast-reasoning',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 8000,
    response_format: { type: 'json_object' },
    // Reasoning models on xAI don't accept `temperature` — omit it.
  };
  const data = await fetchWithTimeout('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  }, timeoutMs);
  const text = data?.choices?.[0]?.message?.content;
  const finishReason = data?.choices?.[0]?.finish_reason;
  if (!text) throw new Error(`grok: empty response (finish_reason: ${finishReason || 'unknown'})`);
  return text;
}

async function callOpenAI(apiKey, prompt, { timeoutMs } = {}) {
  // GPT-5 series requires max_completion_tokens (not max_tokens) and does not
  // accept arbitrary temperature values — omit temperature to use the default.
  const body = {
    model: 'gpt-5.5',
    messages: [{ role: 'user', content: prompt }],
    max_completion_tokens: 2000,
    response_format: { type: 'json_object' },
  };
  const data = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  }, timeoutMs);

  const text = data?.choices?.[0]?.message?.content;
  const finishReason = data?.choices?.[0]?.finish_reason;
  if (!text) throw new Error(`openai: empty response (finish_reason: ${finishReason || 'unknown'})`);
  return text;
}

// ── Anthropic / Claude ───────────────────────────────────────────────────────
// Opus 4.7 removes temperature entirely (400 error if set) and uses a new
// tokenizer (~1–1.35x more tokens per text). Adaptive thinking is off by
// default — we enable it to get the model's best reasoning for this task.
// Thinking blocks are omitted from response by default, so we just get the
// final text content.
async function callClaude(apiKey, prompt, { timeoutMs } = {}) {
  const body = {
    model: 'claude-opus-4-8',
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    messages: [{ role: 'user', content: prompt }],
  };
  const data = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  }, timeoutMs);

  const blocks = Array.isArray(data?.content) ? data.content : [];
  const text = blocks.filter(b => b?.type === 'text').map(b => b.text).join('\n').trim();
  const stop = data?.stop_reason;
  if (!text) throw new Error(`claude: empty response (stop_reason: ${stop || 'unknown'})`);
  return text;
}

export const providers = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    model: 'gemini-3.1-pro-preview',
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
    id: 'grok',
    name: 'xAI Grok',
    model: 'grok-4-1-fast-reasoning',
    envKey: 'XAI_API_KEY',
    call: callGrok,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    model: 'gpt-5.5',
    envKey: 'OPENAI_API_KEY',
    call: callOpenAI,
  },
  {
    id: 'claude',
    name: 'Anthropic Claude',
    model: 'claude-opus-4-8',
    envKey: 'CLAUDE_API_KEY',
    call: callClaude,
  },
];
