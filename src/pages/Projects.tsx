import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { PLANS } from '@shared/plans';
import { BILLING_ENABLED } from '@/config/features';
import { useConfirm } from '@/components/ConfirmDialog';
import { Icon } from '@/components/Icon';
import { SiteHeader } from '@/components/SiteHeader';
import { SlideView } from '@/components/SlideView';
import { useAuth } from '@/hooks/useAuth';
import { previewSizeFor } from '@/lib/constants';
import type { Project } from '@/lib/types';
import { deleteProject, listProjects, loadLocalProject } from '@/services/projects';
import { ensureDesignFonts } from '@/services/fonts';
import { deleteProjectFolder } from '@/services/storage';

type Sort = 'edited' | 'name';
type View = 'grid' | 'list';

const storeName = (p: Project) => (p.design.store === 'ios' ? 'App Store' : 'Google Play');
const edited = (p: Project) => new Date(p.updatedAt).toLocaleDateString();

export function Projects() {
  const { user, loading, plan } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [hasLocal] = useState(() => loadLocalProject() !== null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('edited');
  const [view, setView] = useState<View>('grid');
  const [menuFor, setMenuFor] = useState<string | null>(null);
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

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (projects ?? []).filter((p) => !q || p.name.toLowerCase().includes(q));
    return sort === 'name'
      ? [...list].sort((a, b) => a.name.localeCompare(b.name))
      : [...list].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [projects, query, sort]);

  if (!loading && !user) return <Navigate to="/signin" replace />;

  // The server enforces this too (0007_billing.sql); checking here just avoids a dead end.
  const limit = PLANS[plan].limits.projects;
  const atLimit = limit !== null && (projects?.length ?? 0) >= limit;
  const hasProjects = projects !== null && projects.length > 0;

  const remove = async (p: Project) => {
    if (deleting) return;
    const ok = await confirm({
      title: `Delete “${p.name}”?`,
      message: 'The project and its uploaded screenshots are deleted for good. This can’t be undone.',
      confirmLabel: 'Delete project',
      tone: 'danger',
    });
    if (!ok) return;
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

  const menu = (p: Project) => (
    <ProjectMenu
      name={p.name}
      open={menuFor === p.id}
      busy={deleting === p.id}
      disabled={deleting !== null}
      onToggle={(o) => setMenuFor(o ? p.id : null)}
      onOpen={() => navigate(`/editor/${p.id}`)}
      onDelete={() => void remove(p)}
    />
  );

  return (
    <div className="light-page">
      <SiteHeader />
      <main className="container section">
        <div className="projects__head">
          <div>
            <h1 className="page-title">My projects</h1>
            {limit !== null && projects && (
              <div className="usage">
                <div
                  className="usage__meter"
                  role="meter"
                  aria-label="Projects used"
                  aria-valuemin={0}
                  aria-valuemax={limit}
                  aria-valuenow={projects.length}
                >
                  <span style={{ width: `${Math.min(100, (projects.length / limit) * 100)}%` }} />
                </div>
                <span>
                  {projects.length} of {limit} projects on {PLANS[plan].name}
                  {BILLING_ENABLED && (
                    <>
                      {' · '}
                      <Link to="/account/billing">Upgrade for unlimited</Link>
                    </>
                  )}
                </span>
              </div>
            )}
          </div>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => (atLimit ? setShowUpgrade(true) : navigate('/editor/new'))}
          >
            <Icon name="plus" size={16} />
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

        {hasProjects && (
          <div className="toolbar">
            <label className="search">
              <span className="sr-only">Search projects</span>
              <Icon name="search" size={16} />
              <input type="search" placeholder="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <label className="toolbar__sort">
              Sort
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="edited">Last edited</option>
                <option value="name">Name</option>
              </select>
            </label>
            <div className="segmented segmented--icons" role="group" aria-label="View">
              <button type="button" aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>
                <Icon name="grid" size={16} />
              </button>
              <button type="button" aria-label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')}>
                <Icon name="list" size={16} />
              </button>
            </div>
          </div>
        )}

        {projects === null && !error && (
          <div className="template-grid" aria-busy="true" aria-label="Loading projects">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="skeleton-card" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            ))}
          </div>
        )}

        {projects?.length === 0 && (
          <div className="empty">
            <span className="empty__icon" aria-hidden="true">
              <Icon name="phone" size={28} />
            </span>
            <h2>No projects yet</h2>
            <p>Start with a blank set of slides, or pick a template and drop in your screenshots.</p>
            <div className="row-gap">
              <button type="button" className="btn btn--primary" onClick={() => navigate('/editor/new')}>
                New project
              </button>
              <Link to="/templates" className="btn btn--outline">
                Browse templates
              </Link>
            </div>
          </div>
        )}

        {hasProjects && shown.length === 0 && <p className="muted">No projects match “{query}”.</p>}

        {view === 'grid' && shown.length > 0 && (
          <div className="template-grid">
            {shown.map((p) => {
              const first = p.design.slides[0];
              return (
                <article key={p.id} className="template-card">
                  <Link to={`/editor/${p.id}`} className="template-card__preview" aria-label={`Open ${p.name}`}>
                    {first && (
                      <SlideView design={p.design} slide={first} index={0} size={previewSizeFor(p.design)} scale={0.36} />
                    )}
                  </Link>
                  <div className="template-card__body">
                    <div className="template-card__text">
                      <h2>{p.name}</h2>
                      <p className="muted small">
                        {p.design.slides.length} slides · {storeName(p)} · edited {edited(p)}
                      </p>
                    </div>
                    {menu(p)}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {view === 'list' && shown.length > 0 && (
          <div className="list-table" role="table" aria-label="Projects">
            <div className="list-table__row list-table__head" role="row">
              <span role="columnheader">Name</span>
              <span role="columnheader">Store</span>
              <span role="columnheader">Edited</span>
              <span role="columnheader">
                <span className="sr-only">Actions</span>
              </span>
            </div>
            {shown.map((p) => (
              <div key={p.id} className="list-table__row" role="row">
                <span role="cell">
                  <Link to={`/editor/${p.id}`} className="list-table__name">
                    <span className="list-table__swatch" style={{ background: p.design.background }} aria-hidden="true" />
                    {p.name}
                  </Link>
                </span>
                <span role="cell" className="muted">
                  {storeName(p)}
                </span>
                <span role="cell" className="muted">
                  {edited(p)}
                </span>
                <span role="cell">{menu(p)}</span>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

interface ProjectMenuProps {
  name: string;
  open: boolean;
  busy: boolean;
  disabled: boolean;
  onToggle: (open: boolean) => void;
  onOpen: () => void;
  onDelete: () => void;
}

/** "⋯" button with Open / Delete for one project. */
function ProjectMenu({ name, open, busy, disabled, onToggle, onOpen, onDelete }: ProjectMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const toggleRef = useRef(onToggle);
  toggleRef.current = onToggle;

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) toggleRef.current(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && toggleRef.current(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="menu-anchor" ref={ref}>
      <button
        type="button"
        className="icon-btn icon-btn--ghost"
        aria-label={busy ? `Deleting ${name}` : `More actions for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => onToggle(!open)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div className="menu" role="menu">
          <button type="button" role="menuitem" onClick={onOpen}>
            Open
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu__danger"
            onClick={() => {
              onToggle(false);
              onDelete();
            }}
          >
            Delete…
          </button>
        </div>
      )}
    </div>
  );
}
