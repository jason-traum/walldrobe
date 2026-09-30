// Walldrobe demo. Sample walls, Unsplash photos, and the real layout engine,
// all in the browser. Nothing is saved and nothing is sent anywhere.

import { layout, refill } from '../engine/index.js';
import { fitTaste, scoreTaste, nextPair, describeTaste } from '../engine/taste.js';
import { toCandidate, activeRecords } from '../engine/catalog.js';
import { WALLS, SAMPLE_PICKS } from './samples.js';

const QUIZ_LENGTH = 10;
const CATALOG = activeRecords(window.WALLDROBE_CATALOG.items).map((r) => ({ ...toCandidate(r), imageData: r.image.data, aspect: r.image.aspect }));
const byId = new Map(CATALOG.map((c) => [c.id, c]));

const state = {
  wall: 'living',
  keeps: Object.fromEntries(WALLS.flatMap((w) => w.owned.map((p) => [p.id, p.keep]))),
  tasteSource: 'sample', // 'sample' | 'yours'
  weights: null,
  rank: 1,
  selected: null,
  measure: true,
  quiz: null, // { picks, shown, pair, n }
  view: null, // { key, layouts, problems } what's on screen, after any refresh or swap
  kept: new Map(), // catalog id -> { id, w, h }, pieces the person chose to keep
  avoid: [], // layout keys already shown on this wall, for "Try a new layout"
  seen: new Map(), // layout key -> ids already shown in it, so a refresh brings new art
  flash: null, // a one-time message under the drawing
  busy: null, // which action is running
  scale: 0, // the size lever: -1 fewer, bigger; 0 balanced; 1 more, smaller
};

// ---------- Taste ----------

function firstOf(cat, n = 0) { return CATALOG.filter((c) => c.record.category === cat)[n]; }
function samplePicks() {
  return SAMPLE_PICKS.map(([w, l], i) => ({ winner: firstOf(w, i % 2), loser: firstOf(l, i % 2) })).filter((p) => p.winner && p.loser);
}
state.weights = fitTaste(samplePicks());

// ---------- Engine ----------

function currentWall() { return WALLS.find((w) => w.key === state.wall); }

function baseInput() {
  const w = currentWall();
  const owned = w.owned.map((p) => ({ ...p, keep: state.keeps[p.id] }));
  const taste = scoreTaste(state.weights, CATALOG);
  return { wall: w.wall, obstacles: w.obstacles, owned, catalog: CATALOG, taste, room: w.room, count: 3, prefs: { scale: state.scale } };
}
const viewKey = () => JSON.stringify([state.wall, state.keeps, state.tasteSource, state.weights, [...state.kept.keys()], state.scale]);
const keepList = () => [...state.kept.values()];

function remember(layouts) {
  for (const L of layouts) {
    if (!state.avoid.includes(L.key)) state.avoid.push(L.key);
    const seen = state.seen.get(L.key) || new Set();
    for (const p of L.pieces) if (p.ref.source === 'catalog') seen.add(p.ref.id);
    state.seen.set(L.key, seen);
  }
}

// What's on screen. Recomputed when the wall, the keep settings, the taste or the kept pieces change.
function run() {
  const key = viewKey();
  if (state.view && state.view.key === key) return state.view;
  const r = layout({ ...baseInput(), keep: keepList() });
  state.view = { key, layouts: r.layouts, problems: r.problems };
  remember(r.layouts);
  return state.view;
}

function shownLayout() { return run().layouts.find((x) => x.rank === state.rank); }

