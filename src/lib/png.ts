// 24-bit PNG (RGB, no alpha channel) for store uploads. Browsers' canvas.toBlob('image/png') always
// writes RGBA, which App Store Connect and Google Play can reject ("no transparency" / "24-bit PNG").
// Uses the browser's own deflate (CompressionStream), so no extra library.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array, crc = 0xffffffff): number {
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return crc;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, (crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0);
  return out;
}

async function zlib(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Parses a #rgb / #rrggbb colour (anything else → white). */
export function hexToRgb(hex: string): [number, number, number] {
  const m = hex.trim().replace('#', '');
  const f = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  if (!/^[0-9a-f]{6}$/i.test(f)) return [255, 255, 255];
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * Flattens RGBA pixels onto a solid background (no pixel stays transparent) and encodes a
 * 24-bit RGB PNG. Rows use the "Up" filter, which compresses flat UI-style images well.
 */
export async function encodeOpaquePng(width: number, height: number, rgba: Uint8ClampedArray, background: string): Promise<Uint8Array> {
  const [br, bg, bb] = hexToRgb(background);
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  const prev = new Uint8Array(stride);
  const row = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = rgba[i + 3];
      const o = x * 3;
      row[o] = a === 255 ? rgba[i] : Math.round((rgba[i] * a + br * (255 - a)) / 255);
      row[o + 1] = a === 255 ? rgba[i + 1] : Math.round((rgba[i + 1] * a + bg * (255 - a)) / 255);
      row[o + 2] = a === 255 ? rgba[i + 2] : Math.round((rgba[i + 2] * a + bb * (255 - a)) / 255);
    }
    const base = y * (stride + 1);
    raw[base] = 2; // filter: Up
    for (let k = 0; k < stride; k++) raw[base + 1 + k] = (row[k] - prev[k]) & 0xff;
    prev.set(row);
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = RGB (no alpha)
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', await zlib(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
