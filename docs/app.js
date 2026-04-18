/* ─── PPDF frontend ────────────────────────────────────────────────
 * Loads data/latest.json + data/history/*.json and renders:
 *  - Countdown to the 2nd round (25 April 2027)
 *  - Latest answers from each AI provider
 *  - Timeline of predictions (per provider)
 *  - Overall tally across all runs
 * ──────────────────────────────────────────────────────────────── */

const TARGET = new Date('2027-04-25T18:00:00Z'); // 20:00 Paris CEST

const CANDIDATES = {
  bardella:   { name: 'Jordan Bardella',     party: 'RN',          color: '#0d3b72' },
  lepen:      { name: 'Marine Le Pen',       party: 'RN',          color: '#13477a' },
  philippe:   { name: 'Édouard Philippe',    party: 'Horizons',    color: '#1e88e5' },
  attal:      { name: 'Gabriel Attal',       party: 'Renaissance', color: '#8b5cf6' },
  darmanin:   { name: 'Gérald Darmanin',     party: 'Renaissance', color: '#a78bfa' },
  lecornu:    { name: 'Sébastien Lecornu',   party: 'Renaissance', color: '#b794f4' },
  retailleau: { name: 'Bruno Retailleau',    party: 'LR',          color: '#0ea5e9' },
  wauquiez:   { name: 'Laurent Wauquiez',    party: 'LR',          color: '#38bdf8' },
  melenchon:  { name: 'Jean-Luc Mélenchon',  party: 'LFI',         color: '#dc2626' },
  glucksmann: { name: 'Raphaël Glucksmann',  party: 'PP/PS',       color: '#f472b6' },
  faure:      { name: 'Olivier Faure',       party: 'PS',          color: '#ec4899' },
  ruffin:     { name: 'François Ruffin',     party: 'Debout!',     color: '#f59e0b' },
  tondelier:  { name: 'Marine Tondelier',    party: 'EÉLV',        color: '#16a34a' },
  zemmour:    { name: 'Éric Zemmour',        party: 'Reconquête',  color: '#4b5563' },
  marechal:   { name: 'Marion Maréchal',     party: 'IDL',         color: '#6b7280' },
  macron:     { name: 'Emmanuel Macron',     party: 'Renaissance', color: '#7c3aed' },
  no_opinion: { name: 'No opinion',          party: '—',           color: '#52525b' },
  unknown:    { name: 'Unrecognized',        party: '—',           color: '#64748b' },
};

