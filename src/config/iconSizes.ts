// Every app icon file the generator writes. Sources:
//   iOS: Xcode AppIcon.appiconset (iPhone + iPad + App Store marketing icon). Icons must be square,
//        opaque (no alpha), and are rounded by iOS — so artwork is exported square.
//   Android: launcher icons per density (mdpi 1× … xxxhdpi 4×) — legacy square + round at 48 dp,
//        adaptive foreground at 108 dp (Android 8+), plus the 512 × 512 Google Play icon.

export interface IosIcon {
  idiom: 'iphone' | 'ipad' | 'ios-marketing';
  /** points, as Xcode writes it ("83.5x83.5") */
  size: number;
  scale: 1 | 2 | 3;
}

export const IOS_ICONS: IosIcon[] = [
  { idiom: 'iphone', size: 20, scale: 2 },
  { idiom: 'iphone', size: 20, scale: 3 },
  { idiom: 'iphone', size: 29, scale: 2 },
  { idiom: 'iphone', size: 29, scale: 3 },
  { idiom: 'iphone', size: 40, scale: 2 },
  { idiom: 'iphone', size: 40, scale: 3 },
  { idiom: 'iphone', size: 60, scale: 2 },
  { idiom: 'iphone', size: 60, scale: 3 },
  { idiom: 'ipad', size: 20, scale: 1 },
  { idiom: 'ipad', size: 20, scale: 2 },
  { idiom: 'ipad', size: 29, scale: 1 },
  { idiom: 'ipad', size: 29, scale: 2 },
  { idiom: 'ipad', size: 40, scale: 1 },
  { idiom: 'ipad', size: 40, scale: 2 },
  { idiom: 'ipad', size: 76, scale: 1 },
  { idiom: 'ipad', size: 76, scale: 2 },
  { idiom: 'ipad', size: 83.5, scale: 2 },
  { idiom: 'ios-marketing', size: 1024, scale: 1 },
];

/** Pixel size of an iOS icon entry (e.g. 83.5 pt @2x → 167 px). */
export const iosPixels = (i: IosIcon) => Math.round(i.size * i.scale);

export interface AndroidDensity {
  name: 'mdpi' | 'hdpi' | 'xhdpi' | 'xxhdpi' | 'xxxhdpi';
  /** multiplier from dp to px */
  scale: number;
}

export const ANDROID_DENSITIES: AndroidDensity[] = [
  { name: 'mdpi', scale: 1 },
  { name: 'hdpi', scale: 1.5 },
  { name: 'xhdpi', scale: 2 },
  { name: 'xxhdpi', scale: 3 },
  { name: 'xxxhdpi', scale: 4 },
];

/** Legacy launcher icon: 48 dp. Adaptive icon layers: 108 dp, of which the inner 72 dp is always visible. */
export const ANDROID_LEGACY_DP = 48;
export const ANDROID_ADAPTIVE_DP = 108;
export const ANDROID_SAFE_DP = 66; // the circle every launcher mask keeps (Android guidance: 66 dp)
export const PLAY_ICON_PX = 512;
export const SOURCE_MIN_PX = 1024;
