// Saving on this device. There are no accounts yet, so walls live in this
// browser's storage: the wall in progress, and the walls you saved. Photos stay
// here too and never leave the device. With ?demo in the address, nothing is saved.

const DRAFT = 'walldrobe.draft.v1';
const WALLS = 'walldrobe.walls.v1';

export const demoMode = (() => {
  try { return new URLSearchParams(location.search).has('demo'); } catch { return false; }
})();

// Photos (and thumbnails cut from them) are big, and every saved copy of a wall
// carries the same ones. So each image is kept once, under its own key, and the
// wall keeps a short reference to it. Safari gives a site about 5 MB in all.
const BLOB = 'walldrobe.img.';
const BIG = 2000; // characters: a string longer than this (a photo, the photo's labels) is kept on its own
function hashOf(str) {
  let h1 = 0x811c9dc5, h2 = 0x1000193;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 + c, 2654435761); }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}${str.length.toString(36)}`;
}
const keyCache = new Map(); // the same photo string is saved on every change: hash it once
// Swap big strings for { $img: key }, writing each image once. Returns null if storage is full.
function pack(v, out) {
  if (typeof v === 'string') {
    if (v.length <= BIG) return v;
    let key = keyCache.get(v);
    if (!key) { key = BLOB + hashOf(v); keyCache.set(v, key); if (keyCache.size > 64) keyCache.delete(keyCache.keys().next().value); }
    out.add(key);
    try { if (localStorage.getItem(key) === null) localStorage.setItem(key, v); } catch { out.full = true; }
    return { $img: key };
  }
  if (Array.isArray(v)) return v.map((x) => pack(x, out));
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = pack(x, out); return o; }
  return v;
}
function unpack(v) {
  if (Array.isArray(v)) return v.map(unpack);
  if (v && typeof v === 'object') {
    if (typeof v.$img === 'string' && Object.keys(v).length === 1) { try { return localStorage.getItem(v.$img); } catch { return null; } }
    const o = {}; for (const [k, x] of Object.entries(v)) o[k] = unpack(x); return o;
  }
  return v;
}
function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? unpack(JSON.parse(v)) : fallback; } catch { return fallback; }
}

// Returns true when it saved. A full storage is the likely failure (photos are big).
function write(key, value) {
  if (demoMode) return true;
  const used = new Set();
  const packed = pack(value, used);
  if (used.full) { sweep(); return false; }
  try { localStorage.setItem(key, JSON.stringify(packed)); } catch { sweep(); return false; }
  if (used.size) sweep();
  return true;
}
// Images no wall points at any more are removed.
function sweep() {
  try {
    const live = new Set();
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('walldrobe.') && !k.startsWith(BLOB)) keys.push(k); }
    for (const k of keys) { const raw = localStorage.getItem(k); if (raw) for (const m of raw.matchAll(/"\$img":"([^"]+)"/g)) live.add(m[1]); }
    for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith(BLOB) && !live.has(k)) localStorage.removeItem(k); }
  } catch { /* nothing to sweep */ }
}

export const loadDraft = () => read(DRAFT, null);
export const saveDraft = (d) => write(DRAFT, d);
export function clearDraft() { if (demoMode) return; try { localStorage.removeItem(DRAFT); } catch { /* nothing to clear */ } sweep(); }

export const listWalls = () => read(WALLS, []);
export function saveWall(w) {
  const all = listWalls().filter((x) => x.id !== w.id);
  all.unshift({ ...w, savedAt: new Date().toISOString() });
  return write(WALLS, all);
}
// A saved wall is a copy: every Save adds one, and nothing later changes it.
export function addWall(w) {
  const all = listWalls();
  all.unshift({ ...w, savedAt: new Date().toISOString() });
  return write(WALLS, all);
}
export function deleteWall(id) { const ok = write(WALLS, listWalls().filter((x) => x.id !== id)); sweep(); return ok; }
export function renameWall(id, name) { return write(WALLS, listWalls().map((x) => (x.id === id ? { ...x, name } : x))); }
export const getWall = (id) => listWalls().find((x) => x.id === id) || null;

export const newId = () => `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// You, apart from any one wall: the pieces you saved, the ones you swapped
// away, and art you own that isn't up anywhere yet. Every wall reads from this.
const ME = 'walldrobe.me.v1';
export const loadMe = () => { const m = read(ME, null) || {}; return { saved: m.saved || [], skipped: m.skipped || [], art: m.art || [], never: m.never || [], disliked: m.disliked || [], quizSeen: m.quizSeen || [], name: m.name || '' }; };
export const saveMe = (m) => write(ME, m);

// What people do, kept on this device so Walldrobe can learn from everyone
// later (PRODUCT.md, "Learning from everyone"): saves, swaps, skips, keeps,
// pins, walls opened, quiz picks, browse filters. Piece ids and wall keys only:
// never a photo, never a name or anything typed. The newest 2,000 are kept.
// Nothing is written in ?demo, and nothing is sent anywhere yet.
const EVENTS = 'walldrobe.events.v1';
export const EVENTS_CAP = 2000;
// Plain values only: a long string or a data URL (a photo) is dropped, whatever the caller passed.
function plain(v) {
  if (typeof v === 'string') return v.length <= 200 && !/^data:/i.test(v) ? v : undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'boolean' || v === null) return v;
  if (Array.isArray(v)) return v.map(plain).filter((x) => x !== undefined).slice(0, 40);
  return undefined;
}
export function logEvent(type, data = {}) {
  if (demoMode || !type) return false;
  const ev = { t: new Date().toISOString(), type: String(type) };
  for (const [k, v] of Object.entries(data || {})) { if (k === 't' || k === 'type') continue; const p = plain(v); if (p !== undefined) ev[k] = p; }
  const list = read(EVENTS, []);
  const all = Array.isArray(list) ? list : [];
  all.push(ev);
  if (all.length > EVENTS_CAP) all.splice(0, all.length - EVENTS_CAP);
  return write(EVENTS, all);
}
export const listEvents = () => { const l = read(EVENTS, []); return Array.isArray(l) ? l : []; };
export function clearEvents() { if (demoMode) return; try { localStorage.removeItem(EVENTS); } catch { /* nothing to clear */ } }

// Walls people shared: before, after, the others they considered, the pieces.
// For now they live on this device; the public feed comes with the server.
const SHARED = 'walldrobe.shared.v1';
export const listShared = () => read(SHARED, []);
export function addShared(post) { const all = listShared().filter((x) => x.id !== post.id); all.unshift(post); return write(SHARED, all); }
export function removeShared(id) { return write(SHARED, listShared().filter((x) => x.id !== id)); }
