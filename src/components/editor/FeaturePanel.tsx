import { useRef, type Dispatch } from 'react';
import { isRtl, languageLabel, textFor } from '@/lib/constants';
import type { Design } from '@/lib/types';
import type { EditorAction } from '@/store/editorReducer';

interface FeaturePanelProps {
  design: Design;
  dispatch: Dispatch<EditorAction>;
  uploading: boolean;
  onIconFiles: (files: File[]) => void;
}

/** Right-hand panel while the Google Play feature graphic is selected. */
export function FeaturePanel({ design, dispatch, uploading, onIconFiles }: FeaturePanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const fg = design.featureGraphic;
  const own = fg?.headline[design.activeLocale];
  // Until it's edited, the feature graphic shows the first slide's headline.
  const fallback = textFor(design.slides[0]?.headline ?? {}, design.activeLocale);

  return (
    <aside className="panel panel--right" aria-label="Feature graphic properties">
      <h2 className="panel__title">
        Feature graphic
        {design.locales.length > 1 && <span className="panel__locale"> · {languageLabel(design.activeLocale)}</span>}
      </h2>
      <p className="hint">Google Play · 1024 × 500. Uses the project background and font.</p>

      <div className="field">
        <label htmlFor="feature-headline">Headline</label>
        <textarea
          id="feature-headline"
          rows={2}
          dir={isRtl(design.activeLocale) ? 'rtl' : undefined}
          value={own ?? fallback}
          onChange={(e) => dispatch({ type: 'setFeatureText', value: e.target.value })}
        />
      </div>

      {design.locales.length > 1 && (
        <div className="field">
          <label htmlFor="feature-locale">Language</label>
          <select id="feature-locale" value={design.activeLocale} onChange={(e) => dispatch({ type: 'setLocale', code: e.target.value })}>
            {design.locales.map((code) => (
              <option key={code} value={code}>
                {languageLabel(code)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field field--divider">
        <span className="field__label">App icon (optional)</span>
        {fg?.iconUrl && (
          <img
            src={fg.iconUrl}
            alt="App icon"
            style={{ width: 64, height: 64, borderRadius: 14, objectFit: 'cover', display: 'block', marginBottom: 8 }}
          />
        )}
        <div className="row-gap">
          <button type="button" className="btn btn--small" disabled={uploading} onClick={() => inputRef.current?.click()}>
            {uploading ? 'Uploading…' : fg?.iconUrl ? 'Replace icon' : 'Upload icon'}
          </button>
          {fg?.iconUrl && (
            <button
              type="button"
              className="btn btn--small btn--ghost-dark"
              onClick={() => dispatch({ type: 'setFeatureIcon', url: null, path: null })}
            >
              Remove icon
            </button>
          )}
        </div>
        <p className="hint">Square PNG, JPG or WebP. You can also drop it on the feature graphic.</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            onIconFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </div>
    </aside>
  );
}