// Same frames, new art: every piece that isn't kept or yours, or just one.
function refreshShown(swapId) {
  const L = shownLayout();
  if (!L) return;
  const input = baseInput();
  const keep = L.pieces.filter((p) => state.kept.has(p.ref.id)).map((p) => p.ref.id);
  const exclude = [...(state.seen.get(L.key) || [])].filter((id) => !keep.includes(id));
  const opts = swapId ? { swap: swapId } : { keep };
  let r = refill({ ...input, keep: keepList().filter((k) => keep.includes(k.id)), exclude }, L, opts);
  // Seen everything in these sizes: start over, but never bring back the pieces just replaced.
  if (!r.layouts.length) r = refill({ ...input, keep: keepList().filter((k) => keep.includes(k.id)) }, L, opts);
  if (!r.layouts.length) { state.flash = r.problems[0] ? r.problems[0].message : 'No other art fits these frames.'; return; }
  const next = { ...r.layouts[0], rank: L.rank };
  state.view.layouts = state.view.layouts.map((x) => (x.rank === L.rank ? next : x));
  remember([next]);
  if (r.problems.some((p) => p.code === 'NOTHING_TO_CHANGE')) state.flash = 'Every piece here is kept or yours. Unkeep one to refresh it.';
  if (swapId && state.selected === swapId) state.selected = next.pieces[L.pieces.findIndex((p) => p.ref.id === swapId)]?.ref.id || null;
}

// After a keep or unkeep, the layout on screen stays as it is and the other tabs
// are rebuilt around what's kept now.
function rebuildOthers() {
  const L = shownLayout();
  const r = layout({ ...baseInput(), keep: keepList(), count: 6 });
  const others = r.layouts.filter((x) => x.key !== L.key).slice(0, 2);
  const layouts = [{ ...L, rank: 1 }, ...others.map((x, i) => ({ ...x, rank: i + 2 }))];
  state.view = { key: viewKey(), layouts, problems: r.problems };
  state.rank = 1;
  remember(others);
}

// New arrangements, skipping the ones already shown on this wall.
function newLayouts() {
  const r = layout({ ...baseInput(), keep: keepList(), avoid: state.avoid });
  if (r.problems.some((p) => p.code === 'ALL_SHOWN')) {
    state.flash = "That's every arrangement that fits this wall, so these start again from the best.";
    state.avoid = [];
  }
  state.view = { key: viewKey(), layouts: r.layouts, problems: r.problems };
  remember(r.layouts);
  state.rank = 1;
  state.selected = null;
}

// Engine calls take a moment on a phone, so show the button working first.
function act(name, fn) {
  if (state.busy) return;
  state.busy = name;
  render();
  setTimeout(() => { try { fn(); } finally { state.busy = null; render(); } }, 30);
}

// ---------- Formatting ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function inches(v) {
  const whole = Math.floor(v + 1e-9);
  const frac = Math.round((v - whole) * 4);
  const f = ['', '¼', '½', '¾'][frac] || '';
  return `${frac === 4 ? whole + 1 : whole}${frac === 4 ? '' : f} in`;
}
function feet(v) {
  const ft = Math.floor(v / 12), inch = Math.round(v - ft * 12);
  return inch ? `${ft} ft ${inch} in` : `${ft} ft`;
}
// Swatches for the color families the engine measures.
const SWATCH = {
  red: '#C0392B', pink: '#E9A3B6', orange: '#E07B22', yellow: '#E6C33A', brown: '#8B5A2B', green: '#3F7F4A',
  teal: '#1B7F86', blue: '#2F55B5', purple: '#7A4A9E', black: '#1A1A1A', gray: '#9A9A9A', white: '#F6F6F3',
};
const SCHEME = {
  neutral: 'Neutral', monochromatic: 'Monochromatic', analogous: 'Analogous', complementary: 'Complementary',
  'split complementary': 'Split complementary', triadic: 'Triadic', mixed: 'Mixed',
};
const pct = (v) => `${Math.round(v * 100)}%`;
function colorBar(shares, cls = '') {
  const parts = Object.entries(shares).filter(([, v]) => v >= 0.01);
  const total = parts.reduce((a, [, v]) => a + v, 0) || 1;
  return `<span class="cbar ${cls}" role="img" aria-label="${esc(parts.map(([k, v]) => `${pct(v / total)} ${k}`).join(', '))}">${parts.map(([k, v]) => `<span style="flex-grow:${(v / total).toFixed(4)};background:${SWATCH[k] || '#999'}" class="cseg${k === 'white' ? ' is-white' : ''}"></span>`).join('')}</span>`;
}

