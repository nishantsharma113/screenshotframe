import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { EXPORT_SIZES, FEATURE_GRAPHIC_SIZE, languageLabel, orientationOf } from '@/lib/constants';
import { exportScreenshots, type ExportFormat } from '@/lib/export';
import type { Design } from '@/lib/types';

interface ExportDialogProps {
  design: Design;
  projectName: string;
  onClose: () => void;
}

export function ExportDialog({ design, projectName, onClose }: ExportDialogProps) {
  const orientation = orientationOf(design);
  // Sizes for this store in the design's orientation (portrait or landscape).
  const sizes = useMemo(
    () => EXPORT_SIZES.filter((s) => s.store === design.store && s.orientation === orientation),
    [design.store, orientation],
  );
  const hasFeature = design.store === 'play';
  const [feature, setFeature] = useState(hasFeature);
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(sizes.filter((s) => s.devices.includes(design.device)).map((s) => s.id)),
  );
  const [locales, setLocales] = useState<Set<string>>(() => new Set(design.locales));
  const [format, setFormat] = useState<ExportFormat>('png');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const busy = progress !== null;
  const running = useRef(false);

  // Focus once on open (not on every re-render, which would yank focus during export progress).
  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('input, button')?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const toggle = (set: Set<string>, value: string, update: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    update(next);
  };

  const run = async () => {
    if (running.current) return; // double click before the button re-renders as disabled
    running.current = true;
    setError(null);
    setProgress({ done: 0, total: 1 });
    try {
      await exportScreenshots({
        design,
        sizes: sizes.filter((s) => picked.has(s.id)),
        locales: design.locales.filter((l) => locales.has(l)),
        format,
        featureGraphic: hasFeature && feature,
        fileName: projectName,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      onClose();
    } catch (e) {
      setError(
        e instanceof Error
          ? `Export failed: ${e.message}. If your screenshots are hosted elsewhere, upload them again here.`
          : 'Export failed.',
      );
    } finally {
      running.current = false;
      setProgress(null);
    }
  };

  const fileCount = picked.size * locales.size * design.slides.length + (hasFeature && feature ? locales.size : 0);

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <h2 id="export-title">Export screenshots</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose} disabled={busy}>
            <Icon name="close" />
          </button>
        </div>
        <p className="modal__lead">Design once — every slide is rendered at each size you pick.</p>

        <fieldset className="checklist">
          <legend className="field__label">Sizes</legend>
          {sizes.map((s) => (
            <label key={s.id} className="checklist__row">
              <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(picked, s.id, setPicked)} />
              <span className="checklist__name">{s.label}</span>
              <span className="checklist__meta">
                {s.width} × {s.height}
              </span>
            </label>
          ))}
          {hasFeature && (
            <label className="checklist__row">
              <input type="checkbox" checked={feature} onChange={() => setFeature((f) => !f)} />
              <span className="checklist__name">Feature graphic</span>
              <span className="checklist__meta">
                {FEATURE_GRAPHIC_SIZE.width} × {FEATURE_GRAPHIC_SIZE.height}
              </span>
            </label>
          )}
        </fieldset>

        {design.locales.length > 1 && (
          <fieldset className="checklist">
            <legend className="field__label">Languages</legend>
            {design.locales.map((code) => (
              <label key={code} className="checklist__row">
                <input type="checkbox" checked={locales.has(code)} onChange={() => toggle(locales, code, setLocales)} />
                <span className="checklist__name">{languageLabel(code)}</span>
              </label>
            ))}
          </fieldset>
        )}

        <div className="modal__row">
          <label htmlFor="format" className="field__label">
            Format
          </label>
          <select id="format" value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
            <option value="png">PNG</option>
            <option value="jpeg">JPG</option>
          </select>
          <span className="checklist__meta">{fileCount} images</span>
        </div>

        {progress && (
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
            <div className="progress__bar" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            <span>
              Rendering {progress.done} of {progress.total}…
            </span>
          </div>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}

        <div className="modal__actions">
          <button type="button" className="btn btn--ghost-dark" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={run} disabled={busy || fileCount === 0}>
            <Icon name="download" size={16} />
            {busy ? 'Exporting…' : 'Download ZIP'}
          </button>
        </div>
      </div>
    </div>
  );
}
