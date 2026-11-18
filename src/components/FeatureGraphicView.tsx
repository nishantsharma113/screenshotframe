import {
  FEATURE_GRAPHIC_SIZE,
  backdropBaseColor,
  backdropCss,
  fontStack,
  hasBackdropLayer,
  isRtl,
  projectBackdrop,
  readableTextColor,
  textFor,
} from '@/lib/constants';
import type { Design } from '@/lib/types';

/** Laid out at half the export size, like slides are laid out small and scaled up. */
export const FEATURE_W = FEATURE_GRAPHIC_SIZE.width / 2; // 512
export const FEATURE_H = FEATURE_GRAPHIC_SIZE.height / 2; // 250

interface FeatureGraphicViewProps {
  design: Design;
  locale?: string;
  /** Display scale. Export renders at scale 1 and lets html-to-image upscale to 1024 × 500. */
  scale?: number;
}

/**
 * Google Play feature graphic: the project background, one headline and an optional app icon.
 * Shown at the end of the canvas for Play projects and exported once per language.
 */
export function FeatureGraphicView({ design, locale = design.activeLocale, scale = 1 }: FeatureGraphicViewProps) {
  const backdrop = projectBackdrop(design);
  const fg = readableTextColor(backdropBaseColor(backdrop));
  const isLight = fg !== '#FFFFFF';
  const fgData = design.featureGraphic;
  const headline = textFor(fgData?.headline ?? {}, locale) || textFor(design.slides[0]?.headline ?? {}, locale);
  const icon = fgData?.iconUrl ?? null;
  const iconSize = 116;
  const rtl = isRtl(locale);

  return (
    <div style={{ width: FEATURE_W * scale, height: FEATURE_H * scale, flex: '0 0 auto' }}>
      <div
        data-feature=""
        style={{
          width: FEATURE_W,
          height: FEATURE_H,
          transform: scale === 1 ? undefined : `scale(${scale})`,
          transformOrigin: 'top left',
          position: 'relative',
          overflow: 'hidden',
          background: backdrop.color,
          color: fg,
          fontFamily: fontStack(design.font),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 28,
          padding: '0 40px',
          boxSizing: 'border-box',
        }}
      >
        {hasBackdropLayer(backdrop) && (
          <div aria-hidden="true" style={{ position: 'absolute', inset: 0, ...backdropCss(backdrop) }} />
        )}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            width: FEATURE_W * 1.1,
            height: FEATURE_W * 1.1,
            borderRadius: '50%',
            left: FEATURE_W * 0.55,
            top: FEATURE_H * 0.35,
            background: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.13)',
          }}
        />
        {icon && (
          <img
            src={icon}
            alt=""
            crossOrigin="anonymous"
            draggable={false}
            style={{
              position: 'relative',
              width: iconSize,
              height: iconSize,
              flex: '0 0 auto',
              objectFit: 'cover',
              borderRadius: iconSize * 0.22,
              boxShadow: design.shadow ? '0 12px 30px rgba(0,0,0,0.3)' : 'none',
              display: 'block',
            }}
          />
        )}
        <div
          dir={rtl ? 'rtl' : undefined}
          style={{
            position: 'relative',
            fontSize: 36,
            fontWeight: 700,
            lineHeight: 1.12,
            letterSpacing: '-0.01em',
            whiteSpace: 'pre-line',
            textAlign: icon ? (rtl ? 'right' : 'left') : 'center',
            maxWidth: icon ? FEATURE_W - 80 - iconSize - 28 : FEATURE_W - 80,
          }}
        >
          {headline}
        </div>
      </div>
    </div>
  );
}
