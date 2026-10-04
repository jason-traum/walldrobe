// Drawing a wall to scale as SVG, in inches with the floor at the bottom. Used
// on every screen that shows a wall: the home page, marking what's in the way,
// the layouts and the hanging guide.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function inches(v) {
  const whole = Math.floor(v + 1e-9);
  const frac = Math.round((v - whole) * 4);
  const f = ['', '¼', '½', '¾'][frac] || '';
  return `${frac === 4 ? whole + 1 : whole}${frac === 4 ? '' : f} in`;
}
export function feet(v) {
  const ft = Math.floor(v / 12), inch = Math.round(v - ft * 12);
  if (inch === 12) return `${ft + 1} ft`;
  return inch ? `${ft} ft ${inch} in` : `${ft} ft`;
}

export const KIND_NAME = {
  couch: 'Couch', headboard: 'Bed', dresser: 'Dresser', console: 'Console', window: 'Window', door: 'Door',
  tv: 'TV', outlet: 'Outlet', switch: 'Switch', lamp: 'Lamp', plant: 'Plant', shelf: 'Shelf', furniture: 'Furniture', mirror: 'Mirror', edge: 'Wall edge',
};
export const obName = (o) => o.label || KIND_NAME[o.kind] || o.kind;

function furniture(o, H) {
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
      const bedH = Math.min(21, o.h * 0.55);
      return `<g class="furn bed">
        <rect x="${o.x}" y="${y}" width="${o.w}" height="${o.h - 4}" rx="1.5" class="wood"/>
        <rect x="${o.x + 1.5}" y="${y + 1.5}" width="${o.w - 3}" height="${o.h - 7}" rx="1" class="wood-2"/>
        <rect x="${o.x - 3}" y="${H - bedH}" width="${o.w + 6}" height="${bedH - 4}" rx="2.5" class="bedding"/>
        <rect x="${o.x - 3}" y="${H - bedH * 0.55}" width="${o.w + 6}" height="${bedH * 0.55 - 4}" rx="1" class="bedding-2"/>
        <rect x="${o.x - 2}" y="${H - 4}" width="${o.w + 4}" height="4" class="wood"/>
        <rect x="${o.x + 6}" y="${H - bedH - 6}" width="${o.w / 2 - 10}" height="8" rx="3.5" class="pillow"/>
        <rect x="${o.x + o.w / 2 + 4}" y="${H - bedH - 6}" width="${o.w / 2 - 10}" height="8" rx="3.5" class="pillow"/>
      </g>`;
    }
    case 'dresser': case 'sideboard': case 'console': case 'credenza': {
      const hh = o.h - 3;
      const lines = [1, 2].map((i) => `<rect x="${o.x + 1.2}" y="${y + (hh / 3) * i - 0.25}" width="${o.w - 2.4}" height="0.5" class="wood-2"/>`).join('');
      return `<g class="furn case"><rect x="${o.x}" y="${y}" width="${o.w}" height="${hh}" rx="0.8" class="wood"/>${lines}<rect x="${o.x + 1}" y="${H - 3}" width="1.2" height="3" class="wood"/><rect x="${o.x + o.w - 2.2}" y="${H - 3}" width="1.2" height="3" class="wood"/></g>`;
    }
    case 'lamp': {
      const cx = o.x + o.w / 2;
      return `<g class="furn lamp">
        <rect x="${cx - 0.4}" y="${y + 9}" width="0.8" height="${H - y - 9}" class="metal"/>
        <rect x="${o.x + 2.5}" y="${H - 1}" width="${o.w - 5}" height="1" rx="0.5" class="metal"/>
        <path d="M${o.x + 1.5} ${y + 10} L${o.x + 3.2} ${y} L${o.x + o.w - 3.2} ${y} L${o.x + o.w - 1.5} ${y + 10} Z" class="shade"/>
      </g>`;
    }
    case 'plant': {
      const cx = o.x + o.w / 2, pot = Math.min(12, o.h * 0.3);
      return `<g class="furn plant">
        <rect x="${cx - o.w * 0.22}" y="${H - pot}" width="${o.w * 0.44}" height="${pot}" rx="1.5" class="furn-dark"/>
        <ellipse cx="${cx}" cy="${y + (o.h - pot) / 2}" rx="${o.w / 2}" ry="${(o.h - pot) / 2}" class="leaf"/>
      </g>`;
    }
    case 'window':
      return `<g class="window"><rect ${base}/><line x1="${o.x + o.w / 2}" x2="${o.x + o.w / 2}" y1="${y}" y2="${y + o.h}"/><line x1="${o.x}" x2="${o.x + o.w}" y1="${y + o.h / 2}" y2="${y + o.h / 2}"/></g>`;
    case 'door':
      return `<g class="furn door"><rect ${base}/><circle cx="${o.x + o.w - 4}" cy="${y + o.h * 0.52}" r="1.2" class="furn-dark"/></g>`;
    case 'tv':
      return `<g class="tv"><rect ${base} rx="1"/></g>`;
    case 'outlet': case 'switch':
      return `<rect ${base} rx="0.4" class="fixture"/>`;
    // A corner or step in the wall: a line from floor to ceiling. Art doesn't cross it.
    case 'edge':
      return `<line x1="${o.x + o.w / 2}" y1="${y}" x2="${o.x + o.w / 2}" y2="${y + o.h}" class="wall-edge"/>`;
    default:
      return `<rect ${base} class="furn"/>`;
  }
}

