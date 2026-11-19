import { useEffect, useRef, useState, type Dispatch } from 'react';
import { Icon } from '@/components/Icon';
import { SWATCHES, effectiveBackdrop, mixHex, orientationOf, projectBackdrop } from '@/lib/constants';
import type { Backdrop, Design } from '@/lib/types';
import type { EditorAction } from '@/store/editorReducer';

interface LeftPanelProps {
  design: Design;
  /** Selected slide, for "This slide" background overrides. */
  selected: number;
  dispatch: Dispatch<EditorAction>;
  uploading: boolean;
  onFiles: (files: File[]) => void;
  /** Background image picked for the project or for one slide. */
  onBackgroundImage: (files: File[], target: 'project' | number) => void;
}

export function LeftPanel({ design, selected, dispatch, uploading, onFiles, onBackgroundImage }: LeftPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const set = (patch: Partial<Design>) => dispatch({ type: 'set', patch });
  const landscape = orientationOf(design) === 'landscape';

  // Background: whole project, or the selected slide's own override.
  const slide = design.slides[selected];
  const [scope, setScope] = useState<'all' | 'slide'>(slide?.backdrop ? 'slide' : 'all');
  // Opening a slide that has its own background shows that slide's scope; others show "All slides".
  useEffect(() => setScope(design.slides[selected]?.backdrop ? 'slide' : 'all'), [selected]); // eslint-disable-line react-hooks/exhaustive-deps
  const target: 'project' | number = scope === 'slide' ? selected : 'project';
  const bg: Backdrop = scope === 'slide' ? effectiveBackdrop(design, slide) : projectBackdrop(design);
  /** `key` merges a colour-picker / slider drag into one undo step. */
  const setBg = (patch: Partial<Backdrop>, key?: string) =>
    dispatch({ type: 'setBackdrop', target, patch, key: key ? `${key}:${String(target)}` : undefined });

  return (
    <aside className="panel panel--left" aria-label="Design options">
      <section className="panel__section">
        <h2 className="panel__label">Background</h2>
        <div className="grid-2" role="group" aria-label="Background applies to">
          <button type="button" className="option-btn" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
            All slides
          </button>
          <button type="button" className="option-btn" aria-pressed={scope === 'slide'} onClick={() => setScope('slide')}>
            Slide {selected + 1}
          </button>
        </div>
        {scope === 'slide' && (
          <p className="dropzone__hint">
            {slide?.backdrop ? 'This slide has its own background.' : 'Changes below give this slide its own background.'}
          </p>
        )}

        <div className="grid-2" role="group" aria-label="Fill">
          <button type="button" className="option-btn" aria-pressed={!bg.gradient} onClick={() => bg.gradient && setBg({ gradient: null })}>
            Solid
          </button>
          <button
            type="button"
            className="option-btn"
            aria-pressed={Boolean(bg.gradient)}
            onClick={() => !bg.gradient && setBg({ gradient: { angle: 135, from: bg.color, to: mixHex(bg.color, '#ffffff') } })}
          >
            Gradient
          </button>
        </div>

        {bg.gradient ? (
          <>
            <label className="field-row">
              From
              <input
                type="color"
                value={bg.gradient.from}
                onChange={(e) => setBg({ gradient: { ...bg.gradient!, from: e.target.value }, color: e.target.value }, 'bg-from')}
              />
            </label>
            <label className="field-row">
              To
              <input
                type="color"
                value={bg.gradient.to}
                onChange={(e) => setBg({ gradient: { ...bg.gradient!, to: e.target.value } }, 'bg-to')}
              />
            </label>
            <label className="field-row">
              Angle {bg.gradient.angle}°
              <input
                type="range"
                min={0}
                max={360}
                step={5}
                value={bg.gradient.angle}
                onChange={(e) => setBg({ gradient: { ...bg.gradient!, angle: Number(e.target.value) } }, 'bg-angle')}
              />
            </label>
          </>
        ) : (
          <>
            <div className="swatches">
              {SWATCHES.map((s) => (
                <button
                  key={s.hex}
                  type="button"
                  className="swatch"
                  aria-label={s.name}
                  aria-pressed={bg.color.toLowerCase() === s.hex.toLowerCase()}
                  style={{ background: s.hex }}
                  onClick={() => setBg({ color: s.hex })}
                />
              ))}
            </div>
            <label className="field-row">
              Custom colour
              <input type="color" value={bg.color} onChange={(e) => setBg({ color: e.target.value }, 'background-picker')} />
            </label>
          </>
        )}

        <div className="field-row">
          <span>Image</span>
          <span className="row-gap">
            <button type="button" className="btn btn--small" disabled={uploading} onClick={() => bgInputRef.current?.click()}>
              {bg.image ? 'Replace' : 'Add'}
            </button>
            {bg.image && (
              <button type="button" className="btn btn--small btn--ghost-dark" onClick={() => setBg({ image: null })}>
                Remove
              </button>
            )}
          </span>
        </div>
        <input
          ref={bgInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            onBackgroundImage(Array.from(e.target.files ?? []), target);
            e.target.value = '';
          }}
        />
        {scope === 'slide' && slide?.backdrop && (
          <button
            type="button"
            className="btn btn--small btn--ghost-dark"
            onClick={() => dispatch({ type: 'clearSlideBackdrop', index: selected })}
          >
            Use the project background
          </button>
        )}
        <label className="field-row">
          Panoramic background
          <input type="checkbox" checked={design.panoramic} onChange={(e) => set({ panoramic: e.target.checked })} />
        </label>
      </section>

      <section className="panel__section">
        <h2 className="panel__label">Layout</h2>
        <div className="grid-2">
          <button type="button" className="option-btn" aria-pressed={design.layout === 'top'} onClick={() => set({ layout: 'top' })}>
            {landscape ? 'Text left' : 'Text on top'}
          </button>
          <button type="button" className="option-btn" aria-pressed={design.layout === 'bottom'} onClick={() => set({ layout: 'bottom' })}>
            {landscape ? 'Text right' : 'Text below'}
          </button>
        </div>
      </section>

      <section className="panel__section">
        <h2 className="panel__label">Screenshots</h2>
        <button
          type="button"
          className={`dropzone ${dragging ? 'is-dragging' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            onFiles(Array.from(e.dataTransfer.files));
          }}
          disabled={uploading}
        >
          <Icon name="upload" size={24} />
          <span>{uploading ? 'Uploading…' : 'Drop app screenshots here'}</span>
          <span className="dropzone__hint">PNG, JPG or WebP · fills slides from the selected one</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={(e) => {
            onFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </section>
    </aside>
  );
}
