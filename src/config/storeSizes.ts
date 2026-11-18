// ONE list of every App Store / Google Play size the app offers: the editor's size picker, the
// export dialog, the ZIP layout and the slide-count warnings all read it.
//
// Apple: developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications
//   1–10 screenshots per size, JPG or PNG, no transparency.
// Google Play: each side 320–3840 px, max 8 MB, JPG or 24-bit PNG (no alpha).
//
// Sizes are listed portrait (width < height). Landscape swaps width and height.
import type { DeviceId, ExportSize, Orientation, Store } from '@/lib/types';

export type SizeKind = 'screenshot' | 'feature' | 'icon';

export interface Requirement {
  /** required: the store needs it · conditional: needed in some cases · future: needed from a date */
  level: 'required' | 'conditional' | 'future';
  /** Badge text */
  label: string;
}

export interface SizeGroup {
  id: string;
  store: Store;
  /** Picker heading, e.g. 'iPhone 6.9" · Dynamic Island, large' */
  label: string;
  kind: SizeKind;
  /** Device frame screenshots in this group are drawn with (null for icons). */
  device: DeviceId | null;
  /**
   * Use the size's own aspect for the frame's screen (Apple sizes are real device screens).
   * Google Play's 9:16 / 10:16 sizes aren't phone screens, so their frames keep the device's shape.
   */
  frameMatchesSize: boolean;
  required?: Requirement;
  /** Screenshots per language the store accepts for this group. */
  minShots?: number;
  maxShots?: number;
  /** ZIP folder (fastlane-friendly), e.g. ios/iphone-6.9 */
  folder: string;
}

export interface SizePreset {
  id: string;
  groupId: string;
  width: number; // portrait
  height: number; // portrait
}

const APPLE_SHOTS = { minShots: 1, maxShots: 10 };
const PLAY_MAX = { maxShots: 8 };

export const SIZE_GROUPS: SizeGroup[] = [
  // ── Apple ──
  { id: 'iphone-6.3', store: 'ios', label: 'iPhone · Dynamic Island, medium', kind: 'screenshot', device: 'iphone', frameMatchesSize: true, required: { level: 'required', label: 'Required' }, ...APPLE_SHOTS, folder: 'ios/iphone-6.3' },
  { id: 'iphone-6.9', store: 'ios', label: 'iPhone 6.9" · Dynamic Island, large', kind: 'screenshot', device: 'iphone', frameMatchesSize: true, ...APPLE_SHOTS, folder: 'ios/iphone-6.9' },
  { id: 'iphone-6.5', store: 'ios', label: 'iPhone 6.5" · Face ID, large', kind: 'screenshot', device: 'iphone', frameMatchesSize: true, ...APPLE_SHOTS, folder: 'ios/iphone-6.5' },
  { id: 'iphone-6.1', store: 'ios', label: 'iPhone · Face ID, medium', kind: 'screenshot', device: 'iphone', frameMatchesSize: true, ...APPLE_SHOTS, folder: 'ios/iphone-6.1' },
  { id: 'iphone-5.5', store: 'ios', label: 'iPhone 5.5"', kind: 'screenshot', device: 'iphone', frameMatchesSize: true, ...APPLE_SHOTS, folder: 'ios/iphone-5.5' },
  { id: 'iphone-duo-outer', store: 'ios', label: 'iPhone Duo · outer display', kind: 'screenshot', device: 'iphone', frameMatchesSize: true, required: { level: 'future', label: 'Required from Apr 2027' }, ...APPLE_SHOTS, folder: 'ios/iphone-duo-outer' },
  { id: 'iphone-duo-inner', store: 'ios', label: 'iPhone Duo · inner display', kind: 'screenshot', device: 'ipad', frameMatchesSize: true, required: { level: 'future', label: 'Required from Apr 2027' }, ...APPLE_SHOTS, folder: 'ios/iphone-duo-inner' },
  { id: 'ipad-13', store: 'ios', label: 'iPad 13"', kind: 'screenshot', device: 'ipad', frameMatchesSize: true, required: { level: 'conditional', label: 'Required for iPad apps' }, ...APPLE_SHOTS, folder: 'ios/ipad-13' },
  { id: 'ipad-11', store: 'ios', label: 'iPad 11"', kind: 'screenshot', device: 'ipad', frameMatchesSize: true, ...APPLE_SHOTS, folder: 'ios/ipad-11' },
  { id: 'ios-icon', store: 'ios', label: 'App icon', kind: 'icon', device: null, frameMatchesSize: false, folder: 'ios/app-icon' },
  // ── Google Play ──
  { id: 'play-phone', store: 'play', label: 'Phone', kind: 'screenshot', device: 'pixel', frameMatchesSize: false, required: { level: 'required', label: 'Required' }, minShots: 2, ...PLAY_MAX, folder: 'android/phone' },
  { id: 'play-tablet-7', store: 'play', label: '7" tablet', kind: 'screenshot', device: 'android-tablet', frameMatchesSize: false, ...PLAY_MAX, folder: 'android/tablet-7' },
  { id: 'play-tablet-10', store: 'play', label: '10" tablet', kind: 'screenshot', device: 'android-tablet', frameMatchesSize: false, ...PLAY_MAX, folder: 'android/tablet-10' },
  { id: 'play-feature', store: 'play', label: 'Feature graphic', kind: 'feature', device: null, frameMatchesSize: false, required: { level: 'required', label: 'Required' }, folder: 'android/feature-graphic' },
  { id: 'play-icon', store: 'play', label: 'App icon', kind: 'icon', device: null, frameMatchesSize: false, required: { level: 'required', label: 'Required' }, folder: 'android/app-icon' },
];

