import type { CSSProperties } from 'react';
import { plansWith, type Feature } from '@shared/plans';
import { DEFAULT_PRESET, closestPreset, getPreset, groupOf, presetSize } from '@/config/storeSizes';
import type { Backdrop, Design, DeviceId, DeviceSpec, ExportSize, Orientation, Plan, SlideData, Store, Template } from './types';

/**
 * Slides are laid out at this many units on their SHORT side (the width in portrait,
 * the height in landscape) and scaled for preview/export.
 */
export const BASE_SLIDE_WIDTH = 414;

const PORTRAIT_SIZES: ExportSize[] = [
  { id: 'iphone-69', label: 'iPhone 6.9" display', width: 1320, height: 2868, store: 'ios', devices: ['iphone'], orientation: 'portrait' },
  { id: 'iphone-65', label: 'iPhone 6.5" display', width: 1284, height: 2778, store: 'ios', devices: ['iphone'], orientation: 'portrait' },
  { id: 'ipad-13', label: 'iPad 13" display', width: 2064, height: 2752, store: 'ios', devices: ['ipad'], orientation: 'portrait' },
  { id: 'play-phone', label: 'Google Play phone', width: 1080, height: 1920, store: 'play', devices: ['pixel'], orientation: 'portrait' },
  { id: 'play-tablet', label: 'Google Play tablet', width: 1440, height: 2560, store: 'play', devices: ['android-tablet'], orientation: 'portrait' },
];

/** Each portrait size turned on its side, e.g. iPhone 6.9" 1320 × 2868 → 2868 × 1320. */
const LANDSCAPE_SIZES: ExportSize[] = PORTRAIT_SIZES.map((s) => ({
  ...s,
  id: `${s.id}-landscape`,
  label: `${s.label} · landscape`,
  width: s.height,
  height: s.width,
  orientation: 'landscape',
}));

export const EXPORT_SIZES: ExportSize[] = [...PORTRAIT_SIZES, ...LANDSCAPE_SIZES];

/** Google Play feature graphic, exported once per language. */
export const FEATURE_GRAPHIC_SIZE = { width: 1024, height: 500 } as const;

export const orientationOf = (design: Pick<Design, 'orientation'>): Orientation => design.orientation ?? 'portrait';

/** Layout units of a slide at this export size: 414 on the short side (portrait results are unchanged). */
export function slideDims(size: Pick<ExportSize, 'width' | 'height'>): { W: number; H: number } {
  if (size.width > size.height) return { W: Math.round((BASE_SLIDE_WIDTH * size.width) / size.height), H: BASE_SLIDE_WIDTH };
  return { W: BASE_SLIDE_WIDTH, H: Math.round((BASE_SLIDE_WIDTH * size.height) / size.width) };
}

