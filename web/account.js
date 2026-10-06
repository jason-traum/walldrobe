// Accounts, profiles and the feed, for the app site only (built with --app).
// Talks to Walldrobe's own Supabase project (server/app.sql) with the publishable key; every
// write is checked there against who is signed in. Nothing here runs on the free site.

import { createClient } from '@supabase/supabase-js';
import { APP_CONFIG } from './app.config.js';

export const PAGE = 12;
const WAIT_MS = 15000;
let sb = null;
// Configured once Walldrobe's Supabase project exists (web/app.config.js).
export const ready = () => !!(APP_CONFIG.url && APP_CONFIG.key);
function client() {
  if (!ready()) throw new Error('Sign-in is not set up yet');
  if (!sb) sb = createClient(APP_CONFIG.url, APP_CONFIG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } });
  return sb;
}
const plain = (e) => {
  const m = String((e && e.message) || e || 'Something went wrong');
  if (/duplicate key.*handle/i.test(m)) return 'That name is taken';
  if (/handle/i.test(m) && /check/i.test(m)) return 'Use 3 to 24 lowercase letters, numbers or _';
  if (/Failed to fetch|NetworkError|timed? ?out/i.test(m)) return 'No connection. Try again';
  if (/schema cache|does not exist/i.test(m)) return 'This isn\'t set up yet. Try again later';
  return m.replace(/\s+/g, ' ').slice(0, 160);
};
async function run(p) {
  let timer;
  try {
    const r = await Promise.race([p, new Promise((_, no) => { timer = setTimeout(() => no(new Error('timed out')), WAIT_MS); })]);
    if (r && r.error) throw r.error;
    return r ? r.data : null;
  } catch (e) { throw new Error(plain(e)); } finally { clearTimeout(timer); }
}

// ---------- Sign in ----------
let me = null; // { id, email, profile }
export const current = () => me;
export async function start(onChange) {
  if (!ready()) return null;
  const c = client();
  const load = async (session) => {
    if (!session) { me = null; return; }
    const profile = await run(c.from('profiles').select('*').eq('id', session.user.id).maybeSingle()).catch(() => null);
    me = { id: session.user.id, email: session.user.email || '', profile };
  };
  const { data } = await c.auth.getSession();
  await load(data && data.session);
  c.auth.onAuthStateChange((event, session) => { if (event === 'TOKEN_REFRESHED') return; load(session).then(() => onChange && onChange(me)); });
  return me;
}
const backTo = () => `${location.origin}${location.pathname}`;
export async function signInGoogle(hash = '#/me') {
  try { sessionStorage.setItem('walldrobe.after', hash); } catch { /* fine */ }
  await run(client().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: backTo() } }));
}
export async function signInEmail(email, hash = '#/me') {
  try { sessionStorage.setItem('walldrobe.after', hash); } catch { /* fine */ }
  await run(client().auth.signInWithOtp({ email, options: { emailRedirectTo: backTo() } }));
}
// Where to go after the sign-in round trip.
export function afterSignIn() { try { const h = sessionStorage.getItem('walldrobe.after'); sessionStorage.removeItem('walldrobe.after'); return h; } catch { return null; } }
export async function signOut() { await run(client().auth.signOut()); me = null; }
export const emailReady = () => !!APP_CONFIG.email;

// ---------- Profiles ----------
export async function updateProfile(fields) {
  const p = await run(client().from('profiles').update(fields).eq('id', me.id).select().single());
  me = { ...me, profile: p };
  return p;
}
export const profileByHandle = (h) => run(client().from('profiles').select('*').eq('handle', String(h).toLowerCase()).maybeSingle());
export async function followCounts(id) {
  const c = client();
  const [a, b] = await Promise.all([
    run(c.from('follows').select('followee', { count: 'exact', head: true }).eq('followee', id).then((r) => ({ data: r.count, error: r.error }))),
    run(c.from('follows').select('follower', { count: 'exact', head: true }).eq('follower', id).then((r) => ({ data: r.count, error: r.error }))),
  ]);
  return { followers: a || 0, following: b || 0 };
}
export async function isFollowing(id) {
  if (!me) return false;
  const r = await run(client().from('follows').select('followee').eq('follower', me.id).eq('followee', id).maybeSingle());
  return !!r;
}
export const follow = (id) => run(client().from('follows').insert({ followee: id }));
export const unfollow = (id) => run(client().from('follows').delete().eq('follower', me.id).eq('followee', id));

