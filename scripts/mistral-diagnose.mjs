// Temporary diagnostic: why does Mistral return HTTP 429 on a once-a-day call?
// Prints status + rate-limit headers for /v1/models and a minimal completion.
// Never prints the key itself.
const key = process.env.MISTRAL_API_KEY;
if (!key) { console.log('MISTRAL_API_KEY not set'); process.exit(0); }
console.log(`key present: length=${key.length}, prefix=${key.slice(0, 4)}…`);

function dumpHeaders(res) {
  for (const [k, v] of res.headers) {
    if (/ratelimit|retry|x-kong|date/i.test(k)) console.log(`   ${k}: ${v}`);
  }
}

async function probe(label, url, init) {
  const res = await fetch(url, init);
  const body = await res.text();
  console.log(`\n== ${label} → HTTP ${res.status}`);
  dumpHeaders(res);
  console.log(`   body: ${body.slice(0, 600)}`);
  return { res, body };
}

const auth = { Authorization: `Bearer ${key}` };

const models = await probe('GET /v1/models', 'https://api.mistral.ai/v1/models', { headers: auth });
if (models.res.ok) {
  try {
    const ids = JSON.parse(models.body).data.map(m => m.id);
    console.log(`   -> ${ids.length} models; mistral-medium-2604 present: ${ids.includes('mistral-medium-2604')}`);
    console.log(`   -> medium/large ids: ${ids.filter(i => /medium|large/.test(i)).join(', ')}`);
  } catch { /* body already printed */ }
}

await probe('POST /v1/chat/completions (mistral-medium-2604)', 'https://api.mistral.ai/v1/chat/completions', {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'mistral-medium-2604', messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }),
});

await probe('POST /v1/chat/completions (mistral-small-latest)', 'https://api.mistral.ai/v1/chat/completions', {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'mistral-small-latest', messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }),
});
