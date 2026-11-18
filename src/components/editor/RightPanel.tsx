import { useRef, useState, type Dispatch } from 'react';
import { Icon } from '@/components/Icon';
import { FONTS, LANGUAGES, customFontId, customFontRef, isRtl, languageLabel, textFor } from '@/lib/constants';
import type { Angle, Design, DesignFont, TextSize } from '@/lib/types';
import type { UserFont } from '@/services/fonts';
import type { EditorAction } from '@/store/editorReducer';

const UPLOAD_FONT = '__upload__';

/** Why "Upload font…" can or can't be used right now. */
export type FontUploadAccess = 'ok' | 'plan' | 'signin' | 'unavailable';

interface RightPanelProps {
  design: Design;
  selected: number;
  dispatch: Dispatch<EditorAction>;
  can3d: boolean;
  canLocalize: boolean;
  onLocked: (feature: string) => void;
  userFonts: UserFont[];
  fontUploadAccess: FontUploadAccess;
  fontUploading: boolean;
  onUploadFont: (file: File) => void;
  onNotice: (message: string) => void;
  /** Auto-translate every slide into this locale from the main language. */
  onAutoTranslate: (locale: string) => void;
  translating: boolean;
}

const ANGLES: { id: Angle; label: string }[] = [
  { id: 'flat', label: 'Flat' },
  { id: 'left', label: '3D left' },
  { id: 'right', label: '3D right' },
];

