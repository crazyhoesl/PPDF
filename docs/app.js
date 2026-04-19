/* ─── PPDF frontend ────────────────────────────────────────────────
 * Loads data/latest.json + data/history/*.json and renders:
 *  - Countdown to the 2nd round (25 April 2027)
 *  - Latest answers from each AI provider
 *  - Timeline of predictions (per provider)
 *  - Overall tally across all runs
 * ──────────────────────────────────────────────────────────────── */

const TARGET = new Date('2027-04-25T18:00:00Z'); // 20:00 Paris CEST

const CANDIDATES = {
  bardella:   { name: 'Jordan Bardella',     party: 'RN',          color: '#0d3b72', wiki: 'Jordan_Bardella' },
  lepen:      { name: 'Marine Le Pen',       party: 'RN',          color: '#13477a', wiki: 'Marine_Le_Pen' },
  philippe:   { name: 'Édouard Philippe',    party: 'Horizons',    color: '#1e88e5', wiki: '%C3%89douard_Philippe' },
  attal:      { name: 'Gabriel Attal',       party: 'Renaissance', color: '#8b5cf6', wiki: 'Gabriel_Attal' },
  darmanin:   { name: 'Gérald Darmanin',     party: 'Renaissance', color: '#a78bfa', wiki: 'G%C3%A9rald_Darmanin' },
  lecornu:    { name: 'Sébastien Lecornu',   party: 'Renaissance', color: '#b794f4', wiki: 'S%C3%A9bastien_Lecornu' },
  retailleau: { name: 'Bruno Retailleau',    party: 'LR',          color: '#0ea5e9', wiki: 'Bruno_Retailleau' },
  wauquiez:   { name: 'Laurent Wauquiez',    party: 'LR',          color: '#38bdf8', wiki: 'Laurent_Wauquiez' },
  melenchon:  { name: 'Jean-Luc Mélenchon',  party: 'LFI',         color: '#dc2626', wiki: 'Jean-Luc_M%C3%A9lenchon' },
  glucksmann: { name: 'Raphaël Glucksmann',  party: 'PP/PS',       color: '#f472b6', wiki: 'Rapha%C3%ABl_Glucksmann' },
  faure:      { name: 'Olivier Faure',       party: 'PS',          color: '#ec4899', wiki: 'Olivier_Faure' },
  ruffin:     { name: 'François Ruffin',     party: 'Debout!',     color: '#f59e0b', wiki: 'Fran%C3%A7ois_Ruffin' },
  tondelier:  { name: 'Marine Tondelier',    party: 'EÉLV',        color: '#16a34a', wiki: 'Marine_Tondelier' },
  zemmour:    { name: 'Éric Zemmour',        party: 'Reconquête',  color: '#4b5563', wiki: '%C3%89ric_Zemmour' },
  marechal:   { name: 'Marion Maréchal',     party: 'IDL',         color: '#6b7280', wiki: 'Marion_Mar%C3%A9chal' },
  macron:     { name: 'Emmanuel Macron',     party: 'Renaissance', color: '#7c3aed', wiki: 'Emmanuel_Macron' },
  no_opinion: { name: 'No opinion',          party: '—',           color: '#52525b' },
  unknown:    { name: 'Unrecognized',        party: '—',           color: '#64748b' },
};

function candidateInfo(id) { return CANDIDATES[id] || CANDIDATES.unknown; }
function isRealCandidate(id) { return id && id !== 'no_opinion' && id !== 'unknown'; }

// Provider IDs we want displayed. Historical snapshots may contain retired
// providers (openrouter, cerebras); those are filtered out of every UI view.
const ACTIVE_PROVIDERS = ['gemini', 'mistral', 'groq', 'grok', 'openai', 'claude'];
function isActiveProvider(id) { return ACTIVE_PROVIDERS.includes(id); }
/** Returns the subset of results in a snapshot that come from active providers. */
function activeResults(snapshot) {
  return (snapshot?.results || []).filter(r => isActiveProvider(r.provider));
}

