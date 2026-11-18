import JSZip from 'jszip';
import {
  ANDROID_ADAPTIVE_DP,
  ANDROID_DENSITIES,
  ANDROID_LEGACY_DP,
  IOS_ICONS,
  PLAY_ICON_PX,
  SOURCE_MIN_PX,
  iosPixels,
} from '@/config/iconSizes';
import { encodeOpaquePng } from '@/lib/png';

export interface IconOptions {
  /** Fills transparency on iOS (Apple forbids alpha) and is the Android adaptive background layer. */
  background: string;
  /**
   * How big the artwork is on Android, in dp of the 108 dp adaptive canvas (48–108).
   * 72 = fills the area every launcher shows; smaller adds padding so masks don't clip it.
   */
  androidArtDp: number;
}

export interface SourceInfo {
  width: number;
  height: number;
  hasTransparency: boolean;
}

export interface IconSetResult {
  zip: Blob;
  /** zip path → [width, height] */
  files: Record<string, [number, number]>;
  warnings: string[];
}

const canvas = (w: number, h = w) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};
const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!;

/** Centre-crops the image to a square canvas at its own resolution. */
export function squareSource(img: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement {
  const s = Math.min(img.width, img.height);
  const c = canvas(s);
  ctx2d(c).drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, s, s);
  return c;
}

export function inspectSource(img: CanvasImageSource & { width: number; height: number }): SourceInfo {
  const sq = squareSource(img);
  const { data } = ctx2d(sq).getImageData(0, 0, sq.width, sq.height);
  let hasTransparency = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) {
      hasTransparency = true;
      break;
    }
  }
  return { width: img.width, height: img.height, hasTransparency };
}

/**
 * Downscales in halving steps, then one final high-quality step. A single big jump (1024 → 20)
 * skips pixels and looks jagged; halving keeps small icons sharp.
 */
export function resample(src: HTMLCanvasElement, px: number): HTMLCanvasElement {
  let cur = src;
  while (cur.width / 2 >= px) {
    const half = canvas(Math.round(cur.width / 2));
    const c = ctx2d(half);
    c.imageSmoothingQuality = 'high';
    c.drawImage(cur, 0, 0, half.width, half.height);
    cur = half;
  }
  const out = canvas(px);
  const c = ctx2d(out);
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  c.drawImage(cur, 0, 0, px, px);
  return out;
}

/** Artwork centred on a square of `px`, scaled to `fraction` of it, over `background` (or transparent). */
function compose(src: HTMLCanvasElement, px: number, fraction: number, background: string | null, round = false): HTMLCanvasElement {
  const out = canvas(px);
  const c = ctx2d(out);
  if (round) {
    c.beginPath();
    c.arc(px / 2, px / 2, px / 2, 0, Math.PI * 2);
    c.clip();
  }
  if (background) {
    c.fillStyle = background;
    c.fillRect(0, 0, px, px);
  }
  const art = Math.round(px * Math.min(1, fraction));
  const scaled = resample(src, Math.max(1, art));
  const off = Math.round((px - art) / 2);
  c.drawImage(scaled, off, off);
  return out;
}

async function opaquePng(c: HTMLCanvasElement, background: string): Promise<Uint8Array> {
  const { data } = ctx2d(c).getImageData(0, 0, c.width, c.height);
  return encodeOpaquePng(c.width, c.height, data, background);
}

async function rgbaPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  if (!blob) throw new Error('Could not encode PNG');
  return new Uint8Array(await blob.arrayBuffer());
}