function candidateInfo(id) { return CANDIDATES[id] || CANDIDATES.unknown; }
function isRealCandidate(id) { return id && id !== 'no_opinion' && id !== 'unknown'; }

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
  if (latestData) { renderConsensus(latestData); renderLatest(latestData); }
  if (allSnapshots.length) { renderTimeline(); renderTally(); }
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
  const okResults = snapshot.results.filter(r => r.ok);
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
        <span class="candidate-dot-big" style="background: ${cand.color}"></span>${escapeHtml(cand.name)}
      </div>
      <div class="consensus-meta">${partyPrefix}${escapeHtml(countText)}</div>
    `;
    return;
  }

  // Tie — render each tied candidate
  const items = consensus.ids.map(id => {
    const cand = candidateInfo(id);
    return `<div class="consensus-tied-item" style="color: ${cand.color}">
      <span class="candidate-dot-big" style="background: ${cand.color}"></span>${escapeHtml(cand.name)}
    </div>`;
  }).join('');
  el.innerHTML = `
    <div class="consensus-label">${t('consensus_tied')}</div>
    <div class="consensus-tied">${items}</div>
    <div class="consensus-meta">${escapeHtml(countText)}</div>
  `;
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
  for (const r of snapshot.results) {
    const card = document.createElement('div');
    card.className = 'provider-card';

    // Three display states:
    //   - !ok              → error card
    //   - candidate_id is "no_opinion" → model declined
    //   - otherwise → real or unrecognized candidate
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
    const dotStyle = isNoOpinion
      ? `background: transparent; border: 2px solid ${cand.color}`
      : `background: ${cand.color}`;

    const showParty = r.ok && isRealCandidate(r.candidate_id);

    card.innerHTML = `
      <div class="provider-head">
        <div class="provider-name">${escapeHtml(r.name)}</div>
        <div class="provider-status ${statusClass}">${statusLabel}</div>
      </div>
      <div>
        <div class="candidate-name">
          ${r.ok ? `<span class="candidate-dot" style="${dotStyle}"></span>` : ''}${escapeHtml(nameToShow)}
        </div>
        ${showParty ? `<div class="candidate-party">${cand.party}</div>` : ''}
        ${isUnknown && r.ok ? `<div class="candidate-party">${t('unrecognized_note')}</div>` : ''}
      </div>
      ${r.ok && !isNoOpinion
        ? `<div class="confidence ${r.confidence || ''}">${t('confidence')}: ${confLabel} <span class="dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span></div>`
        : ''}
      <div class="reasoning">
        ${r.ok ? escapeHtml(r.reasoning || (isNoOpinion ? t('no_opinion_reason') : '')) : `<span class="error-msg">${escapeHtml(r.error || '')}</span>`}
      </div>
    `;
    grid.appendChild(card);
  }
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
  for (const snap of allSnapshots) {
    for (const r of (snap.results || [])) {
      if (!providerIds.includes(r.provider)) providerIds.push(r.provider);
      providerNames[r.provider] = r.name;
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
    label.textContent = providerNames[pid] || pid;
    row.appendChild(label);

    const track = document.createElement('div');
    track.className = 'tl-track';

    for (const snap of allSnapshots) {
      const result = (snap.results || []).find(r => r.provider === pid);
      if (!result || !result.ok) continue;
      const cand = candidateInfo(result.candidate_id || 'unknown');
      const pointTime = new Date(snap.timestamp).getTime();
      const x = ((pointTime - first) / span) * 100;

      const dot = document.createElement('button');
      dot.className = 'tl-point';
      if (result.candidate_id === 'no_opinion') dot.classList.add('tl-point-hollow');
      if (result.candidate_id === 'unknown') dot.classList.add('tl-point-unknown');
      dot.style.left = `${x}%`;
      if (result.candidate_id !== 'no_opinion') dot.style.background = cand.color;
      else dot.style.borderColor = cand.color;

      dot.title = `${new Date(snap.timestamp).toLocaleString(currentLang)} — ${result.candidate}`;
      dot.setAttribute('aria-label', dot.title);
      dot.dataset.timestamp = snap.timestamp;
      dot.dataset.provider = pid;
      dot.addEventListener('click', () => showDetail(snap, result));
      track.appendChild(dot);
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
  const dotStyle = isNoOpinion
    ? `background: transparent; border: 2px solid ${cand.color}`
    : `background: ${cand.color}`;
  const displayName = isNoOpinion ? t('no_opinion_label') : (result.candidate || '—');

  const box = document.getElementById('timelineDetail');
  box.hidden = false;
  box.innerHTML = `
    <div class="td-head">
      <span>${escapeHtml(result.name)} · ${escapeHtml(result.model || '')}</span>
      <span>${fmt.format(new Date(snap.timestamp))}</span>
    </div>
    <div class="td-candidate">
      <span class="candidate-dot" style="${dotStyle}"></span>${escapeHtml(displayName)}
    </div>
    ${isRealCandidate(result.candidate_id) ? `<div class="candidate-party">${t('party')}: ${cand.party}</div>` : ''}
    ${!isNoOpinion ? `<div class="confidence ${result.confidence || ''}" style="margin-top:0.5rem">${t('confidence')}: ${confLabel}</div>` : ''}
    <div class="reasoning">${escapeHtml(result.reasoning || '')}</div>
  `;
}

// ── Tally ────────────────────────────────────────────────────────────
function renderTally() {
  const el = document.getElementById('tally');
  el.innerHTML = '';
  const counts = {};
  let total = 0;
  for (const snap of allSnapshots) {
    for (const r of (snap.results || [])) {
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
  for (const [id, count] of rows) {
    const cand = candidateInfo(id);
    const pct = (count / realMax) * 100;
    const pctTotal = ((count / total) * 100).toFixed(1);
    const row = document.createElement('div');
    row.className = 'tally-row';
    const name = id === 'no_opinion' ? t('no_opinion_label')
              : id === 'unknown' ? t('unrecognized_label')
              : cand.name;
    const dotStyle = id === 'no_opinion'
      ? `background: transparent; border: 2px solid ${cand.color}`
      : `background: ${cand.color}`;
    row.innerHTML = `
      <div class="tally-name">
        <span class="candidate-dot" style="${dotStyle}"></span>${escapeHtml(name)}
      </div>
      <div class="tally-bar">
        <div class="tally-bar-fill" style="width:${pct}%; background:${cand.color}"></div>
      </div>
      <div class="tally-count">${count} <span style="color:var(--fg-dimmer); font-size:0.78em">(${pctTotal}%)</span></div>
    `;
    el.appendChild(row);
  }
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
  renderTimeline();
  renderTally();
})();