const FAMILY = {
  salon: 'Two rows',
  grid: 'Grid',
  line: 'One row',
  statement: 'Center piece',
};
function familyName(L) {
  if (L.family === 'statement' && L.variant === 'solo') return 'One big piece';
  if (L.family === 'statement') return L.variant === 'stack' ? 'Center, stacked sides' : 'Center and sides';
  if (L.family === 'grid') return `${L.meta.rows} by ${L.meta.cols} grid`;
  return FAMILY[L.family] || L.family;
}

// ---------- Wall drawing ----------

function furniture(o, H, s) {
  const y = H - o.y - o.h;
  const base = `x="${o.x}" y="${y}" width="${o.w}" height="${o.h}"`;
  switch (o.kind) {
    case 'couch': case 'sofa': {
      const arm = Math.min(7, o.w * 0.09);
      return `<g class="furn">
        <rect ${base} rx="3"/>
        <rect x="${o.x}" y="${y + o.h * 0.35}" width="${arm}" height="${o.h * 0.65}" rx="2" class="furn-dark"/>
        <rect x="${o.x + o.w - arm}" y="${y + o.h * 0.35}" width="${arm}" height="${o.h * 0.65}" rx="2" class="furn-dark"/>
        <line x1="${o.x + o.w / 2}" x2="${o.x + o.w / 2}" y1="${y + o.h * 0.1}" y2="${y + o.h * 0.62}" class="seam"/>
        <line x1="${o.x + arm}" x2="${o.x + o.w - arm}" y1="${y + o.h * 0.62}" y2="${y + o.h * 0.62}" class="seam"/>
      </g>`;
    }
    case 'headboard': case 'bed': {
      const bedH = Math.min(24, o.h * 0.6);
      return `<g class="furn">
        <rect ${base} rx="2"/>
        <rect x="${o.x - 2}" y="${H - bedH}" width="${o.w + 4}" height="${bedH}" rx="2" class="bedding"/>
        <rect x="${o.x + 6}" y="${H - bedH - 6}" width="${o.w / 2 - 9}" height="9" rx="3" class="pillow"/>
        <rect x="${o.x + o.w / 2 + 3}" y="${H - bedH - 6}" width="${o.w / 2 - 9}" height="9" rx="3" class="pillow"/>
      </g>`;
    }
    case 'dresser': case 'sideboard': case 'console': case 'credenza': {
      const rows = 3;
      const lines = Array.from({ length: rows - 1 }, (_, i) => `<line x1="${o.x + 1.5}" x2="${o.x + o.w - 1.5}" y1="${y + (o.h / rows) * (i + 1)}" y2="${y + (o.h / rows) * (i + 1)}" class="seam"/>`).join('');
      return `<g class="furn"><rect ${base} rx="1"/>${lines}</g>`;
    }
    case 'lamp': {
      const cx = o.x + o.w / 2;
      return `<g class="furn">
        <line x1="${cx}" x2="${cx}" y1="${H - 1}" y2="${y + 8}" class="pole"/>
        <path d="M${o.x} ${y + 9} L${o.x + 2.5} ${y} L${o.x + o.w - 2.5} ${y} L${o.x + o.w} ${y + 9} Z" class="shade"/>
        <rect x="${cx - 4}" y="${H - 1.5}" width="8" height="1.5" class="furn-dark"/>
      </g>`;
    }
    case 'window': {
      return `<g class="window"><rect ${base}/><line x1="${o.x + o.w / 2}" x2="${o.x + o.w / 2}" y1="${y}" y2="${y + o.h}"/><line x1="${o.x}" x2="${o.x + o.w}" y1="${y + o.h / 2}" y2="${y + o.h / 2}"/></g>`;
    }
    case 'outlet': case 'switch':
      return `<rect ${base} rx="0.4" class="fixture"/>`;
    default:
      return `<rect ${base} class="furn"/>`;
  }
}