/** The first size in each group is its main one (it gets the plain folder name). */
export const SIZE_PRESETS: SizePreset[] = [
  { id: 'iphone-6.3-1206x2622', groupId: 'iphone-6.3', width: 1206, height: 2622 },
  { id: 'iphone-6.3-1179x2556', groupId: 'iphone-6.3', width: 1179, height: 2556 },
  { id: 'iphone-6.9-1320x2868', groupId: 'iphone-6.9', width: 1320, height: 2868 },
  { id: 'iphone-6.9-1290x2796', groupId: 'iphone-6.9', width: 1290, height: 2796 },
  { id: 'iphone-6.9-1260x2736', groupId: 'iphone-6.9', width: 1260, height: 2736 },
  { id: 'iphone-6.5-1284x2778', groupId: 'iphone-6.5', width: 1284, height: 2778 },
  { id: 'iphone-6.5-1242x2688', groupId: 'iphone-6.5', width: 1242, height: 2688 },
  { id: 'iphone-6.1-1170x2532', groupId: 'iphone-6.1', width: 1170, height: 2532 },
  { id: 'iphone-6.1-1125x2436', groupId: 'iphone-6.1', width: 1125, height: 2436 },
  { id: 'iphone-6.1-1080x2340', groupId: 'iphone-6.1', width: 1080, height: 2340 },
  { id: 'iphone-5.5-1242x2208', groupId: 'iphone-5.5', width: 1242, height: 2208 },
  { id: 'iphone-duo-outer-1398x2034', groupId: 'iphone-duo-outer', width: 1398, height: 2034 },
  { id: 'iphone-duo-inner-2007x2853', groupId: 'iphone-duo-inner', width: 2007, height: 2853 },
  { id: 'ipad-13-2064x2752', groupId: 'ipad-13', width: 2064, height: 2752 },
  { id: 'ipad-13-2048x2732', groupId: 'ipad-13', width: 2048, height: 2732 },
  { id: 'ipad-11-1668x2420', groupId: 'ipad-11', width: 1668, height: 2420 },
  { id: 'ipad-11-1668x2388', groupId: 'ipad-11', width: 1668, height: 2388 },
  { id: 'ipad-11-1640x2360', groupId: 'ipad-11', width: 1640, height: 2360 },
  { id: 'ios-icon-1024', groupId: 'ios-icon', width: 1024, height: 1024 },
  { id: 'play-phone-1080x1920', groupId: 'play-phone', width: 1080, height: 1920 },
  { id: 'play-tablet-7-1200x1920', groupId: 'play-tablet-7', width: 1200, height: 1920 },
  { id: 'play-tablet-10-1600x2560', groupId: 'play-tablet-10', width: 1600, height: 2560 },
  { id: 'play-feature-1024x500', groupId: 'play-feature', width: 1024, height: 500 },
  { id: 'play-icon-512', groupId: 'play-icon', width: 512, height: 512 },
];

/** Store-wide file rules, checked on every exported file. */
export const STORE_RULES = {
  ios: { formats: ['png', 'jpeg'] as const, transparency: false, maxBytes: null as number | null, minSide: null as number | null, maxSide: null as number | null },
  play: { formats: ['png', 'jpeg'] as const, transparency: false, maxBytes: 8 * 1024 * 1024, minSide: 320, maxSide: 3840 },
} satisfies Record<Store, unknown>;

// ── Lookups ──

