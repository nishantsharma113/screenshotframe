import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { getFontEmbedCSS, toJpeg, toPng } from 'html-to-image';
import JSZip from 'jszip';
import { FeatureGraphicView } from '@/components/FeatureGraphicView';
import { SlideView } from '@/components/SlideView';
import { FEATURE_GRAPHIC_SIZE } from '@/lib/constants';
import { customFontEmbedCSS } from '@/services/fonts';
import type { Design, ExportSize } from './types';

export type ExportFormat = 'png' | 'jpeg';

interface ExportOptions {
  design: Design;
  sizes: ExportSize[];
  locales: string[];
  format: ExportFormat;
  /** Also export the Google Play feature graphic (1024 × 500), once per locale. */
  featureGraphic?: boolean;
  fileName: string;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Renders every slide × size × locale off-screen, rasterises it at the exact
 * store pixel size, and downloads one ZIP:
 *   <locale>/<size-id>/01.png, 02.png …
 *   <locale>/feature-graphic.png            (Google Play, when asked for)
 */
export async function exportScreenshots({ design, sizes, locales, format, featureGraphic = false, fileName, onProgress }: ExportOptions) {
  const zip = new JSZip();
  const total = sizes.length * locales.length * design.slides.length + (featureGraphic ? locales.length : 0);
  let done = 0;

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, { position: 'fixed', left: '-100000px', top: '0', pointerEvents: 'none' });
  document.body.appendChild(host);
  const root = createRoot(host);

  try {
    // Uploaded fonts are added with the FontFace API: load them first, then wait for every font.
    const customCSS = await customFontEmbedCSS([design]);
    await document.fonts.ready;
    /** Built once: stylesheet fonts html-to-image finds itself + the uploaded ones it can't see. */
    let fontEmbedCSS: string | undefined;

    for (const locale of locales) {
      for (const size of sizes) {
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
        if (fontEmbedCSS === undefined && nodes[0]) {
          await document.fonts.ready;
          fontEmbedCSS = [await getFontEmbedCSS(nodes[0]), customCSS].join('\n');
        }
        for (let i = 0; i < nodes.length; i++) {
          const opts = {
            canvasWidth: size.width,
            canvasHeight: size.height,
            pixelRatio: 1,
            cacheBust: true,
            fontEmbedCSS,
          };
          const dataUrl = format === 'png' ? await toPng(nodes[i], opts) : await toJpeg(nodes[i], { ...opts, quality: 0.92 });
          const ext = format === 'png' ? 'png' : 'jpg';
          zip.file(`${locale}/${size.id}/${String(i + 1).padStart(2, '0')}.${ext}`, dataUrl.split(',')[1], { base64: true });
          onProgress?.(++done, total);
        }
      }

      if (featureGraphic) {
        flushSync(() => root.render(<FeatureGraphicView design={design} locale={locale} />));
        await waitForImages(host);
        const node = host.querySelector<HTMLElement>('[data-feature]');
        if (node) {
          if (fontEmbedCSS === undefined) {
            await document.fonts.ready;
            fontEmbedCSS = [await getFontEmbedCSS(node), customCSS].join('\n');
          }
          const opts = {
            canvasWidth: FEATURE_GRAPHIC_SIZE.width,
            canvasHeight: FEATURE_GRAPHIC_SIZE.height,
            pixelRatio: 1,
            cacheBust: true,
            fontEmbedCSS,
          };
          const dataUrl = format === 'png' ? await toPng(node, opts) : await toJpeg(node, { ...opts, quality: 0.92 });
          zip.file(`${locale}/feature-graphic.${format === 'png' ? 'png' : 'jpg'}`, dataUrl.split(',')[1], { base64: true });
        }
        onProgress?.(++done, total);
      }
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, `${slugify(fileName)}-screenshots.zip`);
  } finally {
    root.unmount();
    host.remove();
  }
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