function piece(p, s, H, selected) {
  const y = H - p.y - p.h;
  const matW = Math.min(p.w, p.h) >= 12 ? 1.5 : 1;
  const frameW = 0.75;
  const inner = { x: p.x + frameW + matW, y: y + frameW + matW, w: p.w - 2 * (frameW + matW), h: p.h - 2 * (frameW + matW) };
  const item = byId.get(p.ref.id);
  const owned = currentWall().owned.find((o) => o.id === p.ref.id);
  const art = item
    ? `<image href="${item.imageData}" x="${inner.x}" y="${inner.y}" width="${inner.w}" height="${inner.h}" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect x="${inner.x}" y="${inner.y}" width="${inner.w}" height="${inner.h}" fill="${owned ? owned.color : '#999'}"/>
       <text x="${p.x + p.w / 2}" y="${y + p.h / 2}" class="owned-label" font-size="${s * 0.8}">yours</text>`;
  return `<g class="art${selected ? ' is-selected' : ''}" data-id="${esc(p.ref.id)}" tabindex="0" role="button" aria-label="${esc(p.title)}, ${p.w} by ${p.h} inches">
    <rect x="${p.x}" y="${y}" width="${p.w}" height="${p.h}" class="frame"/>
    <rect x="${p.x + frameW}" y="${y + frameW}" width="${p.w - 2 * frameW}" height="${p.h - 2 * frameW}" class="mat"/>
    ${art}
    <rect x="${p.x - 0.8}" y="${y - 0.8}" width="${p.w + 1.6}" height="${p.h + 1.6}" class="select-ring"/>
  </g>`;
}

function measures(L, W, H, s) {
  const g = L.group;
  const top = H - (g.y + g.h);
  const bottom = H - g.y;
  const ty = Math.max(s * 1.6, top - s * 1.4);
  const lx = g.x - s * 1.2;
  const nails = L.pieces.map((p) => `<circle cx="${p.nail.x}" cy="${H - p.nail.y}" r="${s * 0.22}" class="nail"/>`).join('');
  return `<g class="measure">
    <line x1="0" x2="${W}" y1="${H - 57}" y2="${H - 57}" class="centerline"/>
    <text x="${s * 0.4}" y="${H - 57 - s * 0.35}" font-size="${s * 0.85}">57 in to center</text>
    <line x1="${g.x}" x2="${g.x + g.w}" y1="${ty}" y2="${ty}"/>
    <line x1="${g.x}" x2="${g.x}" y1="${ty - s * 0.5}" y2="${ty + s * 0.5}"/>
    <line x1="${g.x + g.w}" x2="${g.x + g.w}" y1="${ty - s * 0.5}" y2="${ty + s * 0.5}"/>
    <text x="${g.x + g.w / 2}" y="${ty - s * 0.45}" text-anchor="middle" font-size="${s}">${esc(inches(g.w))}</text>
    <line x1="${lx}" x2="${lx}" y1="${bottom}" y2="${H}"/>
    <line x1="${lx - s * 0.5}" x2="${lx + s * 0.5}" y1="${bottom}" y2="${bottom}"/>
    <text x="${lx - s * 0.45}" y="${bottom + (H - bottom) / 2}" text-anchor="end" font-size="${s}">${esc(inches(g.y))}</text>
    ${nails}
  </g>`;
}

