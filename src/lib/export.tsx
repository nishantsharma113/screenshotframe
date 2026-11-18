import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { getFontEmbedCSS, toCanvas } from 'html-to-image';
import JSZip from 'jszip';
import { FeatureGraphicView } from '@/components/FeatureGraphicView';
import { SlideView } from '@/components/SlideView';
import {
  STORE_RULES,
  groupOf,
  presetFolder,
  presetSize,
  slideCountWarnings,
  storeLocale,
  type SizePreset,
} from '@/config/storeSizes';
import { effectiveBackdrop, projectBackdrop } from '@/lib/constants';
import { encodeOpaquePng } from '@/lib/png';
import { customFontEmbedCSS } from '@/services/fonts';
import type { Design, Orientation } from './types';

export type ExportFormat = 'png' | 'jpeg';

/** One size to export (screenshot, feature graphic or icon preset). */
export interface ExportJob {
  preset: SizePreset;
  /** Applies to screenshots only; feature graphics and icons are always as listed. */
  orientation: Orientation;
}

interface ExportOptions {
  design: Design;
  jobs: ExportJob[];
  locales: string[];
  format: ExportFormat;
  fileName: string;
  onProgress?: (done: number, total: number) => void;
}

export interface ExportResult {
  files: number;
  /** Store rules the export breaks (slide count, file size…). The ZIP is still downloaded. */
  warnings: string[];
  /** path → [width, height] of every image written (used by tests and the summary). */
  sizes: Record<string, [number, number]>;
}

const pad = (i: number) => String(i + 1).padStart(2, '0');

/**
 * Renders every chosen size × language off-screen at the exact store pixel size, flattens it onto
 * a solid background (stores reject transparency) and downloads one ZIP laid out for fastlane:
 *   ios/iphone-6.9/en-US/01.png · android/phone/en-US/01.png · android/feature-graphic/en-US/feature-graphic.png
 *   ios/app-icon/icon-1024.png · android/app-icon/icon-512.png
 */
