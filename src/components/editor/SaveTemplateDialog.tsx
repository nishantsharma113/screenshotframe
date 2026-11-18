import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from '@/components/Icon';

interface SaveTemplateDialogProps {
  defaultName: string;
  /** Resolves when saved; a thrown Error's message is shown in the dialog. */
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}

/** Asks for a template name, then saves. Esc / Cancel / backdrop close it unless a save is running. */
export function SaveTemplateDialog({ defaultName, onSave, onClose }: SaveTemplateDialogProps) {
  const [name, setName] = useState(defaultName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saving, onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!name.trim()) return setError('Give the template a name.');
    setSaving(true);
    setError(null);
    try {
      await onSave(name.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the template.');
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => !saving && onClose()}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-template-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <div className="modal__head">
          <h2 id="save-template-title">Save as template</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose} disabled={saving}>
            <Icon name="close" />
          </button>
        </div>
        <p className="modal__lead">
          Saves the look of this project — device, background, fonts, layout and slide text — to My templates.
          Screenshots aren’t included.
        </p>
        <div className="modal__row">
          <label htmlFor="template-name" className="field__label">
            Name
          </label>
          <input
            ref={inputRef}
            id="template-name"
            type="text"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
          />
        </div>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost-dark" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save template'}
          </button>
        </div>
      </form>
    </div>
  );
}