function wallSvg(w, L) {
  const W = w.wall.width, H = w.wall.height;
  // Label size in inches: about W/34, but never under 11 px on screen.
  const px = Math.max(240, ($('#drawing') && $('#drawing').clientWidth) || 600) / (W * 1.05);
  const s = Math.max(W / 34, 11 / px);
  const pad = s * 0.6;
  const obs = w.obstacles.map((o) => furniture(o, H, s)).join('');
  const arts = L ? L.pieces.map((p) => piece(p, s, H, p.ref.id === state.selected)).join('') : '';
  return `<svg viewBox="${-pad} ${-pad} ${W + pad * 2} ${H + pad * 2}" role="img" aria-label="${esc(w.name)} wall, ${esc(feet(W))} wide and ${esc(feet(H))} tall${L ? `, with ${L.pieces.length} pieces` : ''}">
    <rect x="0" y="0" width="${W}" height="${H}" class="wall"/>
    <rect x="0" y="${H - 4}" width="${W}" height="4" class="baseboard"/>
    ${obs}
    ${arts}
    ${L && state.measure ? measures(L, W, H, s) : ''}
    <text x="${s * 0.4}" y="${s * 1.1}" font-size="${s * 0.85}" class="wall-size">${esc(feet(W))} x ${esc(feet(H))}</text>
  </svg>`;
}

// ---------- Screens ----------

const $ = (sel) => document.querySelector(sel);

function renderWallTabs() {
  $('#walls').innerHTML = WALLS.map((w) => `<button type="button" class="wall-tab" data-wall="${w.key}" aria-pressed="${w.key === state.wall}">${esc(w.name)}</button>`).join('');
}

function renderLayoutTabs(result) {
  const seen = new Map();
  const names = result.layouts.map((L) => { const n = familyName(L); seen.set(n, (seen.get(n) || 0) + 1); return seen.get(n) > 1 ? `${n}, other picks` : n; });
  $('#layouts').innerHTML = result.layouts.map((L, i) => `
    <button type="button" class="layout-tab" data-rank="${L.rank}" aria-pressed="${L.rank === state.rank}">
      <span class="rank">${L.rank}</span>
      <span class="lt-name">${esc(names[i])}</span>
      <span class="lt-count">${L.pieces.length} piece${L.pieces.length === 1 ? '' : 's'}</span>
    </button>`).join('');
}

function tastePanel() {
  const words = describeTaste(state.weights);
  const list = words.length ? words.join(', ') : 'no strong leanings yet';
  if (state.tasteSource === 'yours') {
    return `<div><p class="taste-title">Your taste: ${esc(list)}.</p>
      <p class="muted">Every wall below picked its art for this.</p></div>
      <button type="button" class="btn-quiet" data-act="quiz">Retake the taste test</button>`;
  }
  return `<div><p class="taste-title">Take the taste test</p>
      <p class="muted">${QUIZ_LENGTH} quick picks, then every wall re-picks its art for you. Right now it's showing a sample taste: ${esc(list)}.</p></div>
      <button type="button" class="btn" data-act="quiz">Start the taste test</button>`;
}

function pieceRow(p, L) {
  const item = byId.get(p.ref.id);
  const w = currentWall();
  const owned = w.owned.find((o) => o.id === p.ref.id);
  const thumb = item
    ? `<img src="${item.imageData}" alt="" width="${Math.round(64 * Math.min(1, item.aspect))}" height="${Math.round(64 / Math.max(1, item.aspect))}">`
    : `<span class="swatch" style="background:${owned ? owned.color : '#999'}"></span>`;
  const credit = item ? `<a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.artist)} on Unsplash</a>` : 'Yours';
  const nail = `Nail ${esc(inches(p.nail.y))} up, ${esc(inches(p.nail.x))} from the left end.`;
  const reason = state.tasteSource === 'sample' ? p.reason.replace('what you picked in the quiz', 'the sample taste') : p.reason.replace('in the quiz', 'in the taste test');
  const tags = item ? [item.record.tags.mood[0], item.record.tags.style[0]].filter(Boolean).join(', ') : '';
  return `<li class="piece${p.ref.id === state.selected ? ' is-selected' : ''}" data-id="${esc(p.ref.id)}">
    <button type="button" class="piece-hit" data-id="${esc(p.ref.id)}" aria-pressed="${p.ref.id === state.selected}">
      <span class="thumb">${thumb}</span>
      <span class="piece-text">
        <span class="piece-title">${esc(item ? item.title : `Your ${p.title}`)}</span>
        <span class="piece-meta">${p.w} x ${p.h} in frame${tags ? `. ${esc(tags.charAt(0).toUpperCase() + tags.slice(1))}.` : ''}</span>
      </span>
    </button>
    ${colorBar(p.shares || {}, 'cbar-piece')}
    <p class="piece-meta">${item ? `Photo: ${credit}` : 'Already yours'}</p>
    <p class="reason">${esc(reason)}</p>
    <p class="nail-line">${nail}</p>
    ${item ? `<div class="piece-acts">
      <button type="button" class="chip" data-act="keep" data-id="${esc(p.ref.id)}" aria-pressed="${state.kept.has(p.ref.id)}">${state.kept.has(p.ref.id) ? 'Kept' : 'Keep'}</button>
      <button type="button" class="chip" data-act="swap" data-id="${esc(p.ref.id)}"${state.kept.has(p.ref.id) || state.busy ? ' disabled' : ''}>${state.busy === `swap:${p.ref.id}` ? 'Swapping…' : 'Swap this one'}</button>
    </div>` : ''}
  </li>`;
}

