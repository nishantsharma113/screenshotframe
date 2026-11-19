import { useEffect, useId, useMemo, useRef, useState, type Dispatch, type KeyboardEvent } from 'react';
import { Icon } from '@/components/Icon';
import { getPreset, groupOf, groupsForStore, presetsInGroup, type SizeGroup } from '@/config/storeSizes';
import { orientationOf, previewSizeFor } from '@/lib/constants';
import type { Design } from '@/lib/types';
import type { EditorAction } from '@/store/editorReducer';

/** "Required" / "Required for iPad apps" / "Required from Apr 2027" badge for a size group. */
export function RequirementBadge({ group }: { group: SizeGroup }) {
  if (!group.required) return null;
  return <span className={`req-badge req-badge--${group.required.level}`}>{group.required.label}</span>;
}

/** Outline of a screen at the given aspect, `max` px on its long side. */
function Thumb({ width, height, max = 22 }: { width: number; height: number; max?: number }) {
  const w = width >= height ? max : Math.max(8, Math.round((max * width) / height));
  const h = height >= width ? max : Math.max(8, Math.round((max * height) / width));
  return <span className="size-thumb" style={{ width: w, height: h }} aria-hidden="true" />;
}

interface SizePickerProps {
  design: Design;
  dispatch: Dispatch<EditorAction>;
}

/**
 * Store size picker for the editor top bar: search, portrait/landscape, and every
 * screenshot size of the current store. Picking one sets the slide size and its device frame.
 */
export function SizePicker({ design, dispatch }: SizePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const preset = getPreset(design.sizeId);
  const group = preset ? groupOf(preset) : null;
  const size = previewSizeFor(design);
  const landscape = orientationOf(design) === 'landscape';
  const store = design.store === 'ios' ? 'App Store' : 'Google Play';

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groupsForStore(design.store, 'screenshot').flatMap((g) =>
      presetsInGroup(g.id)
        .map((p) => {
          const [w, h] = landscape ? [p.height, p.width] : [p.width, p.height];
          return { preset: p, group: g, w, h, px: `${w} × ${h}`, main: presetsInGroup(g.id)[0]?.id === p.id };
        })
        .filter((o) => !q || `${o.group.label} ${o.px} ${o.w}x${o.h}`.toLowerCase().includes(q)),
    );
  }, [design.store, landscape, query]);

  // Options grouped under one heading per device size, keeping each one's flat index for the keyboard.
  const sections = useMemo(() => {
    const out: { group: SizeGroup; items: { o: (typeof options)[number]; i: number }[] }[] = [];
    options.forEach((o, i) => {
      const last = out[out.length - 1];
      if (last && last.group.id === o.group.id) last.items.push({ o, i });
      else out.push({ group: o.group, items: [{ o, i }] });
    });
    return out;
  }, [options]);

  // Open with the current size highlighted.
  useEffect(() => {
    if (!open) return;
    const i = options.findIndex((o) => o.preset.id === design.sizeId);
    setActive(i < 0 ? 0 : i);
    // Only when opening or the list changes.
  }, [open, options]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  // Keep the highlighted option in view.
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, listId]);

  const close = () => {
    setOpen(false);
    setQuery('');
    buttonRef.current?.focus();
  };

  const pick = (id: string) => {
    const g = groupOf(getPreset(id)!);
    dispatch({ type: 'set', patch: { sizeId: id, ...(g.device ? { device: g.device } : {}) } });
    close();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!options.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + options.length) % options.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = options[active];
      if (o) pick(o.preset.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  // Store limits for the size being edited.
  const count = design.slides.length;
  const min = group?.minShots;
  const max = group?.maxShots;
  const outOfRange = (min !== undefined && count < min) || (max !== undefined && count > max);
  const countNote =
    min && max && min > 1
      ? `${store} needs ${min}–${max} screenshots for this size. You have ${count}.`
      : max
        ? `${store} accepts up to ${max} screenshots per size. You have ${count}.`
        : null;

  return (
    <div className="size-picker" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="size-picker__button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Screenshot size: ${group?.label ?? 'Size'}, ${size.width} × ${size.height}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Thumb width={size.width} height={size.height} />
        <span className="size-picker__group">{group?.label ?? 'Size'}</span>
        <span className="size-picker__dims">
          {size.width} × {size.height}
        </span>
        <Icon name="chevron" size={14} />
      </button>

      {open && (
        <div className="size-picker__menu">
          <div className="size-picker__top">
            <div className="size-picker__search">
              <Icon name="search" size={16} />
              <input
                type="search"
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
                aria-label="Search sizes"
                placeholder="Search sizes"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKey}
              />
            </div>
            <div className="segmented segmented--icons" role="group" aria-label="Orientation">
              <button
                type="button"
                aria-label="Portrait"
                aria-pressed={!landscape}
                onClick={() => dispatch({ type: 'set', patch: { orientation: 'portrait' } })}
              >
                <Thumb width={9} height={16} max={16} />
              </button>
              <button
                type="button"
                aria-label="Landscape"
                aria-pressed={landscape}
                onClick={() => dispatch({ type: 'set', patch: { orientation: 'landscape' } })}
              >
                <Thumb width={16} height={9} max={16} />
              </button>
            </div>
          </div>

          <div id={listId} className="size-picker__list" role="listbox" aria-label={`${store} screenshot sizes`}>
            {sections.map(({ group: g, items }) => (
              <div key={g.id} className="size-picker__section" role="group" aria-labelledby={`${listId}-${g.id}`}>
                <div className="size-picker__heading" id={`${listId}-${g.id}`}>
                  <span>{g.label}</span>
                  <RequirementBadge group={g} />
                </div>
                {items.map(({ o, i }) => (
                  <button
                    key={o.preset.id}
                    id={`${listId}-${i}`}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={o.preset.id === design.sizeId}
                    className={`size-picker__option ${i === active ? 'is-active' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(o.preset.id)}
                  >
                    <span className="size-picker__thumb">
                      <Thumb width={o.w} height={o.h} max={20} />
                    </span>
                    <span className="size-picker__px">{o.px}</span>
                    {o.main && items.length > 1 && <span className="size-picker__main">Main</span>}
                    {o.preset.id === design.sizeId && <Icon name="check" size={16} />}
                  </button>
                ))}
              </div>
            ))}
            {options.length === 0 && <p className="size-picker__none">No sizes match “{query}”.</p>}
          </div>

          {countNote && (
            <div className={`size-picker__note ${outOfRange ? 'is-warning' : ''}`} role="status">
              {outOfRange && <Icon name="warning" size={14} />}
              {countNote}
            </div>
          )}
          <span className="size-picker__keys">↑ ↓ to move · Enter to choose · Esc to close</span>
        </div>
      )}
    </div>
  );
}
