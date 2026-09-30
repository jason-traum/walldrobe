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