// ---------- Walls ----------
const WALL_COLS = 'id, owner, client_id, name, room, note, body, photo, is_public, show_photo, shared_at, updated_at';
// Your wall, kept under its id on this device (client_id), made or updated.
export async function putWall(w) {
  const row = { client_id: w.clientId, name: w.name || '', room: w.room || '', note: w.note || '', body: w.body, photo: w.showPhoto ? w.photo || null : null, is_public: !!w.isPublic, show_photo: !!w.showPhoto };
  return run(client().from('walls').upsert({ ...row }, { onConflict: 'owner,client_id' }).select(WALL_COLS).single());
}
export const myWalls = () => run(client().from('walls').select(WALL_COLS).eq('owner', me.id).order('updated_at', { ascending: false }).limit(100));
export const deleteWall = (id) => run(client().from('walls').delete().eq('id', id));
export const getWall = (id) => run(client().from('walls').select(`${WALL_COLS}, profiles!walls_owner_fkey(handle, name, avatar_url)`).eq('id', id).maybeSingle());
export const wallsOf = (owner) => run(client().from('walls').select(WALL_COLS).eq('owner', owner).eq('is_public', true).order('shared_at', { ascending: false }).limit(60));
// The feed: everyone's shared walls, or only people you follow, newest first.
export async function feed({ following = false, before = null } = {}) {
  const c = client();
  let q = c.from('walls').select(`${WALL_COLS}, profiles!walls_owner_fkey(handle, name, avatar_url)`).eq('is_public', true).order('shared_at', { ascending: false }).limit(PAGE);
  if (before) q = q.lt('shared_at', before);
  if (following) {
    if (!me) return [];
    const ids = (await run(c.from('follows').select('followee').eq('follower', me.id).limit(500))).map((r) => r.followee);
    if (!ids.length) return [];
    q = q.in('owner', ids);
  }
  return run(q);
}
export async function saveCounts(ids) {
  if (!ids.length) return new Map();
  const rows = await run(client().rpc('save_counts', { ids }));
  return new Map((rows || []).map((r) => [r.wall_id, Number(r.n)]));
}
export async function mySaves() {
  if (!me) return new Set();
  return new Set((await run(client().from('wall_saves').select('wall_id').eq('user_id', me.id).limit(500))).map((r) => r.wall_id));
}
export const saveWall = (id) => run(client().from('wall_saves').insert({ wall_id: id }));
export const unsaveWall = (id) => run(client().from('wall_saves').delete().eq('user_id', me.id).eq('wall_id', id));
export async function savedWalls() {
  if (!me) return [];
  const ids = [...await mySaves()];
  if (!ids.length) return [];
  return run(client().from('walls').select(`${WALL_COLS}, profiles!walls_owner_fkey(handle, name, avatar_url)`).in('id', ids));
}
// ---------- The full plan ----------
// Paying isn't open yet: Unlock records that you asked (where from, and the price shown),
// once per place you asked from. web/app.config.js says when it opens and the price.
const P = APP_CONFIG.plan || {};
export const plan = { open: !!P.open, price: typeof P.price === 'string' ? P.price : '' };
export const wantPlan = (from, price = '') => run(client().from('plan_interest').insert({ asked_from: String(from || '').slice(0, 20), price: String(price || '').slice(0, 40) })
  .then((r) => (r.error && r.error.code === '23505' ? { data: null, error: null } : r)));
export async function askedPlan() {
  if (!me) return false;
  const rows = await run(client().from('plan_interest').select('asked_from').eq('user_id', me.id).limit(1));
  return !!(rows && rows.length);
}
export const report = (id, reason) => run(client().from('reports').insert({ wall_id: id, reason: String(reason || '').slice(0, 120) }));
