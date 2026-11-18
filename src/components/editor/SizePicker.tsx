import { useEffect, useRef, useState, type Dispatch } from 'react';
import { getPreset, groupOf, groupsForStore, presetsInGroup, type SizeGroup } from '@/config/storeSizes';
import { orientationOf, previewSizeFor } from '@/lib/constants';
import type { Design } from '@/lib/types';
import type { EditorAction } from '@/store/editorReducer';

/** "Required" / "Required for iPad apps" / "Required from Apr 2027" badge for a size group. */
export function RequirementBadge({ group }: { group: SizeGroup }) {
  if (!group.required) return null;
  return <span className={`req-badge req-badge--${group.required.level}`}>{group.required.label}</span>;
}

interface SizePickerProps {
  design: Design;
  dispatch: Dispatch<EditorAction>;
}

/** Store size presets, grouped by device. Picking one sets the slide size and its device frame. */
export function SizePicker({ design, dispatch }: SizePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const preset = getPreset(design.sizeId);
  const group = preset ? groupOf(preset) : null;
  const size = previewSizeFor(design);
  const landscape = orientationOf(design) === 'landscape';

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);

  const pick = (id: string) => {
    const g = groupOf(getPreset(id)!);
    dispatch({ type: 'set', patch: { sizeId: id, ...(g.device ? { device: g.device } : {}) } });
    setOpen(false);
  };

  return (
    <div className="size-picker" ref={rootRef}>
      <button
        type="button"
        className="size-picker__button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="size-picker__group">{group?.label ?? 'Size'}</span>
        <span className="size-picker__dims">
          {size.width} × {size.height}
          {group && <RequirementBadge group={group} />}
        </span>
      </button>
      {open && (
        <div className="size-picker__menu" role="listbox" aria-label={`${design.store === 'ios' ? 'App Store' : 'Google Play'} sizes`}>
          {groupsForStore(design.store, 'screenshot').map((g) => (
            <div key={g.id} className="size-picker__section" role="group" aria-label={g.label}>
              <div className="size-picker__heading">
                {g.label} <RequirementBadge group={g} />
              </div>
              {presetsInGroup(g.id).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={p.id === design.sizeId}
                  className="size-picker__option"
                  onClick={() => pick(p.id)}
                >
                  {landscape ? `${p.height} × ${p.width}` : `${p.width} × ${p.height}`}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