export function RightPanel({
  design,
  selected,
  dispatch,
  can3d,
  canLocalize,
  onLocked,
  userFonts,
  fontUploadAccess,
  fontUploading,
  onUploadFont,
  onNotice,
  onAutoTranslate,
  translating,
}: RightPanelProps) {
  const slide = design.slides[selected];
  const [addingLang, setAddingLang] = useState('');
  const fontInput = useRef<HTMLInputElement>(null);
  const currentCustom = customFontId(design.font);
  const currentMissing = currentCustom !== null && !userFonts.some((f) => f.id === currentCustom);

  const pickFont = (value: string) => {
    if (value !== UPLOAD_FONT) return set({ font: value as DesignFont });
    if (fontUploadAccess === 'plan') return onLocked('Custom fonts');
    if (fontUploadAccess === 'signin') return onNotice('Sign in to upload your own fonts.');
    if (fontUploadAccess === 'unavailable') return onNotice('Font upload needs Supabase (see README).');
    fontInput.current?.click();
  };
  const set = (patch: Partial<Design>) => dispatch({ type: 'set', patch });
  const available = LANGUAGES.filter((l) => !design.locales.includes(l.code));

  if (!slide) return null;

  return (
    <aside className="panel panel--right" aria-label="Slide properties">
      <h2 className="panel__title">
        Slide {selected + 1}
        {design.locales.length > 1 && <span className="panel__locale"> · {languageLabel(design.activeLocale)}</span>}
      </h2>

      <div className="field">
        <label htmlFor="headline">Headline</label>
        <textarea
          id="headline"
          rows={2}
          dir={isRtl(design.activeLocale) ? 'rtl' : undefined}
          value={textFor(slide.headline, design.activeLocale)}
          onChange={(e) => dispatch({ type: 'setText', field: 'headline', value: e.target.value })}
        />
      </div>

      <div className="field">
        <label htmlFor="subtitle">Subtitle</label>
        <input
          id="subtitle"
          type="text"
          dir={isRtl(design.activeLocale) ? 'rtl' : undefined}
          value={textFor(slide.subtitle, design.activeLocale)}
          onChange={(e) => dispatch({ type: 'setText', field: 'subtitle', value: e.target.value })}
        />
      </div>

      <div className="grid-2">
        <div className="field">
          <label htmlFor="font">Font</label>
          <select id="font" value={design.font} disabled={fontUploading} onChange={(e) => pickFont(e.target.value)}>
            {FONTS.map((f) => (
              <option key={f}>{f}</option>
            ))}
            {(userFonts.length > 0 || currentMissing) && (
              <optgroup label="Your fonts">
                {userFonts.map((f) => (
                  <option key={f.id} value={customFontRef(f.id)}>
                    {f.family}
                  </option>
                ))}
                {currentMissing && <option value={design.font}>Uploaded font (unavailable)</option>}
              </optgroup>
            )}
            <option value={UPLOAD_FONT}>
              {fontUploading ? 'Uploading font…' : fontUploadAccess === 'plan' ? 'Upload font… (Pro)' : 'Upload font…'}
            </option>
          </select>
          <input
            ref={fontInput}
            type="file"
            accept=".ttf,.otf,.woff2,font/ttf,font/otf,font/woff2"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ''; // picking the same file again still fires
              if (file) onUploadFont(file);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="size">Text size</label>
          <select id="size" value={design.textSize} onChange={(e) => set({ textSize: e.target.value as TextSize })}>
            <option value="lg">Large</option>
            <option value="md">Medium</option>
            <option value="sm">Small</option>
          </select>
        </div>
      </div>

      <div className="field">
        <span className="field__label">Device angle</span>
        <div className="grid-3">
          {ANGLES.map((a) => {
            const locked = a.id !== 'flat' && !can3d;
            return (
              <button
                key={a.id}
                type="button"
                className="option-btn"
                aria-pressed={design.angle === a.id}
                onClick={() => (locked ? onLocked('3D angles') : set({ angle: a.id }))}
              >
                {a.label}
                {locked && <span className="lock"> · Pro</span>}
              </button>
            );
          })}
        </div>
      </div>

      <label className="field-row">
        Device shadow
        <input type="checkbox" checked={design.shadow} onChange={(e) => set({ shadow: e.target.checked })} />
      </label>

      <div className="field field--divider">
        <span className="field__label">Languages</span>
        <div className="lang-chips">
          {design.locales.map((code) => (
            <span key={code} className={`lang-chip ${code === design.activeLocale ? 'is-active' : ''}`}>
              <button type="button" aria-pressed={code === design.activeLocale} onClick={() => dispatch({ type: 'setLocale', code })}>
                {languageLabel(code)}
              </button>
              {design.locales.length > 1 && (
                <button
                  type="button"
                  className="lang-chip__remove"
                  aria-label={`Remove ${languageLabel(code)}`}
                  onClick={() => dispatch({ type: 'removeLocale', code })}
                >
                  <Icon name="close" size={12} />
                </button>
              )}
            </span>
          ))}
        </div>
        {available.length > 0 && (
          <div className="lang-add">
            <label className="sr-only" htmlFor="add-lang">
              Add language
            </label>
            <select id="add-lang" value={addingLang} onChange={(e) => setAddingLang(e.target.value)}>
              <option value="">Add language…</option>
              {available.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn--small"
              disabled={!addingLang}
              onClick={() => {
                if (!canLocalize) return onLocked('Localization');
                dispatch({ type: 'addLocale', code: addingLang });
                setAddingLang('');
              }}
            >
              Add
            </button>
          </div>
        )}
        {design.locales.length > 1 && design.activeLocale !== design.locales[0] && (
          <button
            type="button"
            className="btn btn--small"
            disabled={translating}
            onClick={() => onAutoTranslate(design.activeLocale)}
          >
            {translating ? 'Translating…' : `Auto-translate to ${languageLabel(design.activeLocale)}`}
          </button>
        )}
        <p className="hint">
          A new language starts with a copy of the current text. Edit each slide, or use Auto-translate (from{' '}
          {languageLabel(design.locales[0])}; replaces this language’s text, Undo restores it).
        </p>
      </div>

      <div className="field field--divider">
        <span className="field__label">Position</span>
        <p className="hint">
          Drag the headline or device on the canvas; drag the corner square to resize. Arrow keys nudge (Shift = 10),
          + / − resize, Alt while dragging turns off centre snapping.
        </p>
        {(slide.textBox || slide.deviceBox) && (
          <button type="button" className="btn btn--ghost-dark" onClick={() => dispatch({ type: 'resetLayout', index: selected })}>
            Reset position on this slide
          </button>
        )}
      </div>

      {slide.imageUrl && (
        <button type="button" className="btn btn--ghost-dark" onClick={() => dispatch({ type: 'clearImage', index: selected })}>
          Remove screenshot from this slide
        </button>
      )}
    </aside>
  );
}
