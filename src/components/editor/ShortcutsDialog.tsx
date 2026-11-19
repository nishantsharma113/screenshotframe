import { useEffect, useRef } from 'react';
import { Icon } from '@/components/Icon';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl';

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: [MOD, 'Z'], label: 'Undo' },
  { keys: [MOD, 'Shift', 'Z'], label: 'Redo' },
  { keys: [MOD, 'Y'], label: 'Redo' },
  { keys: ['←', '↑', '→', '↓'], label: 'Nudge the selected text or device by 1 px' },
  { keys: ['Shift', 'Arrow'], label: 'Nudge by 10 px' },
  { keys: ['+', '−'], label: 'Scale the selected text or device' },
  { keys: ['Esc'], label: 'Deselect' },
];

/** List of the editor's keyboard shortcuts (opened from the top bar's More menu). */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2 id="shortcuts-title">Keyboard shortcuts</h2>
          <button ref={closeRef} type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <dl className="shortcuts">
          {SHORTCUTS.map((s) => (
            <div key={s.keys.join('+') + s.label} className="shortcuts__row">
              <dt>{s.label}</dt>
              <dd>
                {s.keys.map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
