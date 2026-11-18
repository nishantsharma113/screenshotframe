import { useEffect, useMemo, useRef, useState } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import { ANDROID_DENSITIES, ANDROID_SAFE_DP, IOS_ICONS, SOURCE_MIN_PX, iosPixels } from '@/config/iconSizes';
import { generateIconSet, inspectSource, resample, sourceNotes, squareSource, type SourceInfo } from '@/lib/iconSet';

const ACCEPT = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 20 * 1024 * 1024;
const COLOURS = ['#FFFFFF', '#000000', '#4F46E5', '#0F172A', '#EA580C', '#047857', '#F5F5F4', '#FDE68A'];
const PADDING = [
  { dp: 72, label: 'Fill' },
  { dp: 62, label: 'Comfortable' },
  { dp: 52, label: 'Small' },
];
const IOS_FILES = new Set(IOS_ICONS.map(iosPixels)).size;
const ANDROID_FILES = ANDROID_DENSITIES.length * 3;
const TOTAL_FILES = IOS_FILES + ANDROID_FILES + 1;

type Shape = 'ios' | 'circle' | 'squircle' | 'rounded' | 'square';
const RADIUS: Record<Shape, number> = { ios: 0.2237, circle: 0.5, squircle: 0.3, rounded: 0.14, square: 0 };

interface Loaded {
  name: string;
  img: HTMLImageElement;
  info: SourceInfo;
}

/** The icon as a launcher draws it: background, artwork scaled to `art`, clipped to `shape`. */
function render(src: HTMLCanvasElement, px: number, art: number, bg: string, shape: Shape) {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d')!;
  ctx.beginPath();
  ctx.roundRect(0, 0, px, px, px * RADIUS[shape]);
  ctx.clip();
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, px, px);
  const a = Math.round(px * Math.min(1, art));
  ctx.drawImage(resample(src, a), (px - a) / 2, (px - a) / 2);
  return c.toDataURL('image/png');
}

