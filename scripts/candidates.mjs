// Maps fuzzy/abbreviated candidate names to canonical IDs.
// Semantics:
//   id "no_opinion"  → the model explicitly said "unknown / cannot predict / too uncertain"
//   id "unknown"     → couldn't map the name to any known candidate (but the model did name someone)
//   any other id     → a recognized French political figure

export const candidates = [
  { id: 'bardella',   name: 'Jordan Bardella',     party: 'RN',          color: '#0d3b72' },
  { id: 'lepen',      name: 'Marine Le Pen',       party: 'RN',          color: '#13477a' },
  { id: 'philippe',   name: 'Édouard Philippe',    party: 'Horizons',    color: '#1e88e5' },
  { id: 'attal',      name: 'Gabriel Attal',       party: 'Renaissance', color: '#8b5cf6' },
  { id: 'darmanin',   name: 'Gérald Darmanin',     party: 'Renaissance', color: '#a78bfa' },
  { id: 'lecornu',    name: 'Sébastien Lecornu',   party: 'Renaissance', color: '#b794f4' },
  { id: 'retailleau', name: 'Bruno Retailleau',    party: 'LR',          color: '#0ea5e9' },
  { id: 'wauquiez',   name: 'Laurent Wauquiez',    party: 'LR',          color: '#38bdf8' },
  { id: 'melenchon',  name: 'Jean-Luc Mélenchon',  party: 'LFI',         color: '#dc2626' },
  { id: 'glucksmann', name: 'Raphaël Glucksmann',  party: 'PP/PS',       color: '#f472b6' },
  { id: 'faure',      name: 'Olivier Faure',       party: 'PS',          color: '#ec4899' },
  { id: 'ruffin',     name: 'François Ruffin',     party: 'Debout!',     color: '#f59e0b' },
  { id: 'tondelier',  name: 'Marine Tondelier',    party: 'EÉLV',        color: '#16a34a' },
  { id: 'zemmour',    name: 'Éric Zemmour',        party: 'Reconquête',  color: '#4b5563' },
  { id: 'marechal',   name: 'Marion Maréchal',     party: 'IDL',         color: '#6b7280' },
  { id: 'macron',     name: 'Emmanuel Macron',     party: 'Renaissance', color: '#7c3aed' },
  { id: 'no_opinion', name: 'No opinion',          party: '—',           color: '#52525b' },
  { id: 'unknown',    name: 'Unrecognized',        party: '—',           color: '#64748b' },
];

// Alias table. The match function handles ambiguity by sorting all keys by
// length (longest first) so that specific matches beat substring matches.
//
// IMPORTANT: Marion Maréchal was formerly "Marion Maréchal-Le Pen" — her
// surname contains "Le Pen". The length-based tiebreak + declaration order
// ensures she matches correctly before falling through to Marine Le Pen.
const aliases = [
  [['jordan bardella', 'bardella', 'j bardella', 'jbardella'], 'bardella'],
  [['marion marechal le pen', 'marion marechal-le pen', 'marion marechal', 'marechal-le pen', 'marechal'], 'marechal'],
  [['marine le pen', 'marine lepen', 'lepen', 'le pen', 'mlp'], 'lepen'],
  [['edouard philippe', 'e philippe', 'philippe'], 'philippe'],
  [['gabriel attal', 'g attal', 'attal'], 'attal'],
  [['gerald darmanin', 'darmanin'], 'darmanin'],
  [['sebastien lecornu', 'lecornu'], 'lecornu'],
  [['bruno retailleau', 'retailleau'], 'retailleau'],
  [['laurent wauquiez', 'wauquiez'], 'wauquiez'],
  [['jean-luc melenchon', 'jean luc melenchon', 'melenchon', 'jlm'], 'melenchon'],
  [['raphael glucksmann', 'glucksmann'], 'glucksmann'],
  [['olivier faure', 'o faure', 'faure'], 'faure'],
  [['francois ruffin', 'f ruffin', 'ruffin'], 'ruffin'],
  [['marine tondelier', 'tondelier'], 'tondelier'],
  [['eric zemmour', 'zemmour'], 'zemmour'],
  [['emmanuel macron', 'macron'], 'macron'],
];

