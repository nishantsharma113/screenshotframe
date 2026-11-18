import { useEffect, useRef, useState } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import { ANDROID_SAFE_DP, IOS_ICONS, SOURCE_MIN_PX, iosPixels } from '@/config/iconSizes';
import { SWATCHES } from '@/lib/constants';
import { generateIconSet, inspectSource, resample, squareSource, type SourceInfo } from '@/lib/iconSet';

const ACCEPT = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 20 * 1024 * 1024;

interface Loaded {
  name: string;
  img: HTMLImageElement;
  info: SourceInfo;
}

/** Preview of the artwork as a launcher would show it: background + scaled art, clipped to a shape. */
function previewUrl(img: HTMLImageElement, px: number, artFraction: number, bg: string, shape: 'square' | 'ios' | 'circle' | 'squircle') {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d')!;
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(px / 2, px / 2, px / 2, 0, Math.PI * 2);
  else if (shape === 'ios' || shape === 'squircle') ctx.roundRect(0, 0, px, px, px * (shape === 'ios' ? 0.2237 : 0.32));
  else ctx.rect(0, 0, px, px);
  ctx.clip();
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, px, px);
  const art = Math.round(px * Math.min(1, artFraction));
  const scaled = resample(squareSource(img), art);
  ctx.drawImage(scaled, (px - art) / 2, (px - art) / 2);
  return c.toDataURL('image/png');
}