/** Builds the whole iOS + Android icon set from one image. */
export async function generateIconSet(
  img: CanvasImageSource & { width: number; height: number },
  opts: IconOptions,
): Promise<IconSetResult> {
  const zip = new JSZip();
  const files: Record<string, [number, number]> = {};
  const warnings: string[] = [];
  const info = inspectSource(img);
  const src = squareSource(img);

  if (info.width !== info.height) warnings.push(`Your image is ${info.width} × ${info.height}; it was cropped to the centre square.`);
  if (src.width < SOURCE_MIN_PX) warnings.push(`Your image is ${src.width} px; ${SOURCE_MIN_PX} × ${SOURCE_MIN_PX} or larger looks sharper (the App Store icon is upscaled).`);
  if (info.hasTransparency) warnings.push(`Transparent areas were filled with ${opts.background} on iOS — Apple doesn't allow transparency in app icons.`);

  const add = (path: string, bytes: Uint8Array, w: number, h = w) => {
    zip.file(path, bytes);
    files[path] = [w, h];
  };

  // ── iOS: AppIcon.appiconset (square, opaque; iOS applies the rounded mask) ──
  const iosDir = 'ios/AppIcon.appiconset';
  const written = new Set<number>();
  for (const icon of IOS_ICONS) {
    const px = iosPixels(icon);
    if (written.has(px)) continue;
    written.add(px);
    add(`${iosDir}/Icon-${px}.png`, await opaquePng(compose(src, px, 1, opts.background), opts.background), px);
  }
  const contents = {
    images: IOS_ICONS.map((i) => ({
      filename: `Icon-${iosPixels(i)}.png`,
      idiom: i.idiom,
      scale: `${i.scale}x`,
      size: `${i.size}x${i.size}`, // e.g. "83.5x83.5", as Xcode writes it
    })),
    info: { author: 'shotframe', version: 1 },
  };
  zip.file(`${iosDir}/Contents.json`, `${JSON.stringify(contents, null, 2)}\n`);

  // ── Android: res/mipmap-* ──
  // The legacy 48 dp icon shows the same 72 dp visible area as the adaptive icon.
  const legacyFraction = opts.androidArtDp / 72;
  const adaptiveFraction = opts.androidArtDp / ANDROID_ADAPTIVE_DP;
  for (const d of ANDROID_DENSITIES) {
    const dir = `android/res/mipmap-${d.name}`;
    const legacy = Math.round(ANDROID_LEGACY_DP * d.scale);
    const adaptive = Math.round(ANDROID_ADAPTIVE_DP * d.scale);
    add(`${dir}/ic_launcher.png`, await rgbaPng(compose(src, legacy, legacyFraction, opts.background)), legacy);
    add(`${dir}/ic_launcher_round.png`, await rgbaPng(compose(src, legacy, legacyFraction, opts.background, true)), legacy);
    add(`${dir}/ic_launcher_foreground.png`, await rgbaPng(compose(src, adaptive, adaptiveFraction, null)), adaptive);
  }
  const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;
  zip.file('android/res/mipmap-anydpi-v26/ic_launcher.xml', adaptiveXml);
  zip.file('android/res/mipmap-anydpi-v26/ic_launcher_round.xml', adaptiveXml);
  zip.file(
    'android/res/values/ic_launcher_background.xml',
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${opts.background.toUpperCase()}</color>
</resources>
`,
  );
  // Google Play listing icon (Play applies its own rounded mask)
  add('android/playstore-icon.png', await opaquePng(compose(src, PLAY_ICON_PX, legacyFraction, opts.background), opts.background), PLAY_ICON_PX);

  zip.file(
    'README.txt',
    `App icons generated by Shotframe

iOS: drag ios/AppIcon.appiconset into Assets.xcassets in Xcode (replace the existing AppIcon).
     Every icon is square and opaque; iOS rounds the corners itself.
     Icon-1024.png is also the App Store icon.

Android: copy android/res/* into app/src/main/res/ (replace existing ic_launcher files).
     Android 8+ uses the adaptive icon (foreground layer + background colour ${opts.background.toUpperCase()});
     older versions use ic_launcher.png / ic_launcher_round.png.
     Upload android/playstore-icon.png (512 × 512) in Play Console → Store listing.
`,
  );

  return { zip: await zip.generateAsync({ type: 'blob' }), files, warnings };
}
