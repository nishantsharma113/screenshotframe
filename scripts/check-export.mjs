#!/usr/bin/env node
// Checks an exported ZIP against the store rules, using the size list in src/config/storeSizes.ts:
//   • every image has exactly the pixel size of its folder's preset (landscape = swapped)
//   • PNGs are 24-bit RGB with no alpha channel (or JPG)
//   • Google Play: each side 320–3840 px, at most 8 MB
//   • screenshots per folder/language within the store's min/max
//
//   node scripts/check-export.mjs path/to/project-screenshots.zip
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const zipPath = process.argv[2];
if (!zipPath) {
  console.error('Usage: node scripts/check-export.mjs <export.zip>');
  process.exit(2);
}

// ── Read the size config (same file the app uses) ──
const cfgSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/config/storeSizes.ts'), 'utf8');
const groups = new Map();
for (const m of cfgSrc.matchAll(/\{ id: '([^']+)', store: '(ios|play)', label: '((?:[^'\\]|\\.)*)', kind: '(\w+)'[^\n]*?folder: '([^']+)' \}/g)) {
  const line = m[0];
  groups.set(m[1], {
    id: m[1],
    store: m[2],
    label: m[3],
    kind: m[4],
    folder: m[5],
    min: Number(line.match(/minShots: (\d+)/)?.[1] ?? (line.includes('APPLE_SHOTS') ? 1 : 0)),
    max: Number(line.match(/maxShots: (\d+)/)?.[1] ?? (line.includes('APPLE_SHOTS') ? 10 : line.includes('PLAY_MAX') ? 8 : Infinity)),
  });
}
const presets = [...cfgSrc.matchAll(/\{ id: '([^']+)', groupId: '([^']+)', width: (\d+), height: (\d+) \}/g)].map((m) => ({
  id: m[1],
  groupId: m[2],
  width: +m[3],
  height: +m[4],
}));
if (!groups.size || !presets.length) {
  console.error('Could not read src/config/storeSizes.ts');
  process.exit(2);
}

/** folder → expected { w, h, group } */
const expected = new Map();
for (const p of presets) {
  const g = groups.get(p.groupId);
  const primary = presets.find((q) => q.groupId === p.groupId).id === p.id;
  const base = primary ? g.folder : `${g.folder}-${p.width}x${p.height}`;
  expected.set(base, { w: p.width, h: p.height, g });
  if (g.kind === 'screenshot') expected.set(`${base}-landscape`, { w: p.height, h: p.width, g });
}

function imageInfo(buf) {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { type: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), colorType: buf[25], bitDepth: buf[24] };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i < buf.length - 9; ) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: 'jpeg', h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
const problems = [];
const counts = new Map(); // "folder|locale" → n
let checked = 0;
const rows = [];

for (const name of Object.keys(zip.files).sort()) {
  const f = zip.files[name];
  if (f.dir) continue;
  const parts = name.split('/');
  const isIcon = parts.length === 3; // ios/app-icon/icon-1024.png
  const folder = parts.slice(0, 2).join('/');
  const exp = expected.get(folder);
  if (!exp) {
    problems.push(`${name}: unknown folder "${folder}"`);
    continue;
  }
  const buf = Buffer.from(await f.async('uint8array'));
  const info = imageInfo(buf);
  checked++;
  if (!info) {
    problems.push(`${name}: not a PNG or JPG`);
    continue;
  }
  const ok = [];
  if (info.w !== exp.w || info.h !== exp.h) problems.push(`${name}: ${info.w} × ${info.h}, expected ${exp.w} × ${exp.h}`);
  else ok.push('size');
  if (info.type === 'png') {
    if (info.colorType === 4 || info.colorType === 6) problems.push(`${name}: PNG has an alpha channel (colour type ${info.colorType})`);
    else if (info.colorType === 2 && info.bitDepth === 8) ok.push('24-bit');
    else problems.push(`${name}: unexpected PNG colour type ${info.colorType} / depth ${info.bitDepth}`);
  }
  if (exp.g.store === 'play') {
    if (Math.min(info.w, info.h) < 320 || Math.max(info.w, info.h) > 3840) problems.push(`${name}: Google Play needs each side 320–3840 px`);
    if (buf.length > 8 * 1024 * 1024) problems.push(`${name}: ${(buf.length / 1048576).toFixed(1)} MB is over Google Play's 8 MB`);
  }
  if (!isIcon && exp.g.kind === 'screenshot') {
    const key = `${folder}|${parts[2]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  rows.push(`${info.w}×${info.h}`.padEnd(10) + ` ${info.type}${info.type === 'png' ? `/ct${info.colorType}` : ''}`.padEnd(9) + `${(buf.length / 1024).toFixed(0).padStart(6)} KB  ${name}`);
}

for (const [key, n] of counts) {
  const [folder, locale] = key.split('|');
  const g = expected.get(folder).g;
  if (n < g.min) problems.push(`${folder} (${locale}): ${n} screenshots, ${g.store === 'ios' ? 'App Store' : 'Google Play'} needs at least ${g.min}`);
  if (n > g.max) problems.push(`${folder} (${locale}): ${n} screenshots, ${g.store === 'ios' ? 'App Store' : 'Google Play'} accepts at most ${g.max}`);
}

console.log(rows.join('\n'));
console.log(`\n${checked} images checked in ${path.basename(zipPath)}`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log('OK: every image has its preset’s exact size, no alpha channel, and the store rules hold.');