/** Standalone app icon generator: one image in, every iOS and Android icon out. */
export function IconGenerator() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [background, setBackground] = useState('#FFFFFF');
  const [artDp, setArtDp] = useState(72);
  const [appName, setAppName] = useState('My App');
  const [showSafe, setShowSafe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = (file: File | undefined) => {
    setError(null);
    setDone(null);
    if (!file) return;
    if (!ACCEPT.includes(file.type)) return setError(`${file.name} isn’t a PNG, JPG or WebP image.`);
    if (file.size > MAX_BYTES) return setError(`${file.name} is larger than 20 MB.`);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setLoaded({ name: file.name, img, info: inspectSource(img) });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError(`The browser can’t read ${file.name}.`);
    };
    img.src = url;
  };

  const square = useMemo(() => (loaded ? squareSource(loaded.img) : null), [loaded]);
  const notes = loaded ? sourceNotes(loaded.info, background) : [];

  const previews = useMemo(() => {
    if (!square) return null;
    const android = artDp / 72; // the 48 dp icon shows the 72 dp visible area
    return {
      ios: render(square, 120, 1, background, 'ios'),
      ios40: render(square, 80, 1, background, 'ios'),
      ios29: render(square, 58, 1, background, 'ios'),
      circle: render(square, 128, android, background, 'circle'),
      squircle: render(square, 128, android, background, 'squircle'),
      rounded: render(square, 128, android, background, 'rounded'),
      square: render(square, 128, android, background, 'square'),
      play: render(square, 144, android, background, 'rounded'),
    };
  }, [square, background, artDp]);

  useEffect(() => setDone(null), [background, artDp]);

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
      setDone(Object.keys(r.files).length);
    } catch (e) {
      setError(e instanceof Error ? `Couldn’t generate the icons: ${e.message}` : 'Couldn’t generate the icons.');
    } finally {
      setBusy(false);
    }
  };

  const name = appName.trim() || 'My App';

  return (
    <div className="light-page">
      <SiteHeader />
      <main className="container icongen">
        <header className="icongen__intro">
          <span className="pill">Free · runs in your browser</span>
          <h1>App icon generator</h1>
          <p>One image in, every iOS and Android icon out — ready for Xcode and Android Studio.</p>
        </header>

        <div className="icongen__layout">
          {/* ── Controls ── */}
          <aside className="icongen__controls" aria-label="Icon settings">
            <section className="icongen__step">
              <h2>
                <span className="icongen__num">1</span> Your icon
              </h2>
              {loaded ? (
                <div className="icongen__file">
                  <img src={loaded.img.src} alt="" />
                  <div>
                    <strong title={loaded.name}>{loaded.name}</strong>
                    <span>
                      {loaded.info.width} × {loaded.info.height}
                      {loaded.info.hasTransparency ? ' · transparent areas' : ''}
                    </span>
                  </div>
                  <button type="button" className="btn btn--outline btn--sm" onClick={() => inputRef.current?.click()}>
                    Replace
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={`icongen__drop ${dragging ? 'is-dragging' : ''}`}
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
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <strong>Drop an image or click to choose</strong>
                  <span>
                    Square PNG, JPG or WebP · {SOURCE_MIN_PX} × {SOURCE_MIN_PX} or larger
                  </span>
                </button>
              )}
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
              {error && (
                <p className="icongen__error" role="alert">
                  {error}
                </p>
              )}
              {notes.length > 0 && (
                <ul className="icongen__notes">
                  {notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </section>

            <section className="icongen__step">
              <h2>
                <span className="icongen__num">2</span> Background
              </h2>
              <p className="icongen__hint">Fills transparent areas on iOS and sits behind your icon on Android.</p>
              <div className="icongen__swatches" role="radiogroup" aria-label="Background colour">
                {COLOURS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    role="radio"
                    aria-checked={background.toLowerCase() === hex.toLowerCase()}
                    aria-label={hex}
                    className="icongen__swatch"
                    style={{ background: hex }}
                    onClick={() => setBackground(hex)}
                  />
                ))}
                <label className="icongen__custom" title="Custom colour">
                  <input
                    type="color"
                    aria-label="Custom background colour"
                    value={background}
                    onChange={(e) => setBackground(e.target.value)}
                  />
                  <span>{background.toUpperCase()}</span>
                </label>
              </div>
            </section>

            <section className="icongen__step">
              <h2>
                <span className="icongen__num">3</span> Android padding
              </h2>
              <div className="segmented icongen__presets" role="group" aria-label="Android artwork size">
                {PADDING.map((p) => (
                  <button key={p.dp} type="button" aria-pressed={artDp === p.dp} onClick={() => setArtDp(p.dp)}>
                    {p.label}
                  </button>
                ))}
              </div>
              <label className="icongen__range">
                <input type="range" min={48} max={108} step={2} value={artDp} onChange={(e) => setArtDp(Number(e.target.value))} />
                <span>{artDp} dp</span>
              </label>
              <label className="icongen__check">
                <input type="checkbox" checked={showSafe} onChange={(e) => setShowSafe(e.target.checked)} />
                Show the {ANDROID_SAFE_DP} dp safe zone in the preview
              </label>
            </section>

            <div className="icongen__cta">
              <button type="button" className="btn btn--primary btn--lg" disabled={!loaded || busy} onClick={() => void generate()}>
                {busy ? 'Generating…' : `Download ${TOTAL_FILES} icons (.zip)`}
              </button>
              <p className="icongen__hint" role="status">
                {done ? `✓ Downloaded ${done} icons. Unzip and follow README.txt.` : 'iOS · Android · Google Play'}
              </p>
            </div>
          </aside>

          {/* ── Previews ── */}
          <section className="icongen__stage" aria-label="Preview">
            {!previews ? (
              <div className="icongen__empty">
                <div className="icongen__ghosts" aria-hidden="true">
                  <span />
                  <span className="is-circle" />
                  <span />
                </div>
                <p>Upload an image to see it on an iPhone home screen, Android launchers and Google Play.</p>
              </div>
            ) : (
              <>
                <div className="icongen__stagehead">
                  <h2>Preview</h2>
                  <label>
                    App name
                    <input type="text" value={appName} maxLength={24} onChange={(e) => setAppName(e.target.value)} />
                  </label>
                </div>

                <article className="icongen__card icongen__card--ios">
                  <header>iPhone</header>
                  <div className="icongen__home">
                    {['', '', name, ''].map((label, i) =>
                      label ? (
                        <figure key={i}>
                          <img src={previews.ios} alt={`${name} on the home screen`} width={60} height={60} />
                          <figcaption>{label}</figcaption>
                        </figure>
                      ) : (
                        <figure key={i} aria-hidden="true">
                          <span className="icongen__ghost" />
                          <figcaption>&nbsp;</figcaption>
                        </figure>
                      ),
                    )}
                  </div>
                  <div className="icongen__rows">
                    <div>
                      <img src={previews.ios40} alt="" width={40} height={40} />
                      <span>
                        <strong>{name}</strong>
                        <small>Spotlight · 40 pt</small>
                      </span>
                    </div>
                    <div>
                      <img src={previews.ios29} alt="" width={29} height={29} />
                      <span>
                        <strong>{name}</strong>
                        <small>Settings · 29 pt</small>
                      </span>
                    </div>
                  </div>
                </article>

                <article className="icongen__card">
                  <header>Android launchers</header>
                  <div className="icongen__shapes">
                    {(['circle', 'squircle', 'rounded', 'square'] as const).map((s) => (
                      <figure key={s}>
                        <span className="icongen__shape">
                          <img src={previews[s]} alt={`${s} launcher icon`} width={64} height={64} />
                          {showSafe && <span className="icongen__safe" aria-hidden="true" />}
                        </span>
                        <figcaption>{s === 'square' ? 'Legacy' : s[0].toUpperCase() + s.slice(1)}</figcaption>
                      </figure>
                    ))}
                  </div>
                </article>

                <article className="icongen__card">
                  <header>Google Play</header>
                  <div className="icongen__play">
                    <img src={previews.play} alt="Google Play listing icon" width={72} height={72} />
                    <div>
                      <strong>{name}</strong>
                      <span>Your company</span>
                      <small>4.8 ★ · 10K+ downloads</small>
                    </div>
                    <span className="icongen__install">Install</span>
                  </div>
                </article>
              </>
            )}

            <details className="icongen__files">
              <summary>
                What’s in the ZIP <span>{TOTAL_FILES} icons</span>
              </summary>
              <dl>
                <dt>iOS · {IOS_FILES} PNGs</dt>
                <dd>
                  <code>ios/AppIcon.appiconset/</code> with <code>Contents.json</code> — drag into Assets in Xcode. Square and
                  opaque; iOS rounds the corners.
                </dd>
                <dt>Android · {ANDROID_FILES} PNGs</dt>
                <dd>
                  <code>android/res/mipmap-*/</code> <code>ic_launcher</code>, <code>ic_launcher_round</code> and the adaptive{' '}
                  <code>ic_launcher_foreground</code>, plus the adaptive-icon XML and background colour — copy into{' '}
                  <code>app/src/main/res/</code>.
                </dd>
                <dt>Google Play · 1 PNG</dt>
                <dd>
                  <code>android/playstore-icon.png</code>, 512 × 512, for the store listing.
                </dd>
              </dl>
            </details>
          </section>
        </div>
      </main>
    </div>
  );
}
