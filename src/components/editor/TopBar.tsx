import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import type { SaveStatus, Store } from '@/lib/types';

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  local: 'Saved in this browser',
  error: 'Not saved',
};

interface TopBarProps {
  name: string;
  onRename: (name: string) => void;
  status: SaveStatus;
  store: Store;
  onStore: (store: Store) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onExport: () => void;
  onSaveTemplate: () => void;
}

export function TopBar(p: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the "More" menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <header className="topbar">
      <div className="topbar__left">
        <Logo compact />
        <label className="sr-only" htmlFor="project-name">
          Project name
        </label>
        <input
          id="project-name"
          className="topbar__name"
          value={p.name}
          placeholder="Untitled project"
          maxLength={120}
          onChange={(e) => p.onRename(e.target.value)}
        />
        <span className={`topbar__status is-${p.status}`} aria-live="polite">
          {STATUS_TEXT[p.status]}
        </span>
      </div>

      <div className="topbar__right">
        <div className="segmented" role="group" aria-label="Store">
          <button type="button" aria-pressed={p.store === 'ios'} onClick={() => p.onStore('ios')}>
            App Store
          </button>
          <button type="button" aria-pressed={p.store === 'play'} onClick={() => p.onStore('play')}>
            Google Play
          </button>
        </div>
        <button type="button" className="icon-btn" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!p.canUndo} onClick={p.onUndo}>
          <Icon name="undo" />
        </button>
        <button type="button" className="icon-btn" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!p.canRedo} onClick={p.onRedo}>
          <Icon name="redo" />
        </button>
        <ThemeToggle />
        <div className="menu-anchor" ref={menuRef}>
          <button
            type="button"
            className="icon-btn"
            aria-label="More"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <Icon name="more" />
          </button>
          {menuOpen && (
            <div className="menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  p.onSaveTemplate();
                }}
              >
                Save as template
              </button>
            </div>
          )}
        </div>
        <button type="button" className="btn btn--primary" onClick={p.onExport}>
          <Icon name="download" size={16} />
          Export
        </button>
      </div>
    </header>
  );
}
