#!/usr/bin/env node
// PPDF — Prochain Président de la France
// Polls multiple AI APIs with the same prompt and records their answers.

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeCandidate, scanProseForCandidate, looksLikeNoOpinion } from './candidates.mjs';
import { providers } from './providers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'docs', 'data');
const HISTORY_DIR = path.join(DATA_DIR, 'history');

const PROMPT = `Task: Pick the single most likely winner of the 2027 French presidential election.

Commit to ONE name.

Ground rules:
- Give ONE name, even if confidence is low. A low-confidence guess is the right answer when you're uncertain — not a refusal.
- "Unknown" is ONLY acceptable if you literally have no knowledge of French politics (virtually never true for a modern LLM). Do not use it as an escape hatch.
- Do not add disclaimers, warnings, or prose outside the JSON.

Respond with valid JSON only:
{"candidate": "Full Name", "confidence": "low" | "medium" | "high", "reasoning": "one concise sentence citing one concrete factor"}`;

/** Try to pull a JSON object out of a model response. */
function extractJson(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  // Direct parse
  try { return JSON.parse(trimmed); } catch {}
  // Fenced code block
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch {}
  }
  // First balanced {...} block (non-greedy search for last closing brace
  // that still gives valid JSON)
  const firstBrace = trimmed.indexOf('{');
  if (firstBrace !== -1) {
    for (let end = trimmed.length; end > firstBrace; end--) {
      if (trimmed[end - 1] !== '}') continue;
      const candidate = trimmed.slice(firstBrace, end);
      try { return JSON.parse(candidate); } catch {}
    }
  }
  return null;
}

/**
 * Stage the raw model text through three extractors:
 *   1. Parse as JSON (happy path)
 *   2. If no JSON but prose contains a known name → use that
 *   3. If no name but prose says "unknown / can't predict" → no_opinion
 * Returns { candidate, candidate_id, confidence, reasoning, source }
 */
function interpret(rawText) {
  const parsed = extractJson(rawText);

  if (parsed && typeof parsed === 'object') {
    // Flatten candidate field in case the model returned an object or array
    let raw = parsed.candidate;
    if (Array.isArray(raw)) raw = raw[0];
    if (raw && typeof raw === 'object') raw = raw.name || raw.value || JSON.stringify(raw);
    raw = (raw == null ? '' : String(raw)).trim();

    const norm = normalizeCandidate(raw);
    let confidence = null;
    if (parsed.confidence != null) {
      const c = String(parsed.confidence).toLowerCase().trim();
      if (['low', 'medium', 'high'].includes(c)) confidence = c;
    }
    const reasoning = String(parsed.reasoning ?? '').slice(0, 600).trim();

    return {
      candidate: norm.id === 'no_opinion' ? 'No opinion' : (raw || norm.name),
      candidate_id: norm.id,
      confidence: confidence ?? (norm.id === 'no_opinion' ? 'low' : null),
      reasoning,
      source: 'json',
      match_confidence: norm.confidence,
    };
  }

  // JSON failed. Try prose extraction.
  const prose = scanProseForCandidate(rawText);
  if (prose) {
    // If the raw text looks like truncated JSON (starts with '{'), don't
    // dump the broken JSON into the reasoning field — leave a note instead.
    const rawTrim = String(rawText || '').trim();
    const looksTruncatedJson = rawTrim.startsWith('{') && !rawTrim.endsWith('}');
    const reasoning = looksTruncatedJson
      ? '(response was truncated — name extracted from raw text)'
      : rawTrim.slice(0, 400);
    return {
      candidate: prose.name,
      candidate_id: prose.id,
      confidence: prose.id === 'no_opinion' ? 'low' : null,
      reasoning,
      source: 'prose',
      match_confidence: prose.confidence,
    };
  }

  // Last resort: is it a generic "I don't know" response?
  if (looksLikeNoOpinion(rawText)) {
    return {
      candidate: 'No opinion',
      candidate_id: 'no_opinion',
      confidence: 'low',
      reasoning: String(rawText || '').slice(0, 400).trim(),
      source: 'no_opinion_marker',
      match_confidence: 'exact',
    };
  }

  return null; // hard failure — caller marks as error
}