// Phrases that mean "the model is declining / says it doesn't know".
// Matched against the raw response with word-boundary awareness.
const NO_OPINION_MARKERS = [
  // English
  'unknown', 'i cannot predict', 'cannot predict', "can't predict",
  'i do not know', "i don't know", 'no strong opinion', 'no opinion',
  'too uncertain', 'too speculative', 'impossible to say', 'impossible to predict',
  'cannot determine', "can't determine", 'not possible to determine',
  'unable to answer', 'unable to predict', 'cannot say', "can't say",
  'insufficient information', 'insufficient data',
  'n/a', 'not applicable', 'uncertain',
  // French
  'inconnu', 'incertain', 'je ne sais pas', 'impossible de dire',
  'impossible de predire', 'trop incertain',
  'aucune opinion', "pas d'opinion", 'pas d opinion',
  // German
  'unbekannt', 'ich weiss es nicht', 'ich weiß es nicht', 'keine meinung', 'zu unsicher',
  // Italian
  'sconosciuto', 'non lo so', 'impossibile dire', 'troppo incerto',
  // Spanish
  'desconocido', 'no lo se', 'imposible predecir', 'demasiado incierto',
];

export function stripDiacritics(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeText(s) {
  return stripDiacritics(String(s).toLowerCase())
    .replace(/[^a-z0-9\s-']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Pre-build a search table sorted by key length (longest first) so that
// specific phrases beat short substrings.
const searchTable = (() => {
  const rows = [];
  for (const [keys, id] of aliases) {
    for (const k of keys) rows.push({ key: normalizeText(k), id });
  }
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const sig = `${r.key}|${r.id}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(r);
  }
  out.sort((a, b) => b.key.length - a.key.length);
  return out;
})();

/** Does the text explicitly read like an "I don't know" answer? */
export function looksLikeNoOpinion(text) {
  if (!text) return false;
  const needle = normalizeText(text);
  if (!needle) return false;

  // Literal markers first
  for (const marker of NO_OPINION_MARKERS) {
    const m = normalizeText(marker);
    const re = new RegExp(`(^|\\s)${escapeRegex(m)}($|\\s|[.,;!?])`);
    if (re.test(needle)) return true;
  }

  // Flexible bi-gram: "decline verb" + optional adverb + "answer verb".
  // Catches phrasings like "cannot reliably predict", "unable to accurately say".
  const declineVerbs = '(?:cannot|can ?not|can\'?t|unable to|impossible to|not (?:able|possible) to|not going to)';
  const answerVerbs  = '(?:predict|say|determine|tell|know|pick|choose|answer|forecast|estimate|name)';
  const flexible = new RegExp(`\\b${declineVerbs}\\s+(?:\\w+\\s+){0,3}${answerVerbs}\\b`);
  if (flexible.test(needle)) return true;

  return false;
}

/**
 * Normalize a raw candidate string to a canonical id.
 * Returns { id, name, matched, confidence }
 */
export function normalizeCandidate(rawName) {
  if (!rawName) return { id: 'no_opinion', name: 'No opinion', matched: false, confidence: 'none' };

  if (looksLikeNoOpinion(rawName)) {
    return { id: 'no_opinion', name: 'No opinion', matched: true, confidence: 'exact' };
  }

  const needle = normalizeText(rawName);
  if (!needle) return { id: 'unknown', name: rawName, matched: false, confidence: 'none' };

  // Pass 1: exact equality
  for (const row of searchTable) {
    if (needle === row.key) {
      const c = candidates.find(c => c.id === row.id);
      return { id: row.id, name: c?.name ?? rawName, matched: true, confidence: 'exact' };
    }
  }

  // Pass 2: substring — longest keys win (table is pre-sorted)
  for (const row of searchTable) {
    if (needle.includes(row.key)) {
      const c = candidates.find(c => c.id === row.id);
      return { id: row.id, name: c?.name ?? rawName, matched: true, confidence: 'substring' };
    }
  }

  return { id: 'unknown', name: rawName, matched: false, confidence: 'none' };
}

/**
 * Fallback: scan free-form prose for any known candidate name, using
 * word-boundary matches to avoid false positives inside other words.
 * Returns a normalized result or null.
 */
export function scanProseForCandidate(text) {
  if (!text) return null;
  const needle = normalizeText(text);
  if (!needle) return null;

  // If the prose explicitly says "I don't know", classify as no_opinion
  // BEFORE looking for names — the model might mention a name as an example
  // while still declining ("I cannot say, but some think Bardella...").
  if (looksLikeNoOpinion(text)) {
    return { id: 'no_opinion', name: 'No opinion', matched: true, confidence: 'exact' };
  }

  for (const row of searchTable) {
    const re = new RegExp(`(^|\\s)${escapeRegex(row.key)}(\\s|[.,;!?'-]|$)`);
    if (re.test(needle)) {
      const c = candidates.find(c => c.id === row.id);
      return { id: row.id, name: c?.name ?? row.key, matched: true, confidence: 'substring' };
    }
  }
  return null;
}