const size = (id: string): ExportSize => {
  const found = EXPORT_SIZES.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown export size ${id}`);
  return found;
};

export const DEVICES: DeviceSpec[] = [
  { id: 'iphone', label: 'iPhone 16 Pro Max', note: '6.9"', store: 'ios', aspect: 1320 / 2868, widthRatio: 0.64, radiusRatio: 0.17, previewSize: size('iphone-69'), landscapePreviewSize: size('iphone-69-landscape') },
  { id: 'ipad', label: 'iPad Pro', note: '13"', store: 'ios', aspect: 2064 / 2752, widthRatio: 0.8, radiusRatio: 0.07, previewSize: size('ipad-13'), landscapePreviewSize: size('ipad-13-landscape') },
  { id: 'pixel', label: 'Pixel 9 Pro', note: 'Phone', store: 'play', aspect: 1080 / 2400, widthRatio: 0.64, radiusRatio: 0.12, previewSize: size('play-phone'), landscapePreviewSize: size('play-phone-landscape') },
  { id: 'android-tablet', label: 'Android tablet', note: '10"', store: 'play', aspect: 1600 / 2560, widthRatio: 0.8, radiusRatio: 0.06, previewSize: size('play-tablet'), landscapePreviewSize: size('play-tablet-landscape') },
];

export const getDevice = (id: DeviceId): DeviceSpec => DEVICES.find((d) => d.id === id) ?? DEVICES[0];
/**
 * Size preset for a design made before presets existed: the closest preset to what it rendered
 * at (its device's old preview size), so it keeps looking exactly the same.
 */
export const legacySizeId = (store: Store, device: DeviceId): string => {
  const old = getDevice(device).previewSize;
  return closestPreset(store, device, old.width, old.height).id;
};

/** The size a design is edited and previewed at: its preset, in its orientation. */
export const previewSizeFor = (design: Pick<Design, 'device' | 'orientation' | 'sizeId' | 'store'>): ExportSize => {
  const preset = getPreset(design.sizeId) ?? getPreset(legacySizeId(design.store ?? 'ios', design.device))!;
  return presetSize(preset, orientationOf(design));
};

/** Device + size for a store's default (new projects, switching store). */
export const storeDefaults = (store: Store): Pick<Design, 'device' | 'sizeId'> => {
  const preset = getPreset(DEFAULT_PRESET[store])!;
  return { sizeId: preset.id, device: groupOf(preset).device ?? defaultDeviceForStore(store) };
};
export const devicesForStore = (store: Store) => DEVICES.filter((d) => d.store === store);
export const defaultDeviceForStore = (store: Store): DeviceId => (store === 'ios' ? 'iphone' : 'pixel');

export const SWATCHES = [
  { name: 'Indigo', hex: '#4F46E5' },
  { name: 'Navy', hex: '#0F172A' },
  { name: 'Orange', hex: '#EA580C' },
  { name: 'Green', hex: '#047857' },
  { name: 'Stone', hex: '#F5F5F4' },
  { name: 'Butter', hex: '#FDE68A' },
];

export const FONTS = ['Space Grotesk', 'Inter', 'Poppins'] as const;

export const LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'pt', label: 'Português' },
  { code: 'ja', label: '日本語' },
  { code: 'ar', label: 'العربية' },
  { code: 'he', label: 'עברית' },
];

/** Languages written right to left: their text gets dir="rtl". */
const RTL_LOCALES = ['ar', 'he'];
export const isRtl = (code: string) => RTL_LOCALES.includes(code.split('-')[0].toLowerCase());

export const languageLabel = (code: string) => LANGUAGES.find((l) => l.code === code)?.label ?? code;

/** Features that need a paid plan. */
/** Which plans include each paid feature — derived from the shared plan config. */
export const PLAN_FEATURES: Record<Feature, Plan[]> = {
  angle3d: plansWith('angle3d'),
  localization: plansWith('localization'),
  customFonts: plansWith('customFonts'),
  userTemplates: plansWith('userTemplates'),
  autoTranslate: plansWith('autoTranslate'),
};

const CUSTOM_FONT_PREFIX = 'custom:';
/** The user_fonts id in a design's font value, or null for a built-in font. */
export const customFontId = (font: string): string | null =>
  font.startsWith(CUSTOM_FONT_PREFIX) ? font.slice(CUSTOM_FONT_PREFIX.length) || null : null;
export const customFontRef = (id: string) => `${CUSTOM_FONT_PREFIX}${id}` as const;
/** CSS family an uploaded font is registered under (never clashes with a built-in or system font). */
export const customFontFamily = (id: string) => `sf-${id}`;

/** CSS font-family stack for a design font. An uploaded font that isn't loaded falls back to Inter. */
export function fontStack(font: string): string {
  const id = customFontId(font);
  return `'${id ? customFontFamily(id) : font}', Inter, system-ui, sans-serif`;
}

export const MAX_SLIDES = 10;

/* ── Backgrounds ─────────────────────────────────────────────── */

/** The project-level backdrop (colour + optional gradient + optional image). */
export const projectBackdrop = (d: Pick<Design, 'background' | 'gradient' | 'backgroundImage'>): Backdrop => ({
  color: d.background,
  gradient: d.gradient ?? null,
  image: d.backgroundImage ?? null,
});

/** What a slide actually shows: its own backdrop if it has one, otherwise the project's. */
export const effectiveBackdrop = (d: Design, slide?: SlideData | null): Backdrop => slide?.backdrop ?? projectBackdrop(d);

/** Average of two #rrggbb colours (for picking readable text on a gradient). */
export function mixHex(a: string, b: string): string {
  const p = (h: string) => {
    const m = h.replace('#', '');
    const f = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
    return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) || 0);
  };
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round((v + y[i]) / 2).toString(16).padStart(2, '0')).join('')}`;
}

/** The colour text contrast is judged against: the solid colour, or the middle of the gradient. */
export const backdropBaseColor = (b: Backdrop): string => (b.gradient ? mixHex(b.gradient.from, b.gradient.to) : b.color);