/** Standalone app icon generator: one image in, full iOS + Android icon sets out. No project needed. */
export function IconGenerator() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [background, setBackground] = useState('#FFFFFF');
  const [artDp, setArtDp] = useState(72);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ files: number; warnings: string[] } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const load = (file: File | undefined) => {
    setError(null);
    setResult(null);
    if (!file) return;
    if (!ACCEPT.includes(file.type)) return setError(`${file.name}: use a PNG, JPG or WebP image.`);
    if (file.size > MAX_BYTES) return setError(`${file.name}: larger than 20 MB.`);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setLoaded({ name: file.name, img, info: inspectSource(img) });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError(`${file.name}: the browser can’t read this image.`);
    };
    img.src = url;
  };

  // Live previews for the current options
  useEffect(() => {
    if (!loaded) return;
    const legacy = artDp / 72;
    setPreviews({
      ios: previewUrl(loaded.img, 180, 1, background, 'ios'),
      iosSmall: previewUrl(loaded.img, 60, 1, background, 'ios'),
      circle: previewUrl(loaded.img, 144, legacy, background, 'circle'),
      squircle: previewUrl(loaded.img, 144, legacy, background, 'squircle'),
      play: previewUrl(loaded.img, 144, legacy, background, 'square'),
    });
  }, [loaded, background, artDp]);

  const generate = async () => {
    if (!loaded || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await generateIconSet(loaded.img, { background, androidArtDp: artDp });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(r.zip);
      a.download = `${loaded.name.replace(/\.[^.]+$/, '') || 'app'}-icons.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      setResult({ files: Object.keys(r.files).length, warnings: r.warnings });
    } catch (e) {
      setError(e instanceof Error ? `Could not generate icons: ${e.message}` : 'Could not generate icons.');
    } finally {
      setBusy(false);
    }
  };

  const iosCount = new Set(IOS_ICONS.map(iosPixels)).size;

  return (
    <div className="light-page">
      <SiteHeader />
      <main className="container section icon-gen">
        <h1 className="page-title">App icon generator</h1>
        <p className="section__lead">
          Upload one square image and download every icon size for iOS and Android, ready to drop into Xcode and Android
          Studio. Everything happens in your browser.
        </p>

        <div className="icon-gen__grid">
          <section className="icon-gen__panel">
            <button
              type="button"
              className={`icon-drop ${dragging ? 'is-dragging' : ''}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                load(e.dataTransfer.files[0]);
              }}
            >
              {loaded ? (
                <>
                  <img src={loaded.img.src} alt="" className="icon-drop__thumb" />
                  <span>
                    <strong>{loaded.name}</strong>
                    <br />
                    {loaded.info.width} × {loaded.info.height}
                    {loaded.info.hasTransparency ? ' · has transparency' : ''} · click to replace
                  </span>
                </>
              ) : (
                <span>
                  <strong>Drop your icon here</strong> or click to choose
                  <br />
                  PNG, JPG or WebP · square, {SOURCE_MIN_PX} × {SOURCE_MIN_PX} or larger
                </span>
              )}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT.join(',')}
              hidden
              onChange={(e) => {
                load(e.target.files?.[0]);
                e.target.value = '';
              }}
            />

            <fieldset className="icon-gen__field">
              <legend>Background colour</legend>
              <p className="muted small">Fills transparent areas (iOS doesn’t allow transparency) and is the Android adaptive-icon background.</p>
              <div className="row-gap">
                {['#FFFFFF', '#000000', ...SWATCHES.map((s) => s.hex)].map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    className="icon-swatch"
                    aria-label={hex}
                    aria-pressed={background.toLowerCase() === hex.toLowerCase()}
                    style={{ background: hex }}
                    onClick={() => setBackground(hex)}
                  />
                ))}
                <input type="color" aria-label="Custom background colour" value={background} onChange={(e) => setBackground(e.target.value)} />
              </div>
            </fieldset>

            <fieldset className="icon-gen__field">
              <legend>Android artwork size</legend>
              <label className="icon-gen__range">
                <input type="range" min={48} max={108} step={2} value={artDp} onChange={(e) => setArtDp(Number(e.target.value))} />
                <span>{artDp} dp of 108</span>
              </label>
              <p className="muted small">
                Launchers crop adaptive icons to different shapes. Keep important details inside the middle {ANDROID_SAFE_DP} dp;
                72 fills the visible area.
              </p>
            </fieldset>

            <button type="button" className="btn btn--primary btn--lg" disabled={!loaded || busy} onClick={() => void generate()}>
              {busy ? 'Generating…' : 'Download icon set (.zip)'}
            </button>
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
            {result && (
              <div className="icon-gen__done" role="status">
                <p>Downloaded {result.files} icons.</p>
                {result.warnings.length > 0 && (
                  <ul>
                    {result.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>

          <section className="icon-gen__panel" aria-label="Preview">
            <h2 className="icon-gen__h">Preview</h2>
            {loaded ? (
              <div className="icon-previews">
                <figure>
                  <img src={previews.ios} alt="iOS home screen icon preview" width={90} height={90} />
                  <img src={previews.iosSmall} alt="" width={30} height={30} />
                  <figcaption>iOS</figcaption>
                </figure>
                <figure>
                  <img src={previews.circle} alt="Android circle icon preview" width={72} height={72} />
                  <figcaption>Android · circle</figcaption>
                </figure>
                <figure>
                  <img src={previews.squircle} alt="Android squircle icon preview" width={72} height={72} />
                  <figcaption>Android · squircle</figcaption>
                </figure>
                <figure>
                  <img src={previews.play} alt="Google Play icon preview" width={72} height={72} />
                  <figcaption>Google Play</figcaption>
                </figure>
              </div>
            ) : (
              <p className="muted">Your icon previews appear here.</p>
            )}

            <h2 className="icon-gen__h">What you get</h2>
            <ul className="icon-gen__list">
              <li>
                <strong>iOS</strong> — <code>AppIcon.appiconset</code> with {iosCount} sizes (iPhone, iPad, App Store 1024) and{' '}
                <code>Contents.json</code>. Square and opaque; iOS rounds the corners.
              </li>
              <li>
                <strong>Android</strong> — <code>res/mipmap-mdpi … xxxhdpi</code>: <code>ic_launcher</code>,{' '}
                <code>ic_launcher_round</code> and the adaptive <code>ic_launcher_foreground</code>, plus{' '}
                <code>mipmap-anydpi-v26</code> XML and the background colour.
              </li>
              <li>
                <strong>Google Play</strong> — <code>playstore-icon.png</code>, 512 × 512.
              </li>
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
}