function whyPanel(L) {
  const c = L.color;
  const scheme = SCHEME[c.scheme] || c.scheme;
  const colors = c.colors && c.colors.length ? `: ${c.colors.join(', ')}` : '';
  const legend = Object.entries(c.shares).filter(([, v]) => v >= 0.03).slice(0, 6)
    .map(([k, v]) => `<li><span class="dot${k === 'white' ? ' is-white' : ''}" style="background:${SWATCH[k] || '#999'}"></span>${esc(k)} <span class="muted">${pct(v)}</span></li>`).join('');
  const meters = [['Fit', L.parts.fit], ['Taste', L.parts.taste], ['Color', L.parts.color], ['Design', L.parts.design]]
    .map(([k, v]) => `<li><span class="m-label">${k}</span><span class="meter"><span style="width:${Math.round(v * 100)}%"></span></span><span class="m-val">${Math.round(v * 100)}</span></li>`).join('');
  const notes = L.notes.map((n) => `<li${n.startsWith('Worth knowing') ? ' class="caveat"' : ''}>${esc(n)}</li>`).join('');
  return `<div class="why-head"><h2>Why it works</h2><span class="scheme">${esc(scheme)}${esc(colors)}</span></div>
    ${colorBar(c.shares, 'cbar-wall')}
    <ul class="legend">${legend}</ul>
    <ul class="notes">${notes}</ul>
    <ul class="meters" aria-label="Scores out of 100">${meters}</ul>`;
}

function renderOwned(w) {
  const el = $('#owned');
  if (!w.owned.length) { el.hidden = true; return; }
  el.hidden = false;
  const opts = [['must', 'Must keep'], ['happy', 'Happy to move'], ['dontcare', "Don't care"]];
  el.innerHTML = `<h2>Already on this wall</h2>
    <ul class="owned-list">${w.owned.map((p) => `
      <li>
        <span class="swatch" style="background:${p.color}"></span>
        <span class="owned-name">Your ${esc(p.title)} <span class="muted">${p.w} x ${p.h} in</span></span>
        <span class="seg" role="group" aria-label="Keep setting for your ${esc(p.title)}">
          ${opts.map(([v, label]) => `<button type="button" data-keep="${v}" data-owned="${p.id}" aria-pressed="${state.keeps[p.id] === v}">${label}</button>`).join('')}
        </span>
      </li>`).join('')}</ul>`;
}