export async function exportScreenshots({ design, jobs, locales, format, fileName, onProgress }: ExportOptions): Promise<ExportResult> {
  const zip = new JSZip();
  const warnings = slideCountWarnings(
    jobs.filter((j) => groupOf(j.preset).kind === 'screenshot').map((j) => j.preset.groupId),
    design.slides.length,
  );
  const sizes: Record<string, [number, number]> = {};
  const shotJobs = jobs.filter((j) => groupOf(j.preset).kind === 'screenshot');
  const featureJobs = jobs.filter((j) => groupOf(j.preset).kind === 'feature');
  const iconJobs = jobs.filter((j) => groupOf(j.preset).kind === 'icon');
  const total = (shotJobs.length * design.slides.length + featureJobs.length) * locales.length + iconJobs.length;
  let done = 0;
  const ext = format === 'png' ? 'png' : 'jpg';

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, { position: 'fixed', left: '-100000px', top: '0', pointerEvents: 'none' });
  document.body.appendChild(host);
  const root = createRoot(host);

  /** Rasterise `node` at exactly w × h, flatten onto `bg`, encode and add to the ZIP. */
  const write = async (path: string, node: HTMLElement, w: number, h: number, bg: string, store: 'ios' | 'play', fontEmbedCSS?: string) => {
    const canvas = await toCanvas(node, { canvasWidth: w, canvasHeight: h, pixelRatio: 1, cacheBust: true, fontEmbedCSS });
    await addCanvas(path, canvas, w, h, bg, store);
  };
  const addCanvas = async (path: string, canvas: HTMLCanvasElement, w: number, h: number, bg: string, store: 'ios' | 'play') => {
    if (canvas.width !== w || canvas.height !== h) warnings.push(`${path}: rendered ${canvas.width} × ${canvas.height} instead of ${w} × ${h}.`);
    const bytes = format === 'png' ? await toOpaquePng(canvas, bg) : await toJpeg(canvas, bg);
    const rules = STORE_RULES[store];
    if (rules.maxBytes && bytes.length > rules.maxBytes) {
      warnings.push(`${path}: ${(bytes.length / 1048576).toFixed(1)} MB is over Google Play’s 8 MB limit — try JPG.`);
    }
    zip.file(path, bytes);
    sizes[path] = [canvas.width, canvas.height];
    onProgress?.(++done, total);
  };

  try {
    const customCSS = await customFontEmbedCSS([design]);
    await document.fonts.ready;
    let fontEmbedCSS: string | undefined;
    const fontCss = async (node: HTMLElement) => {
      fontEmbedCSS ??= [await getFontEmbedCSS(node), customCSS].join('\n');
      return fontEmbedCSS;
    };

    for (const locale of locales) {
      for (const job of shotJobs) {
        const g = groupOf(job.preset);
        const size = presetSize(job.preset, job.orientation);
        flushSync(() => {
          root.render(
            <div style={{ display: 'flex' }}>
              {design.slides.map((slide, i) => (
                <SlideView key={slide.id} design={design} slide={slide} index={i} size={size} locale={locale} />
              ))}
            </div>,
          );
        });
        await waitForImages(host);
        const nodes = Array.from(host.querySelectorAll<HTMLElement>('[data-slide]'));
        const css = nodes[0] ? await fontCss(nodes[0]) : undefined;
        const folder = `${presetFolder(job.preset, job.orientation)}/${storeLocale(g.store, locale)}`;
        for (let i = 0; i < nodes.length; i++) {
          const bg = effectiveBackdrop(design, design.slides[i]).color;
          await write(`${folder}/${pad(i)}.${ext}`, nodes[i], size.width, size.height, bg, g.store, css);
        }
      }

      for (const job of featureJobs) {
        const g = groupOf(job.preset);
        flushSync(() => root.render(<FeatureGraphicView design={design} locale={locale} />));
        await waitForImages(host);
        const node = host.querySelector<HTMLElement>('[data-feature]');
        if (!node) continue;
        const path = `${presetFolder(job.preset)}/${storeLocale(g.store, locale)}/feature-graphic.${ext}`;
        await write(path, node, job.preset.width, job.preset.height, projectBackdrop(design).color, g.store, await fontCss(node));
      }
    }

    // App icons: the icon uploaded for the feature graphic, square-cropped, flattened onto white.
    for (const job of iconJobs) {
      const g = groupOf(job.preset);
      const url = design.featureGraphic?.iconUrl;
      if (!url) {
        warnings.push(`${g.store === 'ios' ? 'App Store' : 'Google Play'} app icon skipped: upload an icon (Google Play → feature graphic → App icon).`);
        onProgress?.(++done, total);
        continue;
      }
      const canvas = await iconCanvas(url, job.preset.width);
      await addCanvas(`${presetFolder(job.preset)}/icon-${job.preset.width}.${ext}`, canvas, job.preset.width, job.preset.height, '#FFFFFF', g.store);
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, `${slugify(fileName)}-screenshots.zip`);
    return { files: Object.keys(sizes).length, warnings, sizes };
  } finally {
    root.unmount();
    host.remove();
  }
}

async function toOpaquePng(canvas: HTMLCanvasElement, bg: string): Promise<Uint8Array> {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return encodeOpaquePng(canvas.width, canvas.height, data, bg);
}

/** JPEG has no alpha, but transparent pixels would turn black: paint the background first. */
async function toJpeg(canvas: HTMLCanvasElement, bg: string): Promise<Uint8Array> {
  const flat = document.createElement('canvas');
  flat.width = canvas.width;
  flat.height = canvas.height;
  const ctx = flat.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(canvas, 0, 0);
  const blob = await new Promise<Blob | null>((r) => flat.toBlob(r, 'image/jpeg', 0.92));
  if (!blob) throw new Error('Could not encode JPG');
  return new Uint8Array(await blob.arrayBuffer());
}

async function iconCanvas(url: string, size: number): Promise<HTMLCanvasElement> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const s = Math.min(img.naturalWidth, img.naturalHeight); // centre square crop
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
  return c;
}

async function waitForImages(container: HTMLElement) {
  const imgs = Array.from(container.querySelectorAll('img'));
  await Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined))));
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'project';