async function runProvider(provider) {
  const started = Date.now();
  const result = {
    provider: provider.id,
    name: provider.name,
    model: provider.model,
    timestamp: new Date().toISOString(),
    durationMs: 0,
    ok: false,
    raw: null,
    candidate: null,
    candidate_id: null,
    confidence: null,
    reasoning: null,
    source: null,              // "json" | "prose" | "no_opinion_marker"
    match_confidence: null,    // "exact" | "substring" | "none"
    error: null,
  };

  try {
    const envKey = provider.envKey;
    const apiKey = process.env[envKey];
    if (!apiKey) {
      result.error = `missing env ${envKey}`;
      result.durationMs = Date.now() - started;
      return result;
    }

    // 30-second hard timeout per provider, with one retry on network/5xx/429
    let text = null;
    let lastErr = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        text = await provider.call(apiKey, PROMPT, { timeoutMs: 30_000 });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const msg = String(err?.message ?? '');
        const retriable = /HTTP 5\d\d|HTTP 429|ETIMEDOUT|ECONNRESET|fetch failed|abort|timeout/i.test(msg);
        if (attempt === 1 && retriable) {
          // Small backoff — 2s for 429 (more aggressive spacing), 1.5s otherwise
          const delay = /429/.test(msg) ? 2500 : 1500;
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
    if (lastErr) throw lastErr;

    result.raw = typeof text === 'string' ? text.slice(0, 4000) : JSON.stringify(text).slice(0, 4000);

    const interpreted = interpret(text);
    if (!interpreted) {
      result.error = 'could not extract answer from response';
      result.durationMs = Date.now() - started;
      return result;
    }

    result.candidate = interpreted.candidate;
    result.candidate_id = interpreted.candidate_id;
    result.confidence = interpreted.confidence;
    result.reasoning = interpreted.reasoning;
    result.source = interpreted.source;
    result.match_confidence = interpreted.match_confidence;
    result.ok = true;
  } catch (err) {
    result.error = String(err?.message ?? err).slice(0, 400);
  }

  result.durationMs = Date.now() - started;
  return result;
}

async function main() {
  if (!existsSync(HISTORY_DIR)) await mkdir(HISTORY_DIR, { recursive: true });

  console.log(`PPDF poll @ ${new Date().toISOString()}`);
  console.log(`Providers configured: ${providers.map(p => p.id).join(', ')}\n`);

  const results = await Promise.all(providers.map(runProvider));
  for (const r of results) {
    const icon = r.ok
      ? (r.candidate_id === 'no_opinion' ? '○' : r.candidate_id === 'unknown' ? '?' : '✓')
      : '✗';
    const body = r.ok
      ? `${r.candidate}  [src:${r.source} match:${r.match_confidence}]`
      : r.error;
    console.log(`  ${icon} ${r.provider.padEnd(12)} → ${body}  (${r.durationMs}ms)`);
  }

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);

  const snapshot = {
    timestamp: now.toISOString(),
    date: dateStr,
    prompt: PROMPT,
    results,
  };

  await writeFile(
    path.join(DATA_DIR, 'latest.json'),
    JSON.stringify(snapshot, null, 2) + '\n',
    'utf8'
  );

  const historyFile = path.join(HISTORY_DIR, `${dateStr}.json`);
  let dayEntries = [];
  if (existsSync(historyFile)) {
    try {
      dayEntries = JSON.parse(await readFile(historyFile, 'utf8'));
      if (!Array.isArray(dayEntries)) dayEntries = [dayEntries];
    } catch {}
  }
  dayEntries.push(snapshot);
  await writeFile(historyFile, JSON.stringify(dayEntries, null, 2) + '\n', 'utf8');

  const indexFile = path.join(DATA_DIR, 'history-index.json');
  let index = [];
  if (existsSync(indexFile)) {
    try { index = JSON.parse(await readFile(indexFile, 'utf8')); } catch {}
  }
  if (!index.includes(dateStr)) {
    index.push(dateStr);
    index.sort();
  }
  await writeFile(indexFile, JSON.stringify(index, null, 2) + '\n', 'utf8');

  console.log(`\nWritten: docs/data/latest.json, docs/data/history/${dateStr}.json, docs/data/history-index.json`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
