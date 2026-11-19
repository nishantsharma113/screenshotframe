import { useEffect, useRef, useState, type Dispatch } from 'react';
import { Icon } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { SizePicker } from '@/components/editor/SizePicker';
import type { Design, SaveStatus, Store } from '@/lib/types';
import type { EditorAction } from '@/store/editorReducer';

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  local: 'Saved in this browser',
  error: 'Couldn’t save',
};

interface TopBarProps {
  name: string;
  onRename: (name: string) => void;
  status: SaveStatus;
  /** Save again after a failed save. */
  onRetrySave: () => void;
  design: Design;
  dispatch: Dispatch<EditorAction>;
  onStore: (store: Store) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onExport: () => void;
  onSaveTemplate: () => void;
  /** Saved templates aren't on the user's plan: show a "Pro" badge on the menu item. */
  templatesLocked: boolean;
  onShortcuts: () => void;
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

  const choose = (action: () => void) => () => {
    setMenuOpen(false);
    action();
  };

  return (
    <header className="topbar">
      <Logo compact />
      <div className="topbar__left">
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
          {p.status === 'error' && (
            <button type="button" className="topbar__retry" onClick={p.onRetrySave}>
              Retry
            </button>
          )}
        </span>
      </div>

      <div className="topbar__spacer" />

      <div className="segmented" role="group" aria-label="Store">
        <button type="button" aria-pressed={p.design.store === 'ios'} onClick={() => p.onStore('ios')}>
          App Store
        </button>
        <button type="button" aria-pressed={p.design.store === 'play'} onClick={() => p.onStore('play')}>
          Google Play
        </button>
      </div>

      <SizePicker design={p.design} dispatch={p.dispatch} />

      <div className="topbar__tools">
        <button type="button" className="icon-btn" aria-label="Undo (Ctrl Z)" title="Undo (Ctrl Z)" disabled={!p.canUndo} onClick={p.onUndo}>
          <Icon name="undo" />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Redo (Ctrl Shift Z)"
          title="Redo (Ctrl Shift Z)"
          disabled={!p.canRedo}
          onClick={p.onRedo}
        >
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
            <div className="menu menu--wide" role="menu">
              <button type="button" role="menuitem" onClick={choose(p.onSaveTemplate)}>
                Save as template
                {p.templatesLocked && <span className="menu__badge">Pro</span>}
              </button>
              <button type="button" role="menuitem" onClick={choose(p.onShortcuts)}>
                Keyboard shortcuts <kbd>?</kbd>
              </button>
            </div>
          )}
        </div>
      </div>

      <button type="button" className="btn btn--primary topbar__export" onClick={p.onExport}>
        <Icon name="download" size={16} />
        Export
      </button>
    </header>
  );
}
