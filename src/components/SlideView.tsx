import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react';
import {
  backdropBaseColor,
  backdropCss,
  effectiveBackdrop,
  fontStack,
  getDevice,
  hasBackdropLayer,
  isRtl,
  readableTextColor,
  slideDims,
  textFor,
} from '@/lib/constants';
import type { Design, ElementBox, ExportSize, SlideData, SlideElement } from '@/lib/types';

const TEXT_SIZES = {
  lg: { head: 34, sub: 16 },
  md: { head: 29, sub: 15 },
  sm: { head: 25, sub: 14 },
} as const;

const TILT = {
  flat: 'none',
  left: 'perspective(900px) rotateY(16deg) rotateZ(-2deg)',
  right: 'perspective(900px) rotateY(-16deg) rotateZ(2deg)',
} as const;

const ACCENT = '#818CF8';
const GUIDE = '#F472B6';

/** Canvas-only props. Without them (landing, projects, export) nothing interactive is rendered. */
export interface SlideEditing {
  /** Element showing the selection outline and scale handle. */
  active: SlideElement | null;
  /** Centre lines the dragged element is snapped to. */
  guides: { x: boolean; y: boolean };
  /** The `scale` the slide is shown at, so outlines and handles stay the same size on screen. */
  zoom: number;
  /** `frame` is the element's outer box, for measuring its default position. */
  onPointerDown: (el: SlideElement, kind: 'move' | 'scale', e: PointerEvent<HTMLElement>, frame: HTMLElement) => void;
  onKeyDown: (el: SlideElement, e: KeyboardEvent<HTMLElement>, frame: HTMLElement) => void;
}

interface SlideViewProps {
  design: Design;
  slide: SlideData;
  index: number;
  /** Target export size; sets the slide's aspect ratio. */
  size: ExportSize;
  locale?: string;
  /** Display scale. Export renders at scale 1 and lets html-to-image upscale. */
  scale?: number;
  editing?: SlideEditing;
}

/** A box from the database is only used if every number is usable; otherwise the default layout wins. */
function usableBox(b: ElementBox | undefined): ElementBox | null {
  if (!b) return null;
  return [b.x, b.y, b.scale, b.rotate].every(Number.isFinite) && b.scale > 0 ? b : null;
}

/** Absolute placement: (x, y) is the centre; scale and rotate turn around the centre. */
function placed(b: ElementBox, extra = ''): CSSProperties {
  return {
    position: 'absolute',
    left: b.x,
    top: b.y,
    transform: `translate(-50%, -50%) rotate(${b.rotate}deg) scale(${b.scale})${extra}`,
  };
}

/**
 * One store screenshot. Laid out at BASE_SLIDE_WIDTH so text and device
 * keep the same proportions at every export size.
 *
 * Each element (text, device) is either in the default flex layout or, once it has a
 * box, absolutely placed. A placed element leaves an invisible copy in the flex layout,
 * so the other element stays exactly where it was.
 */