// ---------- Painter's tape ----------
// Proposed pieces are drawn the way people mock up a wall: blue tape at true
// width (1.41 in, the standard roll), a hair off square, torn at the ends.
// Green tape is a new piece kept in every wall; an orange strip across a
// corner is a piece of yours that stays where it hangs. Seeded by the piece's
// id, so the same piece always tears the same way.

const TAPE_W = 1.41, LAP = 1.4;
function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}
// A strip from (x1,y1) to (x2,y2). Torn ends jag a little along the strip.
function strip(x1, y1, x2, y2, rnd, { tornA = true, tornB = true, cls = 'tape' } = {}) {
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L, nx = -uy, ny = ux, h = TAPE_W / 2;
  const end = (sx, sy, dir, torn) => {
    const n = torn ? 5 : 1, pts = [];
    for (let i = 0; i <= n; i++) {
      const t = -h + (TAPE_W * i) / n;
      const d = torn && i > 0 && i < n ? (0.1 + rnd() * 0.22) * dir : 0;
      pts.push([sx + nx * t + ux * d, sy + ny * t + uy * d]);
    }
    return pts;
  };
  const a = end(x1, y1, 1, tornA), b = end(x2, y2, -1, tornB).reverse();
  const d = [...a, ...b].map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join('') + 'Z';
  const rot = ((rnd() < 0.5 ? -1 : 1) * (0.15 + rnd() * 0.5)).toFixed(2);
  return `<path d="${d}" class="${cls}" transform="rotate(${rot} ${((x1 + x2) / 2).toFixed(2)} ${((y1 + y2) / 2).toFixed(2)})"/>`;
}
// Four strips around a frame. The sides go on first and tuck under the top and
// bottom, so each corner shows one torn end, not four.
export function tapeFrame(x, y, w, h, id, cls = 'tape') {
  const rnd = seeded(String(id));
  return [
    strip(x, y + 0.2, x, y + h - 0.2, rnd, { tornA: false, tornB: false, cls }),
    strip(x + w, y + 0.2, x + w, y + h - 0.2, rnd, { tornA: false, tornB: false, cls }),
    strip(x - LAP, y, x + w + LAP, y, rnd, { cls }),
    strip(x - LAP, y + h, x + w + LAP, y + h, rnd, { cls }),
  ].join('');
}
// A new print is taped up unframed: a torn tab across each corner (two at the
// top, two more at the bottom on anything taller than 20 in), at the real
// roll's width but never under 5 px on screen, so it reads on a phone.
function tab(cx, cy, len, w, ang, rnd, cls) {
  const n = 4, pts = [];
  for (let i = 0; i <= n; i++) pts.push([-len / 2 + (i > 0 && i < n ? rnd() * 0.22 * w : 0), -w / 2 + (w * i) / n]);
  for (let i = 0; i <= n; i++) pts.push([len / 2 - (i > 0 && i < n ? rnd() * 0.22 * w : 0), w / 2 - (w * i) / n]);
  const a = (ang * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
  return `<polygon points="${pts.map(([x, y]) => `${(cx + x * c - y * sn).toFixed(2)},${(cy + x * sn + y * c).toFixed(2)}`).join(' ')}" class="${cls}"/>`;
}
export function tapeTabs(x, y, w, h, id, cls = 'tape', ppi = 4) {
  const rnd = seeded(String(id));
  const tw = Math.max(TAPE_W, 5 / ppi), tl = Math.max(3.2, 15 / ppi);
  const j = () => (rnd() - 0.5) * 10;
  const out = [tab(x, y, tl, tw, -42 + j(), rnd, cls), tab(x + w, y, tl, tw, 42 + j(), rnd, cls)];
  if (h > 20) out.push(tab(x, y + h, tl, tw, 42 + j(), rnd, cls), tab(x + w, y + h, tl, tw, -42 + j(), rnd, cls));
  return out.join('');
}
// One short strip across the top left corner: this one stays where it hangs.
function pinStrip(x, y, id) {
  const rnd = seeded(`${id}-pin`);
  const k = 6;
  return strip(x - 2.2, y + k * 0.75, x + k * 0.75, y - 2.2, rnd, { cls: 'tape-pin' });
}

// One piece. `img` is the art, cropped to the opening, never stretched.
// kind: 'own' (a frame of yours), 'pin' (yours, stays put), 'new' (blue tape),
// 'kept' (green tape).
// The title shown on the paper while its image loads, or if it never does: at least
// 10 px on screen, cut to what fits the paper's width.
function waitTitle(title, cx, cy, iw, ppi) {
  const fs = Math.max(10 / (ppi || 3), Math.min(2.4, iw / 8));
  const fit = Math.max(3, Math.floor(iw / (fs * 0.56)));
  // Up to two lines, broken at spaces; only what still doesn't fit is cut.
  const words = String(title || '').split(/\s+/).filter(Boolean);
  const lines = [''];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if (!cur) lines[lines.length - 1] = w;
    else if (`${cur} ${w}`.length <= fit) lines[lines.length - 1] = `${cur} ${w}`;
    else if (lines.length < 2) lines.push(w);
    else { lines[1] = `${lines[1]} ${w}`; }
  }
  const cut = (t) => (t.length > fit ? `${t.slice(0, fit - 1).trimEnd()}.` : t);
  const shown = lines.map(cut);
  const lh = fs * 1.2, y0 = cy - ((shown.length - 1) * lh) / 2;
  return `<text x="${cx}" y="${y0}" font-size="${fs}" class="art-wait">${shown.map((t, i) => `<tspan x="${cx}" dy="${i ? lh : 0}">${esc(t)}</tspan>`).join('')}</text>`;
}
function framed(p, H, img, { kind, selected, fallback, still, frames, art, ppi, printFor }) {
  const y = H - p.y - p.h;
  const sel = `<rect x="${p.x - 2}" y="${y - 2}" width="${p.w + 4}" height="${p.h + 4}" class="select-ring"/>`;
  const label = still ? '' : `tabindex="0" role="button" aria-label="${esc(p.title)}, ${p.w} by ${p.h} inches"`;
  const cls = `art${selected ? ' is-selected' : ''} is-${kind}`;
  if (kind === 'own' || kind === 'pin') {
    // A photo of your piece shows its own frame; without one it's drawn framed, in its main color.
    const f = 0.9, m = Math.min(p.w, p.h) >= 12 ? 1.5 : 1;
    const mm = Math.min(p.w, p.h) * 0.1;
    const inner = img && art
      ? `<rect x="${p.x}" y="${y}" width="${p.w}" height="${p.h}" class="frame" filter="url(#wd-shadow)"/><rect x="${p.x + f}" y="${y + f}" width="${p.w - 2 * f}" height="${p.h - 2 * f}" class="mat"/><image href="${img}" x="${p.x + f + mm}" y="${y + f + mm}" width="${p.w - 2 * (f + mm)}" height="${p.h - 2 * (f + mm)}" preserveAspectRatio="xMidYMid slice"/>`
      : img
      ? `<image href="${img}" x="${p.x}" y="${y}" width="${p.w}" height="${p.h}" preserveAspectRatio="xMidYMid slice"/>`
      : `<rect x="${p.x}" y="${y}" width="${p.w}" height="${p.h}" class="frame"/><rect x="${p.x + f}" y="${y + f}" width="${p.w - 2 * f}" height="${p.h - 2 * f}" class="mat"/><rect x="${p.x + f + m}" y="${y + f + m}" width="${p.w - 2 * (f + m)}" height="${p.h - 2 * (f + m)}" fill="${fallback || 'var(--swatch)'}"/>`;
    return `<g class="${cls}" data-id="${esc(p.ref.id)}" ${label}>${inner}<rect x="${p.x}" y="${y}" width="${p.w}" height="${p.h}" class="own-edge"/>${kind === 'pin' ? pinStrip(p.x, y, p.ref.id) : ''}${sel}</g>`;
  }
  // Framed the way you picked: the frame, a mat if you want one, the art inside, never stretched.
  if (typeof frames === 'function') frames = frames(p);
  if (frames && (kind === 'new' || kind === 'kept')) {
    const { hex, light, f, m } = frames;
    return `<g class="${cls} is-framed" data-id="${esc(p.ref.id)}" ${label}>
    <rect x="${p.x}" y="${y}" width="${p.w}" height="${p.h}" fill="${hex}"${light ? ' class="frame-light"' : ''}/>
    <rect x="${p.x + f}" y="${y + f}" width="${p.w - 2 * f}" height="${p.h - 2 * f}" class="mat"/>
    ${waitTitle(p.title, p.x + p.w / 2, y + p.h / 2, p.w - 2 * (f + m), ppi)}
    ${img ? `<image href="${img}" x="${p.x + f + m}" y="${y + f + m}" width="${p.w - 2 * (f + m)}" height="${p.h - 2 * (f + m)}" preserveAspectRatio="xMidYMid slice"/>` : ''}
    ${sel}
  </g>`;
  }
  // A new print in its frame, at true size: the frame's moulding, a mat when the print is
  // smaller than the frame, the print, and the tape that says it's new (green when kept).
  if (p.frame && (kind === 'new' || kind === 'kept')) {
    // A piece sold framed is already its outside; draw a standard moulding inside it.
    const b = p.frame.border || Math.min(0.75, Math.min(p.w, p.h) / 10);
    const ow = p.w - 2 * b, oh = p.h - 2 * b;
    const pr = printFor ? printFor(p) : null;
    // A mat's window is a half inch smaller than the print: a quarter inch hides on each side.
    const pw = pr ? Math.min(pr[0] - 0.5, ow) : ow, ph = pr ? Math.min(pr[1] - 0.5, oh) : oh;
    const ix = p.x + b + (ow - pw) / 2, iy = y + b + (oh - ph) / 2;
    return `<g class="${cls} is-framed" data-id="${esc(p.ref.id)}" ${label}>
    <rect x="${p.x}" y="${y}" width="${p.w}" height="${p.h}" class="frame frame-new" filter="url(#wd-shadow)"/>
    <rect x="${p.x + b}" y="${y + b}" width="${ow}" height="${oh}" class="mat"/>
    ${waitTitle(p.title, p.x + p.w / 2, y + p.h / 2, pw, ppi)}
    ${img ? `<image href="${img}" x="${ix}" y="${iy}" width="${pw}" height="${ph}" preserveAspectRatio="xMidYMid slice"/>` : ''}
    ${tapeTabs(p.x, y, p.w, p.h, p.ref.id, kind === 'kept' ? 'tape-keep' : 'tape', ppi)}
    ${sel}
  </g>`;
  }
  const m = Math.min(p.w, p.h) * 0.045;
  return `<g class="${cls}" data-id="${esc(p.ref.id)}" ${label}>
    <rect x="${p.x}" y="${y}" width="${p.w}" height="${p.h}" class="paper" filter="url(#wd-shadow-soft)"/>
    ${waitTitle(p.title, p.x + p.w / 2, y + p.h / 2, p.w - 2 * m, ppi)}
    ${img ? `<image href="${img}" x="${p.x + m}" y="${y + m}" width="${p.w - 2 * m}" height="${p.h - 2 * m}" preserveAspectRatio="xMidYMid slice"/>` : ''}
    ${tapeTabs(p.x, y, p.w, p.h, p.ref.id, kind === 'kept' ? 'tape-keep' : 'tape', ppi)}
    ${sel}
  </g>`;
}

