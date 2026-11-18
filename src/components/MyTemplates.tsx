import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SlideView } from '@/components/SlideView';
import { useAuth } from '@/hooks/useAuth';
import { previewSizeFor } from '@/lib/constants';
import { isSupabaseConfigured } from '@/lib/supabase';
import { ensureDesignFonts } from '@/services/fonts';
import { deleteUserTemplate, listUserTemplates, type UserTemplate } from '@/services/userTemplates';

/** "My templates" tab on /templates: the signed-in user's saved templates. */
export function MyTemplates() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<UserTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setError(null);
    listUserTemplates()
      .then((list) => {
        if (cancelled) return;
        setTemplates(list);
        void ensureDesignFonts(list.map((t) => t.design)); // previews use uploaded fonts too
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load your templates.'));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!isSupabaseConfigured) {
    return <p className="muted">Saved templates need Supabase. See the README to connect it.</p>;
  }
  if (loading) return <p className="muted">Loading…</p>;
  if (!userId) {
    return (
      <div className="empty">
        <p>Sign in to see the templates you’ve saved.</p>
        <Link to="/signin?next=%2Ftemplates%3Ftab%3Dmine" className="btn btn--outline">
          Sign in
        </Link>
      </div>
    );
  }

  const remove = async (t: UserTemplate) => {
    if (deleting) return;
    if (!window.confirm(`Delete the template “${t.name}”? Projects made from it are not affected.`)) return;
    setDeleting(t.id);
    setError(null);
    try {
      await deleteUserTemplate(userId, t.id);
      setTemplates((list) => list?.filter((x) => x.id !== t.id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? `Could not delete “${t.name}”: ${e.message}` : 'Could not delete the template.');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {templates === null && !error && <p className="muted">Loading your templates…</p>}
      {templates?.length === 0 && (
        <div className="empty">
          <p>No saved templates yet. In the editor, choose “Save as template” to keep a look you like.</p>
          <Link to="/projects" className="btn btn--outline">
            Go to my projects
          </Link>
        </div>
      )}
      {templates && templates.length > 0 && (
        <>
          <p className="muted small" aria-live="polite">
            {templates.length} {templates.length === 1 ? 'template' : 'templates'}
          </p>
          <div className="template-grid">
            {templates.map((t) => {
              const first = t.design.slides[0];
              return (
                <article key={t.id} className="template-card">
                  <div className="template-card__preview">
                    {first && <SlideView design={t.design} slide={first} index={0} size={previewSizeFor(t.design)} scale={0.36} />}
                  </div>
                  <div className="template-card__body">
                    <div>
                      <h2>{t.name}</h2>
                      <p className="muted small">
                        {t.design.store === 'ios' ? 'App Store' : 'Google Play'} · saved {new Date(t.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="row-gap">
                      <button
                        type="button"
                        className="btn btn--outline"
                        disabled={deleting !== null}
                        onClick={() => void remove(t)}
                      >
                        {deleting === t.id ? 'Deleting…' : 'Delete'}
                      </button>
                      <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() => navigate(`/editor/new?userTemplate=${encodeURIComponent(t.id)}`)}
                      >
                        Use
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
