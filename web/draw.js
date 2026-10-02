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
      const bedH = Math.min(24, o.h * 0.6);
      return `<g class="furn">
        <rect ${base} rx="2"/>
        <rect x="${o.x - 2}" y="${H - bedH}" width="${o.w + 4}" height="${bedH}" rx="2" class="bedding"/>
        <rect x="${o.x + 6}" y="${H - bedH - 6}" width="${o.w / 2 - 9}" height="9" rx="3" class="pillow"/>
        <rect x="${o.x + o.w / 2 + 3}" y="${H - bedH - 6}" width="${o.w / 2 - 9}" height="9" rx="3" class="pillow"/>
      </g>`;
    }
    case 'dresser': case 'sideboard': case 'console': case 'credenza': {
      const lines = [1, 2].map((i) => `<line x1="${o.x + 1.5}" x2="${o.x + o.w - 1.5}" y1="${y + (o.h / 3) * i}" y2="${y + (o.h / 3) * i}" class="seam"/>`).join('');
      return `<g class="furn"><rect ${base} rx="1"/>${lines}</g>`;
    }
    case 'lamp': {
      const cx = o.x + o.w / 2;
      return `<g class="furn">
        <line x1="${cx}" x2="${cx}" y1="${H - 1}" y2="${y + 8}" class="pole"/>
        <path d="M${o.x} ${y + 9} L${o.x + 2.5} ${y} L${o.x + o.w - 2.5} ${y} L${o.x + o.w} ${y + 9} Z" class="shade"/>
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
// One short strip across the top left corner: this one stays where it hangs.
function pinStrip(x, y, id) {
  const rnd = seeded(`${id}-pin`);
  const k = 6;
  return strip(x - 2.2, y + k * 0.75, x + k * 0.75, y - 2.2, rnd, { cls: 'tape-pin' });
}

// One piece. `img` is the art, cropped to the opening, never stretched.
// kind: 'own' (a frame of yours), 'pin' (yours, stays put), 'new' (blue tape),
// 'kept' (green tape).
function framed(p, H, img, { kind, selected, fallback, still }) {
  const y = H - p.y - p.h;
  const sel = `<rect x="${p.x - 2}" y="${y - 2}" width="${p.w + 4}" height="${p.h + 4}" class="select-ring"/>`;
  const label = still ? '' : `tabindex="0" role="button" aria-label="${esc(p.title)}, ${p.w} by ${p.h} inches"`;
  const cls = `art${selected ? ' is-selected' : ''} is-${kind}`;
  if (kind === 'own' || kind === 'pin') {
    // A photo of your piece shows its own frame; without one it's drawn framed, in its main color.
    const f = 0.9, m = Math.min(p.w, p.h) >= 12 ? 1.5 : 1;
    const inner = img
      ? `<image href="${img}" x="${p.x}" y="${y}" width="${p.w}" height="${p.h}" preserveAspectRatio="xMidYMid slice"/>`
      : `<rect x="${p.x}" y="${y}" width="${p.w}" height="${p.h}" class="frame"/><rect x="${p.x + f}" y="${y + f}" width="${p.w - 2 * f}" height="${p.h - 2 * f}" class="mat"/><rect x="${p.x + f + m}" y="${y + f + m}" width="${p.w - 2 * (f + m)}" height="${p.h - 2 * (f + m)}" fill="${fallback || 'var(--swatch)'}"/>`;
    return `<g class="${cls}" data-id="${esc(p.ref.id)}" ${label}>${inner}<rect x="${p.x}" y="${y}" width="${p.w}" height="${p.h}" class="own-edge"/>${kind === 'pin' ? pinStrip(p.x, y, p.ref.id) : ''}${sel}</g>`;
  }
  const m = Math.min(p.w, p.h) >= 12 ? 1.5 : 1;
  return `<g class="${cls}" data-id="${esc(p.ref.id)}" ${label}>
    <rect x="${p.x}" y="${y}" width="${p.w}" height="${p.h}" class="mat"/>
    <text x="${p.x + p.w / 2}" y="${y + p.h / 2}" font-size="${Math.max(1.2, Math.min(2.4, p.w / 10))}" class="art-wait">${esc(String(p.title || '').slice(0, 22))}</text>
    ${img ? `<image href="${img}" x="${p.x + m}" y="${y + m}" width="${p.w - 2 * m}" height="${p.h - 2 * m}" preserveAspectRatio="xMidYMid slice"/>` : ''}
    ${tapeFrame(p.x, y, p.w, p.h, p.ref.id, kind === 'kept' ? 'tape-keep' : 'tape')}
    ${sel}
  </g>`;
}

function measures(L, W, H, s) {
  const g = L.group;
  const top = H - (g.y + g.h);
  const bottom = H - g.y;
  const ty = Math.max(s * 1.6, top - s * 1.4);
  const lx = g.x - s * 1.2;
  const nails = L.pieces.filter((p) => p.role !== 'pinned').map((p) => `<circle cx="${p.nail.x}" cy="${H - p.nail.y}" r="${s * 0.22}" class="nail"/>`).join('');
  return `<g class="measure">
    <line x1="0" x2="${W}" y1="${H - 57}" y2="${H - 57}" class="centerline"/>
    ${(() => { const left = g.x >= W - (g.x + g.w); return `<text x="${left ? s * 0.4 : W - s * 0.4}" y="${H - 57 - s * 0.35}" font-size="${s}" text-anchor="${left ? 'start' : 'end'}">57 in to center</text>`; })()}
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
export function wallSvg(o) {
  const W = o.wall.width, H = o.wall.height;
  const s = labelSize(W, o.pxWide);
  const pad = s * 0.6;
  const bg = o.photo
    ? `<image href="${o.photo}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect x="0" y="0" width="${W}" height="${H}" class="wall"/><rect x="0" y="${H - 4}" width="${W}" height="4" class="baseboard"/>`;
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
    return framed(p, H, owned ? info && info.thumb : o.imageFor && o.imageFor(p), { kind, selected: p.ref.id === o.selected, fallback: info && info.color, still: !!o.still });
  }).join('') : '';
  // A wall you can tap pieces on is a group, so screen readers reach each piece.
  const role = L && !o.still ? 'group' : 'img';
  return `<svg viewBox="${-pad} ${-pad} ${W + pad * 2} ${H + pad * 2}" role="${role}" aria-label="${esc(o.label || 'Wall')}, ${esc(feet(W))} wide and ${esc(feet(H))} tall${L ? `, with ${L.pieces.length} pieces` : ''}" data-w="${W}" data-h="${H}">
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
