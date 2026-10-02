// Saving on this device. There are no accounts yet, so walls live in this
// browser's storage: the wall in progress, and the walls you saved. Photos stay
// here too and never leave the device. With ?demo in the address, nothing is saved.

const DRAFT = 'walldrobe.draft.v1';
const WALLS = 'walldrobe.walls.v1';

export const demoMode = (() => {
  try { return new URLSearchParams(location.search).has('demo'); } catch { return false; }
})();

function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}

// Returns true when it saved. A full storage is the likely failure (photos are big).
function write(key, value) {
  if (demoMode) return true;
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export const loadDraft = () => read(DRAFT, null);
export const saveDraft = (d) => write(DRAFT, d);
export function clearDraft() { if (demoMode) return; try { localStorage.removeItem(DRAFT); } catch { /* nothing to clear */ } }

export const listWalls = () => read(WALLS, []);
export function saveWall(w) {
  const all = listWalls().filter((x) => x.id !== w.id);
  all.unshift({ ...w, savedAt: new Date().toISOString() });
  return write(WALLS, all);
}
export function deleteWall(id) { return write(WALLS, listWalls().filter((x) => x.id !== id)); }
export function renameWall(id, name) { return write(WALLS, listWalls().map((x) => (x.id === id ? { ...x, name } : x))); }
export const getWall = (id) => listWalls().find((x) => x.id === id) || null;

export const newId = () => `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// You, apart from any one wall: the pieces you saved, the ones you swapped
// away, and art you own that isn't up anywhere yet. Every wall reads from this.
const ME = 'walldrobe.me.v1';
export const loadMe = () => { const m = read(ME, null) || {}; return { saved: m.saved || [], skipped: m.skipped || [], art: m.art || [] }; };
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
