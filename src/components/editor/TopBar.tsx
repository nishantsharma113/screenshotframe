import { Icon } from '@/components/Icon';
import { Logo } from '@/components/Logo';
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
  return (
    <header className="topbar">
      <div className="topbar__left">
        <Logo dark />
        <span className="topbar__sep" aria-hidden="true">
          /
        </span>
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
        <span className={`topbar__status ${p.status === 'error' ? 'is-error' : ''}`} aria-live="polite">
          {STATUS_TEXT[p.status]}
        </span>
      </div>

      <div className="segmented segmented--dark" role="group" aria-label="Store">
        <button type="button" aria-pressed={p.store === 'ios'} onClick={() => p.onStore('ios')}>
          App Store
        </button>
        <button type="button" aria-pressed={p.store === 'play'} onClick={() => p.onStore('play')}>
          Google Play
        </button>
      </div>

      <div className="topbar__right">
        <button type="button" className="icon-btn" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!p.canUndo} onClick={p.onUndo}>
          <Icon name="undo" />
        </button>
        <button type="button" className="icon-btn" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!p.canRedo} onClick={p.onRedo}>
          <Icon name="redo" />
        </button>
        <button type="button" className="btn btn--ghost-dark" onClick={p.onSaveTemplate}>
          Save as template
        </button>
        <button type="button" className="btn btn--primary" onClick={p.onExport}>
          <Icon name="download" size={16} />
          Export
        </button>
      </div>
    </header>
  );
}
