// Renders media/icon.png (128x128) from the same geometry as media/icon.svg.
//
// The Marketplace rejects SVG icons, so a raster copy is required. Rather than
// pull in sharp/resvg just for one 128px square - the whole point of this
// extension is a small dependency surface - the mark is simple enough to
// rasterise directly: a rounded rect and four bars, all axis-aligned.
//
// Run: node scripts/build-icon.js   (only needed when icon.svg changes)

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const SIZE = 128;
const SS = 4; // supersample factor: the only curve here is the corner radius
const VB = 64; // icon.svg viewBox units
const s = (SIZE * SS) / VB; // viewBox unit -> supersampled pixel

const GREEN = [0x64, 0xc0, 0x7f];
const INK = [0x14, 0x20, 0x16];

// Geometry mirrors icon.svg exactly. Keep the two in sync by hand; they are
// four lines each and a build step to derive one from the other would cost
// more than it saves.
const BARS = [
  { x: 12, y: 24, w: 4, h: 16, r: 0, a: 1.0 },
  { x: 22, y: 24, w: 10, h: 16, r: 2, a: 0.5 },
  { x: 36, y: 24, w: 8, h: 16, r: 2, a: 0.3 },
  { x: 48, y: 24, w: 12, h: 16, r: 2, a: 0.1 },
];

/** Is (px,py) inside a rounded rect, in viewBox units? */
function inRoundRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  if (r <= 0) return true;
  // Only the four corner boxes need the radius test.
  const cx = px < x + r ? x + r : px > x + w - r ? x + w - r : px;
  const cy = py < y + r ? y + r : py > y + h - r ? y + h - r : py;
  if (cx === px && cy === py) return true;
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

// Render at SS x resolution, then box-filter down. Antialiasing the corners is
// the entire reason for supersampling; the bars are pixel-aligned regardless.
const hi = SIZE * SS;
const acc = new Float64Array(SIZE * SIZE * 4);

for (let sy = 0; sy < hi; sy++) {
  for (let sx = 0; sx < hi; sx++) {
    const vx = (sx + 0.5) / s;
    const vy = (sy + 0.5) / s;

    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;

    if (inRoundRect(vx, vy, 0, 0, VB, VB, 14)) {
      [r, g, b] = GREEN;
      a = 1;
      for (const bar of BARS) {
        if (inRoundRect(vx, vy, bar.x, bar.y, bar.w, bar.h, bar.r)) {
          // source-over: ink at bar.a onto the green plate
          r = INK[0] * bar.a + r * (1 - bar.a);
          g = INK[1] * bar.a + g * (1 - bar.a);
          b = INK[2] * bar.a + b * (1 - bar.a);
          break; // bars never overlap
        }
      }
    }

    const di = ((sy / SS) | 0) * SIZE + ((sx / SS) | 0);
    acc[di * 4] += r * a;
    acc[di * 4 + 1] += g * a;
    acc[di * 4 + 2] += b * a;
    acc[di * 4 + 3] += a;
  }
}

// Raw scanlines, filter byte 0 (None) per row. Premultiplied above, so undo it
// on the way out - PNG stores straight (non-premultiplied) alpha.
const n = SS * SS;
const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
let o = 0;
for (let y = 0; y < SIZE; y++) {
  raw[o++] = 0;
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    const a = acc[i + 3] / n;
    const un = a > 0 ? 1 / (a * n) : 0;
    raw[o++] = Math.round(acc[i] * un);
    raw[o++] = Math.round(acc[i + 1] * un);
    raw[o++] = Math.round(acc[i + 2] * un);
    raw[o++] = Math.round(a * 255);
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

let TABLE;
function crc32(buf) {
  if (!TABLE) {
    TABLE = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[i] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type: RGBA
// 10-12: compression, filter, interlace - all 0

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = path.join(__dirname, "..", "media", "icon.png");
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${SIZE}x${SIZE}, ${png.length} bytes)`);
