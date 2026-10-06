// One command to check a change, sized to the change.
//
//   node tools/check.mjs              what changed since main: the tests and the walk sections it touches
//   node tools/check.mjs --full       every test and the whole walk (before pushing to main)
//   node tools/check.mjs --since HEAD what changed since the last commit only
//   node tools/check.mjs --walk core,home   these walk sections, plus the tests for what changed
//   node tools/check.mjs --no-walk    tests only; --no-tests for the walk only; --walk all for every section
//   node tools/check.mjs --plan       say what it would run, run nothing
//
// It builds the site when the app, the engine or the catalog changed, starts the local
// server when it isn't up, and prints one line per step with only what failed. Everything
// else goes to out/check/: the full test and walk output and the walk's screenshots.
// Exit code 0 when all passed.

import { execSync, spawnSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'out', 'check');
mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : null; };
const has = (k) => args.includes(`--${k}`);
const sh = (c) => execSync(c, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

// ---------- What changed ----------
const since = opt('since') || 'origin/main';
let changed = [];
try {
  const base = sh(`git merge-base ${since} HEAD`);
  changed = sh(`git diff --name-only ${base}`).split('\n');
} catch { changed = sh('git diff --name-only HEAD').split('\n'); }
try { changed.push(...sh('git ls-files --others --exclude-standard').split('\n')); } catch { /* none */ }
changed = [...new Set(changed.filter(Boolean))];

const ALL_TESTS = readdirSync(join(ROOT, 'test')).filter((f) => f.endsWith('.test.js')).map((f) => `test/${f}`);
// 300 random walls, about 80 s: only in --full, or when the engine itself changed.
const SLOW = new Set(['test/properties.test.js']);
const SECTIONS = ['core', 'desktop', 'print', 'images', 'camera', 'photo', 'home', 'pieces', 'society6', 'browse', 'oct5', 'otherwall', 'homeget', 'app'];

// Which tests and walk sections each kind of file reaches. First match wins per file.
const RULES = [
  [/^engine\//, { tests: 'all', slow: true, walk: ['core', 'oct5'] }],
  [/^web\/(detect|photo|camera|segcore|segment)\.js$/, { tests: ['detect', 'scale', 'segcore', 'furniture_split', 'photo', 'camera', 'jason_bedroom', 'jason_read'], walk: ['camera', 'photo', 'otherwall'] }],
  [/^web\/(framers|printers)\.js$/, { tests: ['framers', 'printers'], walk: ['print', 'oct5'] }],
  [/^web\/store\.js$/, { tests: [], walk: ['core', 'home', 'homeget'] }],
  [/^web\/draw\.js$/, { tests: [], walk: ['core', 'society6', 'oct5'] }],
  [/^web\/(main\.js|site\.css|index\.html|social\.js)$/, { tests: [], walk: ['core', 'oct5'] }],
  [/^demo\/(catalog\.json|samples\.js)$/, { tests: ['catalog_health', 'metadata', 'mats', 'engine', 'taste_vision', 'subjects'], walk: ['core', 'society6'] }],
  [/^fixtures\//, { tests: 'all', walk: [] }],
  [/^tools\/check_catalog\.mjs$/, { tests: ['catalog_health'], walk: [] }],
  [/^server\/app\.sql$/, { tests: ['app_schema'], walk: [] }],
  [/^web\/(account|app-entry|app-global|app\.config)\.js$/, { tests: [], walk: ['app'] }],
  [/^tools\/ui_walk\.py$/, { tests: [], walk: 'all' }],
  [/^tools\/build_site\.mjs$/, { tests: [], walk: ['core'] }],
  [/^test\/.+\.test\.js$/, { tests: 'self', walk: [] }],
];

let tests = new Set(), walk = new Set(), slow = false, build = false;
for (const f of changed) {
  const r = RULES.find(([re]) => re.test(f));
  if (/^(web|engine|demo)\//.test(f) || f === 'tools/build_site.mjs') build = true;
  if (!r) continue;
  const { tests: t, walk: w, slow: s } = r[1];
  if (t === 'all') ALL_TESTS.forEach((x) => tests.add(x));
  else if (t === 'self') tests.add(f);
  else t.forEach((n) => tests.add(`test/${n}.test.js`));
  if (w === 'all') SECTIONS.forEach((x) => walk.add(x)); else w.forEach((x) => walk.add(x));
  if (s) slow = true;
}
if (has('full')) { tests = new Set(ALL_TESTS); slow = true; walk = new Set(SECTIONS); build = true; }
if (opt('walk')) { walk = new Set(opt('walk') === 'all' ? SECTIONS : opt('walk').split(',')); build = true; }
if (has('no-walk')) walk = new Set();
if (has('no-tests')) tests = new Set();
tests = [...tests].filter((t) => ALL_TESTS.includes(t) && (slow || !SLOW.has(t)));
walk = SECTIONS.filter((s) => walk.has(s));

const line = (s) => process.stdout.write(`${s}\n`);
line(`Changed: ${changed.length ? changed.slice(0, 8).join(', ') + (changed.length > 8 ? `, and ${changed.length - 8} more` : '') : 'nothing'} (since ${since})`);
if (!tests.length && !walk.length) { line('Nothing to check.'); process.exit(0); }
if (has('plan')) { line(`Would run ${tests.length} test files${slow ? ' (with the 300 random walls)' : ''}: ${tests.map((t) => t.slice(5, -8)).join(', ') || 'none'}`); line(`Walk sections: ${walk.join(', ') || 'none'}${build ? ', after a build' : ''}`); process.exit(0); }
let ok = true;
const t0 = Date.now();
const secs = (t) => `${Math.round((Date.now() - t) / 1000)}s`;

// ---------- Tests: summary line, failing names only ----------
if (tests.length) {
  const t = Date.now();
  const r = spawnSync('node', ['--test', ...tests], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  writeFileSync(join(OUT, 'tests.log'), out);
  const n = (k) => Number((out.match(new RegExp(`^# ${k} (\\d+)`, 'm')) || [])[1] || 0);
  const failed = [...out.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((m) => m[1]).filter((x) => !/^test\//.test(x));
  line(`Tests: ${n('pass')} of ${n('tests')} passed in ${secs(t)} (${tests.length === ALL_TESTS.length ? 'all files' : `${tests.length} files`}${slow ? '' : ', without the 300 random walls'})`);
  for (const f of failed.slice(0, 12)) line(`  FAIL ${f}`);
  if (r.status !== 0 || n('fail')) ok = false;
}

// ---------- Build and serve ----------
if (walk.length) {
  if (build) {
    const t = Date.now();
    const env = { ...process.env, PATH: `${join(ROOT, 'node_modules', '.bin')}:${process.env.PATH}` };
    // Both sites: the free one, and the app (accounts on), from the same code.
    const r = spawnSync('node', ['tools/build_site.mjs'], { cwd: ROOT, encoding: 'utf8', env });
    const ra = r.status === 0 ? spawnSync('node', ['tools/build_site.mjs', '--app'], { cwd: ROOT, encoding: 'utf8', env }) : r;
    if (r.status !== 0 || ra.status !== 0) { line(`Build FAILED:\n${(ra.stderr || ra.stdout || r.stderr || r.stdout).slice(0, 800)}`); process.exit(1); }
    line(`Build: ${(r.stdout.match(/docs\/index\.html [\d.]+ MB/) || ['done'])[0]} in ${secs(t)}`);
  }
  const up = () => { try { sh('curl -s -o /dev/null -w "%{http_code}" http://localhost:8830/'); return true; } catch { return false; } };
  if (!up()) {
    spawn('python3', ['-m', 'http.server', '8830'], { cwd: join(ROOT, 'docs'), detached: true, stdio: 'ignore' }).unref();
    for (let i = 0; i < 20 && !up(); i++) execSync('sleep 0.3');
  }
  // ---------- Walk: only the sections this change reaches ----------
  const t = Date.now();
  const r = spawnSync('python3', ['tools/ui_walk.py', join(OUT, 'walk'), '--only', walk.join(','), '--quiet'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  writeFileSync(join(OUT, 'walk.log'), out);
  const sum = (out.match(/(\d+) of (\d+) passed/) || []);
  line(`Walk (${walk.join(', ')}): ${sum[0] || 'did not finish'} in ${secs(t)}`);
  for (const f of out.split('\n').filter((l) => l.startsWith('FAIL')).slice(0, 12)) line(`  ${f}`);
  if (!sum[0]) { line(out.split('\n').filter(Boolean).slice(-6).map((l) => `  ${l}`).join('\n')); ok = false; }
  else if (Number(sum[1]) !== Number(sum[2])) ok = false;
}
line(`${ok ? 'All passed' : 'FAILED'} in ${secs(t0)}. Full output: out/check/`);
process.exit(ok ? 0 : 1);
