export type Store = 'ios' | 'play';
export type DeviceId = 'iphone' | 'ipad' | 'pixel' | 'android-tablet';
export type Layout = 'top' | 'bottom';
export type Orientation = 'portrait' | 'landscape';
export type Angle = 'flat' | 'left' | 'right';
export type TextSize = 'sm' | 'md' | 'lg';
export type Plan = 'basic' | 'standard' | 'extended';
export type FontName = 'Space Grotesk' | 'Inter' | 'Poppins';
/** An uploaded font, by its user_fonts.id. */
export type CustomFontRef = `custom:${string}`;
export type DesignFont = FontName | CustomFontRef;

/** Text keyed by locale code, e.g. { en: 'Hello', hi: 'नमस्ते' } */
export type LocalizedText = Record<string, string>;

/** A freely placed element: (x, y) is its centre, in BASE_SLIDE_WIDTH units from the slide's top-left. */
export interface ElementBox {
  x: number;
  y: number;
  /** 1 = the size it has in the default layout */
  scale: number;
  /** degrees, clockwise */
  rotate: number;
}

export type SlideElement = 'text' | 'device';

/** Two-colour linear gradient; `angle` in CSS degrees (0 = bottom → top, 90 = left → right). */
export interface Gradient {
  angle: number;
  from: string;
  to: string;
}

export interface BackgroundImage {
  /** Public URL (Supabase Storage) or data: URL for local projects */
  url: string;
  /** Storage path, so the file can be deleted later */
  path: string | null;
}

/** Everything behind a slide. The colour always exists; gradient and image are optional. */
export interface Backdrop {
  color: string;
  gradient?: Gradient | null;
  /** Covers the area; drawn above the gradient. */
  image?: BackgroundImage | null;
}

export interface SlideData {
  id: string;
  headline: LocalizedText;
  subtitle: LocalizedText;
  /** Public URL (Supabase Storage) or data: URL for local projects */
  imageUrl: string | null;
  /** Storage path, so the file can be deleted later */
  imagePath: string | null;
  /** Free position of the headline + subtitle. Missing = the design's default layout. */
  textBox?: ElementBox;
  /** Free position of the device frame. Missing = the design's default layout. */
  deviceBox?: ElementBox;
  /** This slide's own background. Missing = the project background. */
  backdrop?: Backdrop;
}

/** Google Play feature graphic (1024 × 500): one headline, an optional app icon, the project background. */
export interface FeatureGraphic {
  headline: LocalizedText;
  /** Public URL (Supabase Storage) or data: URL for local projects */
  iconUrl: string | null;
  /** Storage path, so the file can be deleted later */
  iconPath: string | null;
}

export interface Design {
  store: Store;
  device: DeviceId;
  background: string;
  panoramic: boolean;
  layout: Layout;
  angle: Angle;
  font: DesignFont;
  textSize: TextSize;
  shadow: boolean;
  locales: string[];
  activeLocale: string;
  slides: SlideData[];
  /** Project gradient (replaces the solid colour when set). */
  gradient?: Gradient | null;
  /** Project background image (covers colour and gradient when set). */
  backgroundImage?: BackgroundImage | null;
  /**
   * Store size preset (src/config/storeSizes.ts). Missing on projects made before presets existed;
   * normalizeDesign() fills in the closest one.
   */
  sizeId?: string;
  /** Missing = portrait (every project made before landscape existed). */
  orientation?: Orientation;
  /** Created the first time it's edited; only used when store is 'play'. */
  featureGraphic?: FeatureGraphic;
}

export interface Project {
  id: string;
  name: string;
  design: Design;
  updatedAt: string;
}

export type TemplateCategory = 'Minimal' | 'Bold' | 'Panoramic' | 'Dark' | 'Playful';

export interface Template {
  id: string;
  name: string;
  category: TemplateCategory;
  store: 'both' | Store;
  design: Pick<Design, 'background' | 'panoramic' | 'layout' | 'font' | 'angle'>;
}

export interface DeviceSpec {
  id: DeviceId;
  label: string;
  note: string;
  store: Store;
  /** width / height of the device screen */
  aspect: number;
  /** device width as a fraction of the slide width */
  widthRatio: number;
  /** corner radius as a fraction of the device width */
  radiusRatio: number;
  /** export size used for the on-screen preview */
  previewSize: ExportSize;
  /** export size used for the on-screen preview in landscape */
  landscapePreviewSize: ExportSize;
}

export interface ExportSize {
  id: string;
  label: string;
  width: number;
  height: number;
  store: Store;
  devices: DeviceId[];
  orientation: Orientation;
  /** Portrait width/height of the device frame's screen; missing = the device's own shape. */
  frameAspect?: number;
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'local' | 'error';