const groupById = new Map(SIZE_GROUPS.map((g) => [g.id, g]));
const presetById = new Map(SIZE_PRESETS.map((p) => [p.id, p]));

export const getGroup = (id: string) => groupById.get(id);
export const getPreset = (id: string | undefined | null) => (id ? presetById.get(id) : undefined);
export const groupOf = (p: SizePreset) => groupById.get(p.groupId)!;
export const presetsInGroup = (groupId: string) => SIZE_PRESETS.filter((p) => p.groupId === groupId);
export const groupsForStore = (store: Store, kind?: SizeKind) => SIZE_GROUPS.filter((g) => g.store === store && (!kind || g.kind === kind));
export const isPrimary = (p: SizePreset) => presetsInGroup(p.groupId)[0]?.id === p.id;

/** The size new projects (and a store switch) start with: the store's required phone size. */
export const DEFAULT_PRESET: Record<Store, string> = { ios: 'iphone-6.3-1206x2622', play: 'play-phone-1080x1920' };

/** A preset as an ExportSize (what SlideView / export render), in the given orientation. */
export function presetSize(p: SizePreset, orientation: Orientation = 'portrait'): ExportSize {
  const g = groupOf(p);
  const land = orientation === 'landscape' && g.kind === 'screenshot';
  return {
    id: land ? `${p.id}-landscape` : p.id,
    label: `${g.label} · ${land ? p.height : p.width} × ${land ? p.width : p.height}`,
    width: land ? p.height : p.width,
    height: land ? p.width : p.height,
    store: g.store,
    devices: g.device ? [g.device] : [],
    orientation: land ? 'landscape' : 'portrait',
    frameAspect: g.frameMatchesSize ? p.width / p.height : undefined,
  };
}

/**
 * Closest screenshot preset for a store + device + size (migrating projects made before presets
 * existed): same store and frame device, then nearest aspect ratio, then nearest pixel count.
 */
export function closestPreset(store: Store, device: DeviceId | undefined, width: number, height: number): SizePreset {
  const portraitW = Math.min(width, height);
  const portraitH = Math.max(width, height);
  const aspect = portraitW / portraitH;
  const candidates = SIZE_PRESETS.filter((p) => {
    const g = groupOf(p);
    return g.store === store && g.kind === 'screenshot';
  });
  const score = (p: SizePreset) => {
    const g = groupOf(p);
    return [
      device && g.device !== device ? 1 : 0,
      Math.abs(p.width / p.height - aspect),
      Math.abs(p.width * p.height - portraitW * portraitH),
    ];
  };
  return candidates.reduce((best, p) => {
    const [a, b] = [score(p), score(best)];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? p : best;
    return best;
  });
}

/** ZIP folder for a preset: the group folder, plus the size when it isn't the group's main one. */
export function presetFolder(p: SizePreset, orientation: Orientation = 'portrait'): string {
  const g = groupOf(p);
  const base = isPrimary(p) ? g.folder : `${g.folder}-${p.width}x${p.height}`;
  return orientation === 'landscape' && g.kind === 'screenshot' ? `${base}-landscape` : base;
}

/** Locale folder names fastlane (deliver / supply) uses, per store. */
const STORE_LOCALES: Record<Store, Record<string, string>> = {
  ios: { en: 'en-US', hi: 'hi', es: 'es-ES', de: 'de-DE', fr: 'fr-FR', pt: 'pt-BR', ja: 'ja', ar: 'ar-SA', he: 'he' },
  play: { en: 'en-US', hi: 'hi-IN', es: 'es-ES', de: 'de-DE', fr: 'fr-FR', pt: 'pt-BR', ja: 'ja-JP', ar: 'ar', he: 'iw-IL' },
};
export const storeLocale = (store: Store, code: string) => STORE_LOCALES[store][code] ?? code;

/** Warnings when a group's slide count breaks the store's min/max rule. */
export function slideCountWarnings(groupIds: string[], count: number): string[] {
  const out: string[] = [];
  for (const id of new Set(groupIds)) {
    const g = getGroup(id);
    if (!g || g.kind !== 'screenshot') continue;
    const store = g.store === 'ios' ? 'App Store' : 'Google Play';
    if (g.minShots && count < g.minShots) out.push(`${store} ${g.label}: needs at least ${g.minShots} screenshots — you have ${count}.`);
    if (g.maxShots && count > g.maxShots) out.push(`${store} ${g.label}: accepts at most ${g.maxShots} screenshots — you have ${count}; upload only ${g.maxShots}.`);
  }
  return out;
}