function renderQuiz() {
  const q = state.quiz;
  const [a, b] = q.pair;
  const card = (it) => `<button type="button" class="quiz-card" data-pick="${esc(it.id)}">
      <img src="${it.imageData}" alt="${esc(it.title)}">
      <span>${esc(it.title)}</span>
    </button>`;
  $('#quiz').innerHTML = `<div class="quiz-head">
      <h2>Which one would you rather have on your wall?</h2>
      <span class="muted">${q.n + 1} of ${QUIZ_LENGTH}</span>
    </div>
    <div class="quiz-bar" aria-hidden="true"><span style="width:${(q.n / QUIZ_LENGTH) * 100}%"></span></div>
    <div class="quiz-pair">${card(a)}${card(b)}</div>
    <div class="quiz-foot">
      <button type="button" class="linklike" data-act="quiz-skip">Neither, show me another pair</button>
      <button type="button" class="linklike" data-act="quiz-cancel">Stop the test</button>
    </div>`;
}

function render() {
  renderWallTabs();
  const w = currentWall();
  $('#wall-note').textContent = w.note;
  renderOwned(w);
  const quizOn = !!state.quiz;
  $('#quiz').hidden = !quizOn;
  $('#stage').hidden = quizOn;
  $('#list').hidden = quizOn;
  $('#taste').hidden = quizOn;
  if (quizOn) { renderQuiz(); return; }

  const result = run();
  const problems = result.problems.filter((p) => p.code !== 'FAMILY_SKIPPED');
  if (!result.layouts.length) {
    $('#layouts').innerHTML = '';
    $('#flash').hidden = true;
    $('#nail-note').hidden = true;
    $('#pieces-head').textContent = '';
    $('#drawing').innerHTML = wallSvg(w, null);
    $('#summary').textContent = problems[0] ? problems[0].message : 'No layout fits this wall.';
    $('#pieces').innerHTML = '';
    $('#why').innerHTML = '';
    $('#left').hidden = true;
    return;
  }
  if (!result.layouts.some((L) => L.rank === state.rank)) state.rank = 1;
  const L = result.layouts.find((x) => x.rank === state.rank);
  if (state.selected && !L.pieces.some((p) => p.ref.id === state.selected)) state.selected = null;
  renderLayoutTabs(result);
  $('#drawing').innerHTML = wallSvg(w, L);
  $('#summary').textContent = L.summary;
  $('#why').innerHTML = whyPanel(L);
  $('#flash').hidden = !state.flash;
  $('#flash').textContent = state.flash || '';
  const keptHere = L.pieces.filter((p) => state.kept.has(p.ref.id)).length;
  $('#refresh').textContent = state.busy === 'refresh' ? 'Picking new art…' : keptHere ? `Refresh all but the ${keptHere} kept` : 'Refresh the art';
  $('#another').textContent = state.busy === 'another' ? 'Finding layouts…' : 'Try a new layout';
  $('#refresh').disabled = $('#another').disabled = !!state.busy;
  $('#taste').innerHTML = tastePanel();
  for (const b of document.querySelectorAll('[data-scale]')) b.setAttribute('aria-pressed', String(Number(b.dataset.scale) === state.scale));
  $('#measure').checked = state.measure;
  const newCount = L.pieces.filter((p) => p.ref.source === 'catalog').length;
  const n = L.pieces.length;
  $('#pieces-head').textContent = `${n} piece${n === 1 ? '' : 's'}${newCount ? `, ${newCount} new` : ''}`;
  const order = [...L.pieces].sort((a, b) => (b.ref.source === 'owned') - (a.ref.source === 'owned') || b.w * b.h - a.w * a.h);
  $('#pieces').innerHTML = order.map((p) => pieceRow(p, L)).join('');
  const guessed = L.pieces.filter((p) => p.nailNote).length;
  $('#nail-note').hidden = !guessed;
  $('#nail-note').textContent = guessed ? `Nail heights assume the wire sits 2 in below the top of each frame${guessed < L.pieces.length ? ' where we don\'t know it' : ''}. Measure yours before you drill.` : '';
  const left = $('#left');
  left.hidden = !L.left.length;
  left.innerHTML = L.left.length ? `<h3>Left off this wall</h3><ul>${L.left.map((l) => `<li><strong>Your ${esc(l.title)}.</strong> ${esc(l.reason)}</li>`).join('')}</ul>` : '';
}

