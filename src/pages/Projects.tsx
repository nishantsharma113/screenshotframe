import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { PLANS } from '@shared/plans';
import { BILLING_ENABLED } from '@/config/features';
import { SiteHeader } from '@/components/SiteHeader';
import { SlideView } from '@/components/SlideView';
import { useAuth } from '@/hooks/useAuth';
import { previewSizeFor } from '@/lib/constants';
import type { Project } from '@/lib/types';
import { deleteProject, listProjects, loadLocalProject } from '@/services/projects';
import { ensureDesignFonts } from '@/services/fonts';
import { deleteProjectFolder } from '@/services/storage';

export function Projects() {
  const { user, loading, plan } = useAuth();
  const navigate = useNavigate();
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [hasLocal] = useState(() => loadLocalProject() !== null);
  const userId = user?.id;

  // Keyed on the id: the user object is replaced on every token refresh.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setError(null);
    listProjects()
      .then((list) => {
        if (cancelled) return;
        setProjects(list);
        void ensureDesignFonts(list.map((p) => p.design)); // previews use uploaded fonts too
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load projects.'));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!loading && !user) return <Navigate to="/signin" replace />;

  // The server enforces this too (0007_billing.sql); checking here just avoids a dead end.
  const limit = PLANS[plan].limits.projects;
  const atLimit = limit !== null && (projects?.length ?? 0) >= limit;

  const remove = async (p: Project) => {
    if (deleting) return;
    if (!window.confirm(`Delete “${p.name}”? This can’t be undone.`)) return;
    setDeleting(p.id);
    setError(null);
    try {
      // Row first: if this fails nothing is lost. If the files then fail to delete,
      // they are only orphans, never a project pointing at missing screenshots.
      await deleteProject(p.id);
      setProjects((list) => list?.filter((x) => x.id !== p.id) ?? null);
      if (userId) {
        try {
          await deleteProjectFolder(userId, p.id);
        } catch (e) {
          setError(
            `“${p.name}” was deleted, but its screenshots couldn’t be removed from storage` +
              (e instanceof Error ? `: ${e.message}` : '.'),
          );
        }
      }
    } catch (e) {
      setError(e instanceof Error ? `Could not delete “${p.name}”: ${e.message}` : 'Could not delete the project.');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="light-page">
      <SiteHeader />
      <main className="container section">
        <div className="projects__head">
          <div>
            <h1 className="page-title">My projects</h1>
            {limit !== null && projects && (
              <p className="muted small">
                {projects.length} of {limit} projects on {PLANS[plan].name}
              </p>
            )}
          </div>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => (atLimit ? setShowUpgrade(true) : navigate('/editor/new'))}
          >
            New project
          </button>
        </div>

        {showUpgrade && (
          <div className="banner banner--light" role="status">
            {PLANS[plan].name} includes {limit} projects.{' '}
            {BILLING_ENABLED ? (
              <>
                <Link to="/account/billing">Upgrade</Link> for unlimited projects, or delete one you no longer need.
              </>
            ) : (
              'Delete one you no longer need to create a new one.'
            )}
          </div>
        )}

        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {hasLocal && (
          <p className="muted small">
            You also have a project saved only in this browser. <Link to="/editor/local">Open it</Link>
          </p>
        )}
        {projects === null && !error && <p className="muted">Loading…</p>}
        {projects?.length === 0 && (
          <div className="empty">
            <p>No projects yet.</p>
            <Link to="/templates" className="btn btn--outline">
              Start from a template
            </Link>
          </div>
        )}

        <div className="template-grid">
          {projects?.map((p) => {
            const first = p.design.slides[0];
            return (
              <article key={p.id} className="template-card">
                <Link to={`/editor/${p.id}`} className="template-card__preview" aria-label={`Open ${p.name}`}>
                  {first && (
                    <SlideView design={p.design} slide={first} index={0} size={previewSizeFor(p.design)} scale={0.36} />
                  )}
                </Link>
                <div className="template-card__body">
                  <div>
                    <h2>{p.name}</h2>
                    <p className="muted small">
                      {p.design.slides.length} slides · edited {new Date(p.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn--outline"
                    disabled={deleting !== null}
                    onClick={() => void remove(p)}
                  >
                    {deleting === p.id ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </main>
    </div>
  );
}