// ── Wikipedia image fetching with in-memory + localStorage cache ─────
const imageCache = {};
function getCandidateImage(wikiSlug) {
  if (!wikiSlug) return Promise.resolve(null);
  if (imageCache[wikiSlug]) return imageCache[wikiSlug];

  // Check localStorage cache (persists for 7 days)
  const cacheKey = `ppdf-img-${wikiSlug}`;
  try {
    const stored = localStorage.getItem(cacheKey);
    if (stored) {
      const { url, t } = JSON.parse(stored);
      if (Date.now() - t < 7 * 86400_000) {
        imageCache[wikiSlug] = Promise.resolve(url);
        return imageCache[wikiSlug];
      }
    }
  } catch {}

  imageCache[wikiSlug] = (async () => {
    try {
      const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${wikiSlug}&prop=pageimages&format=json&pithumbsize=200&origin=*`;
      const res = await fetch(apiUrl);
      if (!res.ok) return null;
      const data = await res.json();
      const pages = data?.query?.pages;
      if (!pages) return null;
      const firstPage = Object.values(pages)[0];
      const url = firstPage?.thumbnail?.source || null;
      try { localStorage.setItem(cacheKey, JSON.stringify({ url, t: Date.now() })); } catch {}
      return url;
    } catch {
      return null;
    }
  })();
  return imageCache[wikiSlug];
}

/** Apply image to an element once the fetch resolves. */
function attachCandidateImage(el, cand, dotStyle) {
  if (!el || !cand?.wiki) return;
  getCandidateImage(cand.wiki).then(url => {
    if (!url) return;
    // Replace the element's innerHTML with an img element
    el.innerHTML = `<img src="${url}" alt="${cand.name}" loading="lazy" class="candidate-img-inner">`;
    el.classList.add('has-image');
  });
}

// ── State ────────────────────────────────────────────────────────────
let currentLang = window.PPDF_DETECT_LANG();
let latestData = null;
let historyIndex = [];
let allSnapshots = [];

// ── i18n ─────────────────────────────────────────────────────────────
function t(key) {
  return window.PPDF_I18N[currentLang]?.[key] ?? window.PPDF_I18N.fr[key] ?? key;
}

function applyLang() {
  document.documentElement.lang = currentLang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.getAttribute('data-i18n');
    const v = t(k);
    if (v.includes('<')) el.innerHTML = v; else el.textContent = v;
  });
  document.title = 'PPDF — ' + t('brand_sub');
  renderLangSwitch();
  lastNextPollMinute = -1; // force re-render on next tick with new locale
  renderNextPoll();
  if (latestData) { renderConsensus(latestData); renderLatest(latestData); }
  if (allSnapshots.length) { renderConsensusChart(); renderTimeline(); renderTally(); }
}

function renderLangSwitch() {
  const nav = document.getElementById('langSwitch');
  nav.innerHTML = '';
  for (const { code, label } of window.PPDF_LANGS) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.className = code === currentLang ? 'active' : '';
    btn.addEventListener('click', () => {
      currentLang = code;
      localStorage.setItem('ppdf-lang', code);
      applyLang();
    });
    nav.appendChild(btn);
  }
}

// ── Countdown ────────────────────────────────────────────────────────
function tickCountdown() {
  const diff = TARGET.getTime() - Date.now();
  const el = {
    d: document.getElementById('cdDays'),
    h: document.getElementById('cdHours'),
    m: document.getElementById('cdMinutes'),
    s: document.getElementById('cdSeconds'),
  };
  if (diff <= 0) {
    el.d.textContent = el.h.textContent = el.m.textContent = el.s.textContent = '0';
    return;
  }
  const days  = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins  = Math.floor((diff % 3600000) / 60000);
  const secs  = Math.floor((diff % 60000) / 1000);
  el.d.textContent = String(days);
  el.h.textContent = String(hours).padStart(2, '0');
  el.m.textContent = String(mins).padStart(2, '0');
  el.s.textContent = String(secs).padStart(2, '0');

  // Refresh the "next poll" line only when the minute rolls over — no need
  // to re-render a text that changes once per 60s at 1Hz.
  const nowMin = Math.floor(Date.now() / 60000);
  if (nowMin !== lastNextPollMinute) {
    lastNextPollMinute = nowMin;
    renderNextPoll();
  }
}

// ── Next poll indicator ──────────────────────────────────────────────
// Daily cron is `0 7 * * *` — 07:00 UTC. We compute the next occurrence,
// render it in the user's locale, and show a relative "in Xh Ymin" too.
let lastNextPollMinute = -1;

function computeNextRun() {
  const now = new Date();
  const next = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 7, 0, 0, 0
  ));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function formatRelative(ms) {
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 1)  return t('np_soon');
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hours}h ${rem}min` : `${hours}h`;
}

function renderNextPoll() {
  const el = document.getElementById('nextPoll');
  if (!el) return;
  const nextRun = computeNextRun();
  const now = new Date();
  const diffMs = nextRun.getTime() - now.getTime();

  // "today" vs "tomorrow" based on the *user's* local calendar
  const sameDay = nextRun.getFullYear() === now.getFullYear()
               && nextRun.getMonth() === now.getMonth()
               && nextRun.getDate() === now.getDate();
  const whenLabel = sameDay ? t('np_today') : t('np_tomorrow');

  const timeFmt = new Intl.DateTimeFormat(currentLang, { hour: '2-digit', minute: '2-digit' });
  const timeStr = timeFmt.format(nextRun);
  const relStr = formatRelative(diffMs);

  el.innerHTML = `
    <span class="np-label">${escapeHtml(t('np_label'))}</span>
    <span class="np-sep">·</span>
    <span class="np-when">${escapeHtml(whenLabel)} ${escapeHtml(timeStr)}</span>
    <span class="np-sep">·</span>
    <span class="np-relative">${escapeHtml(t('np_in'))} ${escapeHtml(relStr)}</span>
  `;
}

// ── Data loading ─────────────────────────────────────────────────────
async function loadJson(url) {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function loadData() {
  latestData = await loadJson('./data/latest.json');
  historyIndex = (await loadJson('./data/history-index.json')) || [];

  const days = await Promise.all(
    historyIndex.map(date => loadJson(`./data/history/${date}.json`))
  );
  allSnapshots = [];
  for (const day of days) {
    if (!day) continue;
    const entries = Array.isArray(day) ? day : [day];
    for (const snap of entries) allSnapshots.push(snap);
  }
  if (latestData && latestData.results?.length && !allSnapshots.some(s => s.timestamp === latestData.timestamp)) {
    allSnapshots.push(latestData);
  }
  allSnapshots.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
}

// ── Consensus (the "headline answer") ────────────────────────────────
function computeConsensus(snapshot) {
  if (!snapshot?.results?.length) return null;
  const okResults = activeResults(snapshot).filter(r => r.ok);
  if (!okResults.length) return null;

  const counts = {};
  for (const r of okResults) {
    const id = r.candidate_id || 'unknown';
    counts[id] = (counts[id] || 0) + 1;
  }

  // Prefer real candidate answers. "No opinion" should only win the consensus
  // if every successful model explicitly declined — otherwise the consensus
  // should reflect whoever the answering models picked.
  const realEntries = Object.entries(counts).filter(([id]) => id !== 'no_opinion');

  if (realEntries.length > 0) {
    realEntries.sort((a, b) => b[1] - a[1]);
    const [, topCount] = realEntries[0];
    const tiedIds = realEntries.filter(([, c]) => c === topCount).map(([id]) => id);
    return { count: topCount, total: okResults.length, ids: tiedIds };
  }

  // Fallback: every model said "I don't know"
  return {
    count: counts['no_opinion'] || 0,
    total: okResults.length,
    ids: ['no_opinion'],
  };
}

function renderConsensus(snapshot) {
  const el = document.getElementById('consensus');
  if (!el) return;
  const consensus = computeConsensus(snapshot);

  if (!consensus) {
    el.innerHTML = `<div class="consensus-waiting">${t('consensus_waiting')}</div>`;
    return;
  }

  const countText = t('consensus_count')
    .replace('{c}', String(consensus.count))
    .replace('{t}', String(consensus.total));

  // If the top vote is "no_opinion", flag that explicitly
  if (consensus.ids.length === 1 && consensus.ids[0] === 'no_opinion') {
    el.innerHTML = `
      <div class="consensus-label">${t('consensus_today')}</div>
      <div class="consensus-name consensus-no-opinion">${escapeHtml(t('consensus_no_opinion'))}</div>
      <div class="consensus-meta">${escapeHtml(t('consensus_no_opinion_meta'))} · ${escapeHtml(countText)}</div>
    `;
    return;
  }

  // Single winner
  if (consensus.ids.length === 1) {
    const cand = candidateInfo(consensus.ids[0]);
    const partyPrefix = cand.party !== '—' ? `${escapeHtml(cand.party)} · ` : '';
    el.innerHTML = `
      <div class="consensus-label">${t('consensus_today')}</div>
      <div class="consensus-name" style="--cand-color: ${cand.color}">
        <span class="candidate-avatar candidate-avatar-lg" id="consensusAvatar" style="background: ${cand.color}; border-color: ${cand.color}"></span>${escapeHtml(cand.name)}
      </div>
      <div class="consensus-meta">${partyPrefix}${escapeHtml(countText)}</div>
    `;
    attachCandidateImage(document.getElementById('consensusAvatar'), cand);
    return;
  }

  // Tie — render each tied candidate
  const items = consensus.ids.map((id, i) => {
    const cand = candidateInfo(id);
    return `<div class="consensus-tied-item" style="color: ${cand.color}">
      <span class="candidate-avatar candidate-avatar-md" id="consensusTieAvatar${i}" style="background: ${cand.color}; border-color: ${cand.color}"></span>${escapeHtml(cand.name)}
    </div>`;
  }).join('');
  el.innerHTML = `
    <div class="consensus-label">${t('consensus_tied')}</div>
    <div class="consensus-tied">${items}</div>
    <div class="consensus-meta">${escapeHtml(countText)}</div>
  `;
  consensus.ids.forEach((id, i) => {
    attachCandidateImage(document.getElementById(`consensusTieAvatar${i}`), candidateInfo(id));
  });
}

// ── Latest grid ──────────────────────────────────────────────────────
function renderLatest(snapshot) {
  const grid = document.getElementById('latestGrid');
  const meta = document.getElementById('latestMeta');

  if (!snapshot || !snapshot.results?.length) {
    grid.innerHTML = `<div class="provider-card"><p class="meta">${t('latest_none')}</p></div>`;
    meta.textContent = '';
    return;
  }

  const dt = new Date(snapshot.timestamp);
  const fmt = new Intl.DateTimeFormat(currentLang, { dateStyle: 'long', timeStyle: 'short' });
  meta.textContent = `${t('last_updated')}: ${fmt.format(dt)}`;

  grid.innerHTML = '';
  activeResults(snapshot).forEach((r, idx) => {
    const card = document.createElement('div');
    card.className = 'provider-card';

    const cand = candidateInfo(r.candidate_id || 'unknown');
    const isNoOpinion = r.candidate_id === 'no_opinion';
    const isUnknown = r.candidate_id === 'unknown';
    if (isNoOpinion) card.classList.add('card-no-opinion');
    else if (isUnknown) card.classList.add('card-unknown');

    const nameToShow = !r.ok ? t('no_answer')
                     : isNoOpinion ? t('no_opinion_label')
                     : (r.candidate || cand.name);

    const statusLabel = !r.ok ? 'ERR'
                      : isNoOpinion ? '○'
                      : isUnknown ? '?'
                      : 'OK';
    const statusClass = !r.ok ? 'error'
                      : isNoOpinion ? 'neutral'
                      : isUnknown ? 'neutral'
                      : 'ok';

    const confLabel = r.confidence ? t('conf_' + r.confidence) : '—';
    const showParty = r.ok && isRealCandidate(r.candidate_id);
    const avatarId = `cardAvatar-${idx}`;
    const avatarBg = isNoOpinion ? 'transparent' : cand.color;

    const avatarHtml = r.ok
      ? `<span class="candidate-avatar candidate-avatar-sm" id="${avatarId}" style="background: ${avatarBg}; border-color: ${cand.color}"></span>`
      : '';

    card.innerHTML = `
      <div class="provider-head">
        <div class="provider-meta">
          <div class="provider-name">${escapeHtml(r.name)}</div>
          <div class="provider-model">${escapeHtml(r.model || '')}</div>
        </div>
        <div class="provider-status ${statusClass}">${statusLabel}</div>
      </div>
      <div class="candidate-block">
        ${avatarHtml}
        <div class="candidate-text">
          <div class="candidate-name">${escapeHtml(nameToShow)}</div>
          ${showParty ? `<div class="candidate-party">${cand.party}</div>` : ''}
          ${isUnknown && r.ok ? `<div class="candidate-party">${t('unrecognized_note')}</div>` : ''}
        </div>
      </div>
      ${r.ok && !isNoOpinion
        ? `<div class="confidence ${r.confidence || ''}">${t('confidence')}: ${confLabel} <span class="dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span></div>`
        : ''}
      <div class="reasoning">
        ${r.ok ? escapeHtml(r.reasoning || (isNoOpinion ? t('no_opinion_reason') : '')) : `<span class="error-msg">${escapeHtml(r.error || '')}</span>`}
      </div>
    `;
    grid.appendChild(card);
    if (r.ok && !isNoOpinion && cand.wiki) {
      attachCandidateImage(document.getElementById(avatarId), cand);
    }
  });
}

// ── Consensus Chart (per-candidate share over time) ────────────────
// Builds a Polymarket-style multi-line chart from allSnapshots.
// For each day, computes the share of AIs predicting each candidate.
function renderConsensusChart() {
  const chartEl = document.getElementById('consensusChart');
  const legendEl = document.getElementById('consensusLegend');
  if (!chartEl || !legendEl) return;

  if (!allSnapshots.length) {
    chartEl.innerHTML = `<div class="chart-empty">${t('latest_none')}</div>`;
    legendEl.innerHTML = '';
    return;
  }

  // 1) Group snapshots by day, keeping only the latest run per day
  const byDay = {};
  for (const snap of allSnapshots) {
    const day = (snap.date || snap.timestamp?.slice(0, 10));
    if (!day) continue;
    if (!byDay[day] || snap.timestamp > byDay[day].timestamp) byDay[day] = snap;
  }
  const days = Object.keys(byDay).sort();
  if (!days.length) return;

  // 2) For each day, count candidate shares
  // series[candId] = [{date, share, count, total}]
  const series = {};
  const seenCandidates = new Set();
  for (const day of days) {
    const snap = byDay[day];
    const okResults = activeResults(snap).filter(r => r.ok);
    const total = okResults.length;
    const counts = {};
    for (const r of okResults) {
      const id = r.candidate_id || 'unknown';
      counts[id] = (counts[id] || 0) + 1;
    }
    // Build a point for every candidate that EVER appeared, not just today's —
    // so a candidate's line drops to 0 on days it didn't get any votes.
    for (const id of Object.keys(counts)) seenCandidates.add(id);
  }

  // Now fill out each candidate's full timeline
  for (const id of seenCandidates) {
    series[id] = days.map(day => {
      const snap = byDay[day];
      const ok = activeResults(snap).filter(r => r.ok);
      const total = ok.length;
      const count = ok.filter(r => (r.candidate_id || 'unknown') === id).length;
      return {
        date: day,
        t: new Date(day + 'T12:00:00Z').getTime(),
        share: total > 0 ? count / total : 0,
        count,
        total,
      };
    });
  }

  // 3) Rank candidates by most-recent share, then by total votes
  const lastDay = days[days.length - 1];
  const ranked = Array.from(seenCandidates)
    .map(id => {
      const lastPoint = series[id][series[id].length - 1];
      const total = series[id].reduce((sum, p) => sum + p.count, 0);
      return { id, lastShare: lastPoint?.share || 0, total };
    })
    // no_opinion & unknown always at the bottom
    .sort((a, b) => {
      const aLow = (a.id === 'no_opinion' || a.id === 'unknown') ? 1 : 0;
      const bLow = (b.id === 'no_opinion' || b.id === 'unknown') ? 1 : 0;
      if (aLow !== bLow) return aLow - bLow;
      if (b.lastShare !== a.lastShare) return b.lastShare - a.lastShare;
      return b.total - a.total;
    });

  // 4) Render SVG
  // For a single data point, we pad the x-axis so the single dot sits nicely.
  const W = 800, H = 320, PAD_L = 40, PAD_R = 20, PAD_T = 20, PAD_B = 40;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const firstT = new Date(days[0] + 'T12:00:00Z').getTime();
  const lastT = new Date(days[days.length - 1] + 'T12:00:00Z').getTime();
  const spanT = Math.max(1, lastT - firstT);
  // Single-point case: put the dot at 80% across so legend aligns cleanly
  const xScale = (t) => {
    if (days.length === 1) return PAD_L + innerW * 0.8;
    return PAD_L + ((t - firstT) / spanT) * innerW;
  };
  const yScale = (share) => PAD_T + innerH - share * innerH;

  // Build SVG parts
  const gridYValues = [0, 0.25, 0.5, 0.75, 1];
  const gridLines = gridYValues.map(v => {
    const y = yScale(v);
    return `
      <line x1="${PAD_L}" x2="${W - PAD_R}" y1="${y}" y2="${y}" class="chart-grid"/>
      <text x="${W - PAD_R + 4}" y="${y + 4}" class="chart-grid-label">${Math.round(v * 100)}%</text>`;
  }).join('');

  // X-axis ticks (up to 5)
  const tickCount = Math.min(5, days.length);
  const tickStep = Math.max(1, Math.floor(days.length / tickCount));
  const xTicks = [];
  for (let i = 0; i < days.length; i += tickStep) {
    const d = new Date(days[i] + 'T12:00:00Z');
    const label = new Intl.DateTimeFormat(currentLang, { day: 'numeric', month: 'short' }).format(d);
    const x = xScale(d.getTime());
    xTicks.push(`<text x="${x}" y="${H - 10}" class="chart-x-label">${escapeHtml(label)}</text>`);
  }
  // Always include last day
  if (days.length > 1) {
    const d = new Date(days[days.length - 1] + 'T12:00:00Z');
    const label = new Intl.DateTimeFormat(currentLang, { day: 'numeric', month: 'short' }).format(d);
    const x = xScale(d.getTime());
    xTicks.push(`<text x="${x}" y="${H - 10}" class="chart-x-label chart-x-label-last">${escapeHtml(label)}</text>`);
  }

  // Build lines, dots per data point, and invisible hover hit-areas
  const linePaths = [];
  const dotMarkers = [];
  // pointRegistry: a flat list of every data point for hit-testing
  //   [{ candId, x, y, share, t, count, total }]
  const pointRegistry = [];
  for (const { id } of ranked) {
    const cand = candidateInfo(id);
    const points = series[id];
    if (!points.length) continue;

    if (points.length > 1) {
      const pathD = points.map((p, i) => {
        const x = xScale(p.t), y = yScale(p.share);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      linePaths.push(`<path d="${pathD}" fill="none" stroke="${cand.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" class="chart-line" data-cand="${id}"/>`);
    }

    // Always draw a dot at every data point — invisible until hovered (reduces
    // visual noise with many candidates) but picks up hover events.
    points.forEach((p, i) => {
      const x = xScale(p.t), y = yScale(p.share);
      const isLast = i === points.length - 1;
      // Prominent dot only on last point; inner points are thin circles
      const radius = isLast ? 5 : 3.5;
      const cls = isLast ? 'chart-dot chart-dot-last' : 'chart-dot';
      dotMarkers.push(`<circle cx="${x}" cy="${y}" r="${radius}" fill="${cand.color}" stroke="var(--bg)" stroke-width="2" class="${cls}" data-cand="${id}" data-date="${p.date}"/>`);
      pointRegistry.push({ candId: id, x, y, share: p.share, t: p.t, count: p.count, total: p.total, date: p.date });
    });
  }

  const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Consensus chart">
    ${gridLines}
    ${xTicks.join('')}
    ${linePaths.join('')}
    ${dotMarkers.join('')}
    <rect x="${PAD_L}" y="${PAD_T}" width="${innerW}" height="${innerH}" fill="transparent" class="chart-hit-area"/>
  </svg>`;

  chartEl.innerHTML = svg;

  // 5) Legend — name, share%, trend arrow
  const legendRows = ranked.map(({ id }) => {
    const cand = candidateInfo(id);
    const points = series[id];
    const last = points[points.length - 1];
    const prev = points.length > 1 ? points[points.length - 2] : null;
    const shareNow = last ? last.share : 0;
    const sharePrev = prev ? prev.share : shareNow;
    const delta = shareNow - sharePrev;
    const arrow = delta > 0.001 ? '↗' : delta < -0.001 ? '↘' : '→';
    const arrowClass = delta > 0.001 ? 'up' : delta < -0.001 ? 'down' : 'flat';
    const displayName = id === 'no_opinion' ? t('no_opinion_label')
                     : id === 'unknown' ? t('unrecognized_label')
                     : cand.name;
    const avatarId = `legendAvatar-${id}`;
    const avatarBg = id === 'no_opinion' ? 'transparent' : cand.color;
    return `
      <div class="legend-row" data-cand="${id}">
        <div class="legend-left">
          <span class="legend-swatch" style="background: ${cand.color}"></span>
          <span class="candidate-avatar candidate-avatar-xs" id="${avatarId}" style="background: ${avatarBg}; border-color: ${cand.color}"></span>
          <span class="legend-name">${escapeHtml(displayName)}</span>
        </div>
        <div class="legend-right">
          <span class="legend-share">${Math.round(shareNow * 100)}%</span>
          <span class="legend-trend ${arrowClass}">${arrow} ${Math.abs(Math.round(delta * 100))}%</span>
        </div>
      </div>`;
  }).join('');
  legendEl.innerHTML = legendRows;

  // Fetch avatars for legend
  ranked.forEach(({ id }) => {
    if (isRealCandidate(id)) {
      attachCandidateImage(document.getElementById(`legendAvatar-${id}`), candidateInfo(id));
    }
  });

  // ── Interactivity ──────────────────────────────────────────────────
  const tooltipEl = document.getElementById('consensusTooltip');
  const svgEl = chartEl.querySelector('svg');
  const hitArea = chartEl.querySelector('.chart-hit-area');

  function dimExcept(candId) {
    chartEl.querySelectorAll('.chart-line, .chart-dot').forEach(el => {
      el.classList.toggle('dimmed', candId != null && el.dataset.cand !== candId);
      el.classList.toggle('highlighted', el.dataset.cand === candId);
    });
    legendEl.querySelectorAll('.legend-row').forEach(row => {
      row.classList.toggle('highlighted', candId != null && row.dataset.cand === candId);
    });
  }
  function clearDim() {
    chartEl.querySelectorAll('.chart-line, .chart-dot').forEach(el => {
      el.classList.remove('dimmed');
      el.classList.remove('highlighted');
    });
    legendEl.querySelectorAll('.legend-row').forEach(row => row.classList.remove('highlighted'));
  }

  function showTooltip(point, clientX, clientY) {
    const cand = candidateInfo(point.candId);
    const displayName = point.candId === 'no_opinion' ? t('no_opinion_label')
                     : point.candId === 'unknown' ? t('unrecognized_label')
                     : cand.name;
    const dateFmt = new Intl.DateTimeFormat(currentLang, { weekday: 'short', day: 'numeric', month: 'short' });
    const dateStr = dateFmt.format(new Date(point.date + 'T12:00:00Z'));
    const pct = Math.round(point.share * 100);
    const avatarBg = point.candId === 'no_opinion' ? 'transparent' : cand.color;
    const avatarTooltipId = `tooltipAvatar`;
    tooltipEl.innerHTML = `
      <div class="tooltip-row">
        <span class="candidate-avatar candidate-avatar-xs" id="${avatarTooltipId}" style="background: ${avatarBg}; border-color: ${cand.color}"></span>
        <span class="tooltip-name" style="color: ${cand.color}">${escapeHtml(displayName)}</span>
      </div>
      <div class="tooltip-row tooltip-stat">
        <span class="tooltip-pct">${pct}%</span>
        <span class="tooltip-count">(${point.count}/${point.total})</span>
      </div>
      <div class="tooltip-date">${escapeHtml(dateStr)}</div>
    `;
    tooltipEl.hidden = false;
    if (isRealCandidate(point.candId)) {
      attachCandidateImage(document.getElementById(avatarTooltipId), cand);
    }
    // Position tooltip relative to chart container
    const chartRect = chartEl.getBoundingClientRect();
    const tooltipRect = tooltipEl.getBoundingClientRect();
    let left = clientX - chartRect.left + 14;
    let top = clientY - chartRect.top + 14;
    // Flip horizontally if near right edge
    if (left + tooltipRect.width > chartRect.width - 4) {
      left = clientX - chartRect.left - tooltipRect.width - 14;
    }
    // Clamp to chart bounds
    if (top + tooltipRect.height > chartRect.height - 4) {
      top = chartRect.height - tooltipRect.height - 4;
    }
    if (left < 4) left = 4;
    if (top < 4) top = 4;
    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
  }
  function hideTooltip() {
    tooltipEl.hidden = true;
  }

  // Translate screen coords to SVG user-space coords
  function svgPoint(evt) {
    const pt = svgEl.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return null;
    return pt.matrixTransform(ctm.inverse());
  }

  // Find nearest point to a given SVG coordinate
  function nearestPoint(svgX, svgY) {
    let best = null, bestDist = Infinity;
    for (const p of pointRegistry) {
      const dx = p.x - svgX, dy = p.y - svgY;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) { bestDist = dist; best = p; }
    }
    return best;
  }

  // Hover over the SVG hit area → find closest point, highlight its candidate, show tooltip
  hitArea.addEventListener('mousemove', (evt) => {
    const sp = svgPoint(evt);
    if (!sp) return;
    const nearest = nearestPoint(sp.x, sp.y);
    if (!nearest) return;
    // Only highlight when reasonably close — avoid jumpiness far from any line
    const dx = nearest.x - sp.x, dy = nearest.y - sp.y;
    const screenPixelDist = Math.sqrt(dx * dx + dy * dy) * (chartEl.getBoundingClientRect().width / W);
    if (screenPixelDist > 40) {
      clearDim();
      hideTooltip();
      return;
    }
    dimExcept(nearest.candId);
    showTooltip(nearest, evt.clientX, evt.clientY);
  });
  hitArea.addEventListener('mouseleave', () => {
    clearDim();
    hideTooltip();
  });

  // Legend row hover → highlight that candidate (no tooltip, just dim others)
  legendEl.querySelectorAll('.legend-row').forEach(row => {
    row.addEventListener('mouseenter', () => dimExcept(row.dataset.cand));
    row.addEventListener('mouseleave', () => clearDim());
  });
}

// ── Timeline ─────────────────────────────────────────────────────────
function renderTimeline() {
  const tl = document.getElementById('timeline');
  tl.innerHTML = '';

  if (!allSnapshots.length) {
    tl.innerHTML = `<p class="meta">${t('latest_none')}</p>`;
    return;
  }

  const providerIds = [];
  const providerNames = {};
  const providerModels = {};
  for (const snap of allSnapshots) {
    for (const r of activeResults(snap)) {
      if (!providerIds.includes(r.provider)) providerIds.push(r.provider);
      providerNames[r.provider] = r.name;
      providerModels[r.provider] = r.model;
    }
  }

  const first = new Date(allSnapshots[0].timestamp).getTime();
  const last  = Date.now();
  const span  = Math.max(1, last - first);

  for (const pid of providerIds) {
    const row = document.createElement('div');
    row.className = 'tl-row';

    const label = document.createElement('div');
    label.className = 'tl-label';
    label.innerHTML = `<div class="tl-label-name">${escapeHtml(providerNames[pid] || pid)}</div>
      <div class="tl-label-model">${escapeHtml(providerModels[pid] || '')}</div>`;
    row.appendChild(label);

    const track = document.createElement('div');
    track.className = 'tl-track';

    for (const snap of allSnapshots) {
      const result = activeResults(snap).find(r => r.provider === pid);
      if (!result || !result.ok) continue;
      const cand = candidateInfo(result.candidate_id || 'unknown');
      const pointTime = new Date(snap.timestamp).getTime();
      const x = ((pointTime - first) / span) * 100;

      const dot = document.createElement('button');
      dot.className = 'tl-point';
      if (result.candidate_id === 'no_opinion') dot.classList.add('tl-point-hollow');
      if (result.candidate_id === 'unknown') dot.classList.add('tl-point-unknown');
      dot.style.left = `${x}%`;
      dot.style.borderColor = cand.color;
      if (result.candidate_id !== 'no_opinion') dot.style.background = cand.color;

      const displayName = result.candidate_id === 'no_opinion' ? t('no_opinion_label') : result.candidate;
      dot.title = `${new Date(snap.timestamp).toLocaleString(currentLang)} — ${displayName}`;
      dot.setAttribute('aria-label', dot.title);
      dot.dataset.timestamp = snap.timestamp;
      dot.dataset.provider = pid;
      dot.addEventListener('click', () => showDetail(snap, result));
      track.appendChild(dot);

      // Attach candidate image to the timeline dot
      if (result.candidate_id && isRealCandidate(result.candidate_id) && cand.wiki) {
        attachCandidateImage(dot, cand);
      }
    }

    row.appendChild(track);
    tl.appendChild(row);
  }

  const axis = document.createElement('div');
  axis.className = 'tl-axis';
  const fmt = new Intl.DateTimeFormat(currentLang, { day: 'numeric', month: 'short', year: '2-digit' });
  axis.innerHTML = `<span>${fmt.format(new Date(first))}</span><span>${fmt.format(new Date(last))}</span>`;
  tl.appendChild(axis);
}

function showDetail(snap, result) {
  document.querySelectorAll('.tl-point').forEach(p => p.classList.remove('selected'));
  const sel = document.querySelector(`.tl-point[data-timestamp="${snap.timestamp}"][data-provider="${result.provider}"]`);
  if (sel) sel.classList.add('selected');

  const cand = candidateInfo(result.candidate_id || 'unknown');
  const confLabel = result.confidence ? t('conf_' + result.confidence) : '—';
  const fmt = new Intl.DateTimeFormat(currentLang, { dateStyle: 'full', timeStyle: 'short' });
  const isNoOpinion = result.candidate_id === 'no_opinion';
  const avatarBg = isNoOpinion ? 'transparent' : cand.color;
  const displayName = isNoOpinion ? t('no_opinion_label') : (result.candidate || '—');

  const box = document.getElementById('timelineDetail');
  box.hidden = false;
  box.innerHTML = `
    <div class="td-head">
      <span>${escapeHtml(result.name)} · <span class="td-model">${escapeHtml(result.model || '')}</span></span>
      <span>${fmt.format(new Date(snap.timestamp))}</span>
    </div>
    <div class="td-candidate">
      <span class="candidate-avatar candidate-avatar-md" id="tdAvatar" style="background: ${avatarBg}; border-color: ${cand.color}"></span>${escapeHtml(displayName)}
    </div>
    ${isRealCandidate(result.candidate_id) ? `<div class="candidate-party">${t('party')}: ${cand.party}</div>` : ''}
    ${!isNoOpinion ? `<div class="confidence ${result.confidence || ''}" style="margin-top:0.5rem">${t('confidence')}: ${confLabel}</div>` : ''}
    <div class="reasoning">${escapeHtml(result.reasoning || '')}</div>
  `;
  if (!isNoOpinion && cand.wiki) {
    attachCandidateImage(document.getElementById('tdAvatar'), cand);
  }
}

// ── Tally ────────────────────────────────────────────────────────────
function renderTally() {
  const el = document.getElementById('tally');
  el.innerHTML = '';
  const counts = {};
  let total = 0;
  for (const snap of allSnapshots) {
    for (const r of activeResults(snap)) {
      if (!r.ok) continue;
      const id = r.candidate_id || 'unknown';
      counts[id] = (counts[id] || 0) + 1;
      total++;
    }
  }

  const rows = Object.entries(counts).sort((a, b) => {
    // Push no_opinion + unknown to the bottom regardless of count
    const aLow = a[0] === 'no_opinion' || a[0] === 'unknown' ? 1 : 0;
    const bLow = b[0] === 'no_opinion' || b[0] === 'unknown' ? 1 : 0;
    if (aLow !== bLow) return aLow - bLow;
    return b[1] - a[1];
  });

  if (!rows.length || total === 0) {
    el.innerHTML = `<p class="meta">${t('latest_none')}</p>`;
    return;
  }

  const realMax = Math.max(...rows.filter(([id]) => isRealCandidate(id)).map(([, c]) => c), 1);
  rows.forEach(([id, count], idx) => {
    const cand = candidateInfo(id);
    const pct = (count / realMax) * 100;
    const pctTotal = ((count / total) * 100).toFixed(1);
    const row = document.createElement('div');
    row.className = 'tally-row';
    const name = id === 'no_opinion' ? t('no_opinion_label')
              : id === 'unknown' ? t('unrecognized_label')
              : cand.name;
    const avatarBg = id === 'no_opinion' ? 'transparent' : cand.color;
    const avatarId = `tallyAvatar-${idx}`;
    row.innerHTML = `
      <div class="tally-name">
        <span class="candidate-avatar candidate-avatar-xs" id="${avatarId}" style="background: ${avatarBg}; border-color: ${cand.color}"></span>${escapeHtml(name)}
      </div>
      <div class="tally-bar">
        <div class="tally-bar-fill" style="width:${pct}%; background:${cand.color}"></div>
      </div>
      <div class="tally-count">${count} <span style="color:var(--fg-dimmer); font-size:0.78em">(${pctTotal}%)</span></div>
    `;
    el.appendChild(row);
    if (isRealCandidate(id) && cand.wiki) {
      attachCandidateImage(document.getElementById(avatarId), cand);
    }
  });
}

// ── Utils ────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ── Boot ─────────────────────────────────────────────────────────────
(async function main() {
  applyLang();
  tickCountdown();
  setInterval(tickCountdown, 1000);

  await loadData();

  if (latestData && latestData.results?.length) {
    renderConsensus(latestData);
    renderLatest(latestData);
  } else {
    renderConsensus(null);
    document.getElementById('latestGrid').innerHTML =
      `<div class="provider-card"><p class="meta">${t('latest_none')}</p></div>`;
  }
  renderConsensusChart();
  renderTimeline();
  renderTally();
})();