function measures(L, W, H, s) {
  const g = L.group;
  const top = H - (g.y + g.h);
  const bottom = H - g.y;
  const ty = Math.max(s * 1.6, top - s * 1.4);
  const lx = g.x - s * 1.2;
  const nails = L.pieces.filter((p) => p.role !== 'pinned').flatMap((p) => p.nails || [p.nail]).map((n) => `<circle cx="${n.x}" cy="${H - n.y}" r="${s * 0.22}" class="nail"/>`).join('');
  return `<g class="measure">
    <line x1="0" x2="${W}" y1="${H - 57}" y2="${H - 57}" class="centerline"/>
    ${(() => {
      // On the wider side of the group, and only as much text as fits there without touching a print.
      const left = g.x >= W - (g.x + g.w), room = (left ? g.x : W - (g.x + g.w)) - s * 0.8;
      const t = room >= 15 * s * 0.56 ? '57 in to center' : room >= 5 * s * 0.56 ? '57 in' : '';
      return t ? `<text x="${left ? s * 0.4 : W - s * 0.4}" y="${H - 57 - s * 0.35}" font-size="${s}" text-anchor="${left ? 'start' : 'end'}">${t}</text>` : '';
    })()}
    <line x1="${g.x}" x2="${g.x + g.w}" y1="${ty}" y2="${ty}"/>
    <line x1="${g.x}" x2="${g.x}" y1="${ty - s * 0.5}" y2="${ty + s * 0.5}"/>
    <line x1="${g.x + g.w}" x2="${g.x + g.w}" y1="${ty - s * 0.5}" y2="${ty + s * 0.5}"/>
    <text x="${g.x + g.w / 2}" y="${ty - s * 0.45}" text-anchor="middle" font-size="${s}">${esc(inches(g.w))}</text>
    <line x1="${lx}" x2="${lx}" y1="${bottom}" y2="${H}"/>
    <line x1="${lx - s * 0.5}" x2="${lx + s * 0.5}" y1="${bottom}" y2="${bottom}"/>
    ${(() => { const t = inches(g.y), room = lx - s * 0.45 >= t.length * s * 0.58; return `<text x="${room ? lx - s * 0.45 : lx + s * 0.45}" y="${room ? bottom + (H - bottom) / 2 : bottom + s * 1.3}" text-anchor="${room ? 'end' : 'start'}" font-size="${s}">${esc(t)}</text>`; })()}
    ${nails}
  </g>`;
}