/** CSS for a backdrop layer (image over gradient over colour). */
export function backdropCss(b: Backdrop): CSSProperties {
  const layers: string[] = [];
  const sizes: string[] = [];
  if (b.image?.url) {
    layers.push(`url("${b.image.url.replace(/"/g, '%22')}")`);
    sizes.push('cover');
  }
  if (b.gradient) {
    layers.push(`linear-gradient(${b.gradient.angle}deg, ${b.gradient.from}, ${b.gradient.to})`);
    sizes.push('100% 100%');
  }
  return {
    backgroundColor: b.color,
    ...(layers.length
      ? { backgroundImage: layers.join(', '), backgroundSize: sizes.join(', '), backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }
      : {}),
  };
}

/** Whether a backdrop needs its own layer (anything beyond a plain colour). */
export const hasBackdropLayer = (b: Backdrop) => Boolean(b.gradient || b.image?.url);

export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

const SAMPLE_COPY: [string, string][] = [
  ['Build habits that stick', 'Track anything in one tap'],
  ['See your streaks grow', 'Weekly and monthly charts'],
  ['Reminders that adapt', 'Nudges at the right time'],
  ['Works fully offline', 'Your data stays on your phone'],
  ['Start free today', 'No sign-up needed'],
];

export const makeSlide = (headline = 'Your headline', subtitle = 'A short supporting line', locale = 'en'): SlideData => ({
  id: uid(),
  headline: { [locale]: headline },
  subtitle: { [locale]: subtitle },
  imageUrl: null,
  imagePath: null,
});

export const createDefaultDesign = (overrides: Partial<Design> = {}): Design => ({
  store: 'ios',
  device: 'iphone',
  background: '#4F46E5',
  panoramic: true,
  layout: 'top',
  angle: 'flat',
  font: 'Space Grotesk',
  textSize: 'lg',
  shadow: true,
  locales: ['en'],
  activeLocale: 'en',
  slides: SAMPLE_COPY.map(([h, s]) => makeSlide(h, s)),
  ...overrides,
  sizeId: overrides.sizeId ?? defaultSizeIdFor(overrides.store ?? 'ios', overrides.device),
});

/** New designs start on the store's required size, unless an explicit device needs another one. */
function defaultSizeIdFor(store: Store, device: DeviceId | undefined): string {
  const def = storeDefaults(store);
  return !device || device === def.device ? def.sizeId! : legacySizeId(store, device);
}

/** Used when Supabase is not configured, and as a fallback if the fetch fails. */
export const FALLBACK_TEMPLATES: Template[] = [
  { id: 'indigo-wave', name: 'Indigo Wave', category: 'Panoramic', store: 'both', design: { background: '#4F46E5', panoramic: true, layout: 'top', font: 'Space Grotesk', angle: 'flat' } },
  { id: 'paper-clean', name: 'Paper Clean', category: 'Minimal', store: 'both', design: { background: '#F5F5F4', panoramic: false, layout: 'top', font: 'Inter', angle: 'flat' } },
  { id: 'night-mode', name: 'Night Mode', category: 'Dark', store: 'ios', design: { background: '#0F172A', panoramic: true, layout: 'top', font: 'Inter', angle: 'flat' } },
  { id: 'citrus-pop', name: 'Citrus Pop', category: 'Bold', store: 'play', design: { background: '#EA580C', panoramic: true, layout: 'bottom', font: 'Poppins', angle: 'flat' } },
  { id: 'forest-calm', name: 'Forest Calm', category: 'Minimal', store: 'play', design: { background: '#047857', panoramic: false, layout: 'top', font: 'Inter', angle: 'flat' } },
  { id: 'butter-day', name: 'Butter Day', category: 'Playful', store: 'ios', design: { background: '#FDE68A', panoramic: true, layout: 'top', font: 'Poppins', angle: 'flat' } },
  { id: 'rose-bold', name: 'Rose Bold', category: 'Bold', store: 'both', design: { background: '#BE123C', panoramic: false, layout: 'bottom', font: 'Space Grotesk', angle: 'flat' } },
  { id: 'sky-sweep', name: 'Sky Sweep', category: 'Panoramic', store: 'ios', design: { background: '#0369A1', panoramic: true, layout: 'top', font: 'Space Grotesk', angle: 'flat' } },
];

/** Picks black or white text for a background, by relative luminance. */
export function readableTextColor(hex: string): string {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? '#111318' : '#FFFFFF';
}

/** Text of a slide in a locale, falling back to the first locale that has text. */
export function textFor(text: Record<string, string>, locale: string): string {
  return text[locale] ?? Object.values(text)[0] ?? '';
}
