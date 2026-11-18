import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { RequirementBadge } from '@/components/editor/SizePicker';
import { getPreset, groupsForStore, presetsInGroup, slideCountWarnings, type SizeGroup } from '@/config/storeSizes';
import { languageLabel, orientationOf } from '@/lib/constants';
import { exportScreenshots, type ExportFormat, type ExportResult } from '@/lib/export';
import type { Design } from '@/lib/types';

interface ExportDialogProps {
  design: Design;
  projectName: string;
  onClose: () => void;
}

const dims = (w: number, h: number, landscape: boolean) => (landscape ? `${h} × ${w}` : `${w} × ${h}`);

export function ExportDialog({ design, projectName, onClose }: ExportDialogProps) {
  const orientation = orientationOf(design);
  const landscape = orientation === 'landscape';
  const groups = useMemo(() => groupsForStore(design.store), [design.store]);
  // Ticked by default: the size being edited, plus every size the store requires.
  const [picked, setPicked] = useState<Set<string>>(() => {
    const ids = new Set<string>();
    if (getPreset(design.sizeId)) ids.add(design.sizeId!);
    for (const g of groups) {
      if (g.required?.level !== 'required') continue;
      if (g.kind === 'icon' && !design.featureGraphic?.iconUrl) continue;
      const first = presetsInGroup(g.id)[0];
      if (first && !presetsInGroup(g.id).some((p) => ids.has(p.id))) ids.add(first.id);
    }
    return ids;
  });
  const [locales, setLocales] = useState<Set<string>>(() => new Set(design.locales));
  const [format, setFormat] = useState<ExportFormat>('png');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const busy = progress !== null;
  const running = useRef(false);

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

  const jobs = [...picked].flatMap((id) => {
    const preset = getPreset(id);
    return preset ? [{ preset, orientation }] : [];
  });
  const pickedGroups = jobs.map((j) => j.preset.groupId);
  const countWarnings = slideCountWarnings(pickedGroups, design.slides.length);
  const groupKind = (g: SizeGroup) => g.kind;
  const fileCount = jobs.reduce((n, j) => {
    const kind = groupKind(groups.find((g) => g.id === j.preset.groupId)!);
    return n + (kind === 'screenshot' ? design.slides.length * locales.size : kind === 'feature' ? locales.size : 1);
  }, 0);

  const run = async () => {
    if (running.current) return;
    running.current = true;
    setError(null);
    setResult(null);
    setProgress({ done: 0, total: 1 });
    try {
      const r = await exportScreenshots({
        design,
        jobs,
        locales: design.locales.filter((l) => locales.has(l)),
        format,
        fileName: projectName,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      if (r.warnings.length) setResult(r); // keep the dialog open so the warnings can be read
      else onClose();
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

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div
        ref={dialogRef}
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <h2 id="export-title">Export for {design.store === 'ios' ? 'the App Store' : 'Google Play'}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose} disabled={busy}>
            <Icon name="close" />
          </button>
        </div>
        <p className="modal__lead">
          Every slide is rendered at the exact pixel size of each size you tick{landscape ? ' (landscape)' : ''}, with no
          transparency.
        </p>

        <div className="export-sizes">
          {groups.map((g) => (
            <fieldset key={g.id} className="checklist">
              <legend className="field__label">
                {g.label} <RequirementBadge group={g} />
              </legend>
              {presetsInGroup(g.id).map((p) => {
                const noIcon = g.kind === 'icon' && !design.featureGraphic?.iconUrl;
                return (
                  <label key={p.id} className="checklist__row" title={noIcon ? 'Upload an app icon first (Google Play → feature graphic)' : undefined}>
                    <input type="checkbox" checked={picked.has(p.id)} disabled={noIcon} onChange={() => toggle(picked, p.id, setPicked)} />
                    <span className="checklist__name">
                      {dims(p.width, p.height, landscape && g.kind === 'screenshot')}
                      {p.id === design.sizeId && <span className="size-current"> · editing</span>}
                    </span>
                    <span className="checklist__meta">
                      {g.kind === 'icon' ? (noIcon ? 'no icon uploaded' : 'from your app icon') : g.kind === 'feature' ? 'one per language' : ''}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          ))}
        </div>

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

        {countWarnings.length > 0 && (
          <ul className="export-warnings" role="status">
            {countWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}

        <div className="modal__row">
          <label htmlFor="format" className="field__label">
            Format
          </label>
          <select id="format" value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
            <option value="png">PNG (24-bit, no alpha)</option>
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
        {result && (
          <div className="export-done" role="status">
            <p>
              Downloaded {result.files} images. Check before uploading:
            </p>
            <ul className="export-warnings">
              {result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="modal__actions">
          <button type="button" className="btn btn--ghost-dark" onClick={onClose} disabled={busy}>
            {result ? 'Close' : 'Cancel'}
          </button>
          <button type="button" className="btn btn--primary" onClick={run} disabled={busy || fileCount === 0 || locales.size === 0}>
            <Icon name="download" size={16} />
            {busy ? 'Exporting…' : 'Download ZIP'}
          </button>
        </div>
      </div>
    </div>
  );
}