export function SlideView({ design, slide, index, size, locale = design.activeLocale, scale = 1, editing }: SlideViewProps) {
  // 414 units on the short side. Portrait: W = 414 (as before); landscape: H = 414.
  const { W, H } = slideDims(size);
  const landscape = W > H;
  const device = getDevice(design.device);
  const backdrop = effectiveBackdrop(design, slide);
  const fg = readableTextColor(backdropBaseColor(backdrop));
  const isLight = fg !== '#FFFFFF';
  // Panoramic: the project gradient/image is one wide layer across all slides, shifted per slide
  // (like the blob below). A slide with its own background stands alone.
  const sharedStrip = design.panoramic && !slide.backdrop;
  const slideCount = Math.max(1, design.slides.length);

  // Portrait: the device's width is a share of the slide width (unchanged).
  // Landscape: the device lies on its side; its height is the same share of the slide height,
  // capped so the text keeps at least ~40% of the width beside it.
  const LANDSCAPE_GAP = 28; // space between the device and the slide edge
  let deviceW: number;
  let deviceH: number;
  if (landscape) {
    const aspect = 1 / device.aspect; // width / height when turned
    deviceW = Math.min(H * device.widthRatio * aspect, W * 0.58);
    deviceH = deviceW / aspect;
  } else {
    deviceW = W * device.widthRatio;
    deviceH = deviceW / device.aspect;
  }
  const shortSide = Math.min(deviceW, deviceH); // = deviceW in portrait
  const bezel = Math.max(6, shortSide * 0.035);
  const radius = shortSide * device.radiusRatio;
  const text = TEXT_SIZES[design.textSize];

  // Panoramic: one big shape positioned in "strip" coordinates, so it flows across slides.
  const blobSize = W * 1.5;
  const blobLeft = design.panoramic ? W * 0.45 - index * W : W * 0.1;

  const textBox = usableBox(slide.textBox);
  const deviceBox = usableBox(slide.deviceBox);

  // ── Text ──
  const textStyle: CSSProperties = {
    // Landscape puts text beside the device ("top" = text on the left), so it gets even padding.
    padding: landscape ? '28px 32px' : design.layout === 'top' ? '48px 28px 30px' : '30px 28px 48px',
    textAlign: 'center',
    boxSizing: 'border-box', // so maxWidth below matches the flex item's width, padding included
  };
  /** Landscape: the text column is exactly what the device leaves free. */
  const landscapeTextW = W - deviceW - LANDSCAPE_GAP * 2;
  const dir = isRtl(locale) ? 'rtl' : undefined; // Arabic, Hebrew
  const textContent = (
    <>
      <div dir={dir} style={{ fontSize: text.head, fontWeight: 700, lineHeight: 1.12, letterSpacing: '-0.01em', whiteSpace: 'pre-line' }}>
        {textFor(slide.headline, locale)}
      </div>
      <div dir={dir} style={{ marginTop: 10, fontSize: text.sub, opacity: 0.85, lineHeight: 1.4 }}>
        {textFor(slide.subtitle, locale)}
      </div>
    </>
  );
  const flowText: CSSProperties = landscape
    ? { ...textStyle, position: 'relative', flex: '0 0 auto', width: landscapeTextW }
    : { ...textStyle, position: 'relative', flex: '0 0 auto' };
  // Portrait: max-content capped at the slide width wraps exactly like the flex item it replaces.
  // Landscape: the same fixed column width as in the flex layout.
  const placedText = (b: ElementBox): CSSProperties =>
    landscape
      ? { ...textStyle, ...placed(b), width: landscapeTextW }
      : { ...textStyle, ...placed(b), width: 'max-content', maxWidth: W };

  // ── Device ──
  const deviceInner = (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        border: `${bezel}px solid #0B0C0F`,
        borderRadius: radius,
        background: '#FFFFFF',
        overflow: 'hidden',
        transform: TILT[design.angle],
        boxShadow: design.shadow ? '0 24px 60px rgba(0,0,0,0.35)' : 'none',
      }}
    >
      {slide.imageUrl ? (
        <img
          src={slide.imageUrl}
          alt=""
          crossOrigin="anonymous"
          draggable={false}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <PlaceholderScreen accent={design.background} />
      )}
    </div>
  );
  const flowDevice: CSSProperties = landscape
    ? { position: 'relative', flex: '0 0 auto', width: deviceW, height: deviceH, margin: `0 ${LANDSCAPE_GAP}px` }
    : { position: 'relative', flex: '0 0 auto', width: deviceW, height: deviceH };
  const placedDevice = (b: ElementBox): CSSProperties => ({ ...placed(b), width: deviceW, height: deviceH });

  /** The element's outer box; when editing it is focusable and draggable. */
  const frame = (el: SlideElement, style: CSSProperties, children: ReactNode, box: ElementBox | null) => {
    if (!editing) return <div style={style}>{children}</div>;
    const isActive = editing.active === el;
    const px = 1 / (editing.zoom * (box?.scale ?? 1)); // one screen pixel, in this element's units
    return (
      <div
        data-el={el}
        tabIndex={0}
        role="button"
        aria-label={
          el === 'text'
            ? 'Headline: drag to move, arrow keys to nudge, plus and minus to resize'
            : 'Device: drag to move, arrow keys to nudge, plus and minus to resize'
        }
        aria-pressed={isActive}
        style={{
          ...style,
          cursor: 'move',
          touchAction: 'none',
          userSelect: 'none',
          outline: isActive ? `${2 * px}px solid ${ACCENT}` : undefined,
          outlineOffset: 2 * px,
        }}
        onPointerDown={(e) => editing.onPointerDown(el, 'move', e, e.currentTarget)}
        onKeyDown={(e) => editing.onKeyDown(el, e, e.currentTarget)}
      >
        {children}
        {isActive && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              right: -7 * px,
              bottom: -7 * px,
              width: 14 * px,
              height: 14 * px,
              boxSizing: 'border-box',
              background: '#FFFFFF',
              border: `${2 * px}px solid ${ACCENT}`,
              borderRadius: 3 * px,
              cursor: 'nwse-resize',
              touchAction: 'none',
              zIndex: 2,
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              const target = e.currentTarget.parentElement;
              if (target) editing.onPointerDown(el, 'scale', e, target);
            }}
          />
        )}
      </div>
    );
  };

  const guideLine = (style: CSSProperties) => (
    <div aria-hidden="true" style={{ position: 'absolute', background: GUIDE, pointerEvents: 'none', zIndex: 3, ...style }} />
  );
  const guidePx = editing ? 1 / editing.zoom : 1;

  return (
    <div style={{ width: W * scale, height: H * scale, flex: '0 0 auto' }}>
      <div
        data-slide=""
        style={{
          width: W,
          height: H,
          transform: scale === 1 ? undefined : `scale(${scale})`,
          transformOrigin: 'top left',
          position: 'relative',
          overflow: 'hidden',
          background: backdrop.color,
          color: fg,
          fontFamily: fontStack(design.font),
          fontSize: 16,
          lineHeight: 1.4,
          textAlign: 'left',
          display: 'flex',
          ...(landscape
            ? { flexDirection: design.layout === 'top' ? 'row' : 'row-reverse', justifyContent: 'center' }
            : { flexDirection: design.layout === 'top' ? 'column' : 'column-reverse' }),
          alignItems: 'center',
        }}
      >
        {hasBackdropLayer(backdrop) && (
          <div
            aria-hidden="true"
            data-backdrop=""
            style={{
              position: 'absolute',
              top: 0,
              height: H,
              left: sharedStrip ? -index * W : 0,
              width: sharedStrip ? W * slideCount : W,
              ...backdropCss(backdrop),
            }}
          />
        )}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            width: blobSize,
            height: blobSize,
            borderRadius: '50%',
            left: blobLeft,
            top: H * 0.42,
            background: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.13)',
          }}
        />

        {/* Default (flex) layout. A placed element keeps an invisible stand-in here. */}
        {textBox ? (
          <div aria-hidden="true" style={{ ...flowText, visibility: 'hidden' }}>
            {textContent}
          </div>
        ) : (
          frame('text', flowText, textContent, null)
        )}
        {deviceBox ? (
          <div aria-hidden="true" style={{ ...flowDevice, visibility: 'hidden' }} />
        ) : (
          frame('device', flowDevice, deviceInner, null)
        )}

        {/* Freely placed elements, drawn above the default layout. */}
        {deviceBox && frame('device', placedDevice(deviceBox), deviceInner, deviceBox)}
        {textBox && frame('text', placedText(textBox), textContent, textBox)}

        {editing?.guides.x && guideLine({ left: W / 2 - guidePx / 2, top: 0, width: guidePx, height: H })}
        {editing?.guides.y && guideLine({ top: H / 2 - guidePx / 2, left: 0, height: guidePx, width: W })}
      </div>
    </div>
  );
}

function PlaceholderScreen({ accent }: { accent: string }) {
  const bar = (w: string, h: number, bg: string, r = 6) => (
    <div style={{ width: w, height: h, borderRadius: r, background: bg }} />
  );
  return (
    <div style={{ padding: '26px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {bar('60%', 12, '#1F2937')}
      {bar('40%', 9, '#CBD5E1')}
      <div style={{ height: 90, borderRadius: 14, background: accent, opacity: 0.9 }} />
      {bar('100%', 34, '#F1F5F9', 10)}
      {bar('100%', 34, '#F1F5F9', 10)}
      {bar('100%', 34, '#F1F5F9', 10)}
      <div style={{ marginTop: 6, fontSize: 12, color: '#64748B', textAlign: 'center', fontFamily: 'Inter, sans-serif' }}>
        Drop a screenshot
      </div>
    </div>
  );
}