// ---------- Events ----------

function select(id) {
  state.selected = state.selected === id ? null : id;
  render();
  if (state.selected) {
    const row = document.querySelector(`.piece[data-id="${CSS.escape(state.selected)}"]`);
    if (row && window.matchMedia('(max-width: 899px)').matches) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('button, .art');
  if (!t) return;
  if (t.dataset.wall) {
    if (t.dataset.wall !== state.wall) { state.kept = new Map(); state.avoid = []; state.seen = new Map(); state.view = null; }
    state.wall = t.dataset.wall; state.rank = 1; state.selected = null; state.flash = null; render(); return;
  }
  if (t.dataset.rank) { state.rank = Number(t.dataset.rank); state.selected = null; state.flash = null; render(); return; }
  if (t.dataset.scale !== undefined) { state.scale = Number(t.dataset.scale); state.rank = 1; state.selected = null; state.flash = null; act('scale', () => run()); return; }
  if (t.dataset.keep) { state.keeps[t.dataset.owned] = t.dataset.keep; state.rank = 1; state.flash = null; render(); return; }
  if (t.classList.contains('art') || t.classList.contains('piece-hit')) { select(t.dataset.id); return; }
  if (t.dataset.pick) {
    const q = state.quiz;
    const [a, b] = q.pair;
    const winner = a.id === t.dataset.pick ? a : b;
    q.picks.push({ winner, loser: winner === a ? b : a });
    advanceQuiz(true);
    return;
  }
  const a = t.dataset.act;
  if (a === 'keep') {
    const L = shownLayout();
    const p = L && L.pieces.find((x) => x.ref.id === t.dataset.id);
    if (state.kept.has(t.dataset.id)) state.kept.delete(t.dataset.id);
    else if (p) state.kept.set(p.ref.id, { id: p.ref.id, w: p.w, h: p.h });
    state.flash = null;
    act('keep', rebuildOthers);
    return;
  }
  if (a === 'swap') { state.flash = null; act(`swap:${t.dataset.id}`, () => refreshShown(t.dataset.id)); return; }
  if (a === 'refresh') { state.flash = null; act('refresh', () => refreshShown(null)); return; }
  if (a === 'another') { state.flash = null; act('another', newLayouts); return; }
  const act0 = a;
  if (act0 === 'quiz') {
    const shown = new Set();
    state.quiz = { picks: [], shown, n: 0, pair: nextPair(CATALOG, [], shown) };
    render();
    $('#quiz').scrollIntoView({ block: 'start' });
  }
  if (act0 === 'quiz-skip') advanceQuiz(false);
  if (act0 === 'quiz-cancel') { state.quiz = null; render(); }
});

document.addEventListener('keydown', (e) => {
  const t = e.target.closest && e.target.closest('.art');
  if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(t.dataset.id); }
});

$('#measure').addEventListener('change', (e) => { state.measure = e.target.checked; render(); });

// A pick counts toward the ten; a skip doesn't, but after 20 pairs the test ends anyway.
function advanceQuiz(picked) {
  const q = state.quiz;
  q.pair.forEach((it) => q.shown.add(it.id));
  if (picked) q.n++;
  const next = q.n < QUIZ_LENGTH && q.shown.size < 40 ? nextPair(CATALOG, q.picks, q.shown) : null;
  if (!next) {
    if (q.picks.length) { state.weights = fitTaste(q.picks); state.tasteSource = 'yours'; }
    state.quiz = null;
    state.rank = 1;
    state.selected = null;
    render();
    $('#taste').scrollIntoView({ block: 'start' });
    return;
  }
  q.pair = next;
  render();
}

render();

// Labels are sized from the drawing's width, so redraw when it changes.
let lastW = 0;
window.addEventListener('resize', () => {
  const w = $('#drawing').clientWidth;
  if (Math.abs(w - lastW) > 40) { lastW = w; if (!state.quiz) render(); }
});
