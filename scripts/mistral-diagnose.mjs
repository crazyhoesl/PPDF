// Temporary: does the org's per-model limit table key on the exact model name?
// The Limits page lists `mistral-medium-latest` (20k TPM / 1.00 RPS) but not
// `mistral-medium-2604`, which is what we actually call.
const key = process.env.MISTRAL_API_KEY;
if (!key) { console.log('MISTRAL_API_KEY not set'); process.exit(0); }

for (const model of ['mistral-medium-2604', 'mistral-medium-latest', 'mistral-small-2603', 'mistral-large-2512']) {
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }),
  });
  const body = await res.text();
  const rl = [...res.headers].filter(([k]) => /ratelimit|retry/i.test(k)).map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(`\n${model.padEnd(22)} HTTP ${res.status}`);
  console.log(`   ${rl || '(keine ratelimit-header)'}`);
  console.log(`   ${body.slice(0, 220)}`);
}
