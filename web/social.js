// Walls people hung: the public feed.
// Reads are open. Every write goes through a wd_ function in Supabase that checks this phone's
// secret (server/walldrobe.sql). Only the publishable key lives here; it can't write anything
// on its own. The secret never leaves this phone except to those functions, which keep only
// its hash.

const BASE = 'https://diewnsccktlwnatpwwzx.supabase.co/rest/v1';
const KEY = 'sb_publishable_J1m54XRWBCGGwrlp54RbyQ_aGZ9taAm';
const SECRET = 'walldrobe.device.v1';
const WAIT_MS = 15000;

export const PAGE = 12;

function secret(make) {
  try {
    let s = localStorage.getItem(SECRET);
    if (!s && make) {
      s = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(SECRET, s);
    }
    return s || null;
  } catch { return null; }
}

async function call(path, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), WAIT_MS);
  try {
    const res = await fetch(`${BASE}/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(plain((data && data.message) || `error ${res.status}`));
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('it took too long');
    if (e instanceof TypeError) throw new Error('no connection');
    throw e;
  } finally { clearTimeout(timer); }
}

function plain(msg) {
  return ({ 'post too big': 'this wall is too big to share', 'too many today': "that's ten shares today from this phone", 'busy, try later': 'the feed is busy, try again in a bit' })[msg] || msg;
}

// A row from the feed, as the same shape the app shares.
function fromRow(r) {
  return { ...r.body, id: `pub-${r.id}`, remote: r.id, at: r.created_at, name: r.name, note: r.note, room: r.room };
}

export async function feed(before) {
  const q = new URLSearchParams({ select: 'id,created_at,name,note,room,body', order: 'created_at.desc', limit: String(PAGE) });
  if (before) q.set('created_at', `lt.${before}`);
  const rows = await call(`wd_posts?${q}`);
  return rows.map(fromRow);
}

export async function mine() {
  const s = secret(false);
  if (!s) return [];
  return call('rpc/wd_mine', { secret: s });
}

export async function share(post) {
  const { id, at, name, note, room, remote, ...body } = post;
  return call('rpc/wd_share', { secret: secret(true), p_name: name || '', p_note: note || '', p_room: room || '', p_body: body });
}

export async function remove(remoteId) {
  const s = secret(false);
  if (!s) return false;
  return call('rpc/wd_remove', { secret: s, post: remoteId });
}

export async function report(remoteId, why) {
  return call('rpc/wd_report', { secret: secret(true), post: remoteId, why: why || '' });
}

// Walls you reported stay hidden on this phone.
const REPORTED = 'walldrobe.reported.v1';
export function reported() { try { return JSON.parse(localStorage.getItem(REPORTED) || '[]'); } catch { return []; } }
export function hideForMe(remoteId) {
  try { localStorage.setItem(REPORTED, JSON.stringify([...new Set([...reported(), remoteId])].slice(-500))); } catch { /* hidden for this visit only */ }
}