// Label size in inches so text is never under 11 px on screen.
export function labelSize(W, pxWide) {
  const px = Math.max(240, pxWide || 600) / (W * 1.05);
  // Never smaller than about 13 px on screen: these are the numbers people drill by.
  return Math.max(W / 34, 13 / px);
}

/**
 * opts: {
 *   wall: { width, height }, obstacles, photo (URL of the flattened wall, or null),
 *   layout (engine layout or null), imageFor(piece) -> URL, ownedFor(id) -> { thumb, color },
 *   selected, measure, pxWide, extra (SVG to add on top), obstacleClass, label
 * }
 */
// The print inside a new piece's frame, [w, h] in inches, or null when it fills the
// frame. Set once by the app, which knows each piece's print.
let PRINT_FOR = null;
export function setPrintFor(fn) { PRINT_FOR = fn; }

export function wallSvg(o) {
  const W = o.wall.width, H = o.wall.height;
  const s = labelSize(W, o.pxWide);
  const pad = s * 0.6;
  const bg = o.photo
    ? `<image href="${o.photo}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#wd-light)"/><rect x="0" y="${H - 3}" width="${W}" height="3" class="baseboard"/>`;
  const defs = `<defs><linearGradient id="wd-light" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="wall-hi"/><stop offset="1" class="wall-lo"/></linearGradient><filter id="wd-shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="0.5" stdDeviation="0.5" flood-color="#5B5245" flood-opacity="0.26"/></filter><filter id="wd-shadow-soft" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="0.25" stdDeviation="0.3" flood-color="#5B5245" flood-opacity="0.18"/></filter></defs>`;
  const ppi = Math.max(240, o.pxWide || 600) / (W + pad * 2);
  // Over a photo, the photo shows the furniture; only outline what was marked.
  const obs = (o.obstacles || []).map((ob) => (o.photo || o.outlines
    ? `<rect x="${ob.x}" y="${H - ob.y - ob.h}" width="${ob.w}" height="${ob.h}" class="ob-outline${o.photo ? '' : ' on-plain'}" data-ob="${esc(ob.id)}"/>`
    : furniture(ob, H))).join('');
  const showObs = o.hideObstacles ? '' : obs;
  const L = o.layout;
  const arts = L ? L.pieces.map((p) => {
    const owned = p.ref.source === 'owned';
    const info = owned && o.ownedFor ? o.ownedFor(p.ref.id) : null;
    const kind = owned ? (p.role === 'pinned' ? 'pin' : 'own') : (o.keptIds && o.keptIds.has(p.ref.id) ? 'kept' : 'new');
    // A pinned piece is still on the wall in the photo: only its strip of tape is drawn.
    if (kind === 'pin' && o.photo) return `<g class="art is-pin" data-id="${esc(p.ref.id)}"${o.still ? '' : ` tabindex="0" role="button" aria-label="${esc(p.title)}, stays where it hangs"`}><rect x="${p.x}" y="${H - p.y - p.h}" width="${p.w}" height="${p.h}" class="hit"/>${pinStrip(p.x, H - p.y - p.h, p.ref.id)}</g>`;
    return framed(p, H, owned ? info && info.thumb : o.imageFor && o.imageFor(p), { kind, selected: p.ref.id === o.selected, fallback: info && info.color, still: !!o.still, frames: o.frames || null, art: !!(info && info.art), ppi, printFor: o.printFor || PRINT_FOR });
  }).join('') : '';
  // A wall you can tap pieces on is a group, so screen readers reach each piece.
  const role = L && !o.still ? 'group' : 'img';
  return `<svg viewBox="${-pad} ${-pad} ${W + pad * 2} ${H + pad * 2}" role="${role}" aria-label="${esc(o.label || 'Wall')}, ${esc(feet(W))} wide and ${esc(feet(H))} tall${L ? `, with ${L.pieces.length} pieces` : ''}" data-w="${W}" data-h="${H}">
    ${defs}
    ${bg}
    ${showObs}
    ${arts}
    ${L && o.measure ? measures(L, W, H, s) : ''}
    ${o.extra || ''}
    ${o.photo || !o.measure ? '' : `<text x="${s * 0.4}" y="${s * 1.1}" font-size="${s}" class="wall-size">${esc(feet(W))} x ${esc(feet(H))}</text>`}
  </svg>`;
}

// Where a pointer event lands on a wall SVG, in wall inches (floor at 0).
export function wallPoint(svg, e) {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  return { x: p.x, y: Number(svg.dataset.h) - p.y };
}
