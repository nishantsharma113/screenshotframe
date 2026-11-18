import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createDefaultDesign, defaultDeviceForStore } from '@/lib/constants';
import { supabase } from '@/lib/supabase';
import type { Design, SaveStatus, Template } from '@/lib/types';
import {
  ProjectGoneError,
  createProject,
  getProject,
  loadLocalProject,
  saveLocalProject,
  updateProject,
} from '@/services/projects';
import { deleteScreenshots, screenshotPathsIn } from '@/services/storage';
import { getTemplate } from '@/services/templates';
import { adoptTemplateFiles, designFromUserTemplate, getUserTemplate } from '@/services/userTemplates';
import { editorReducer, initEditor } from '@/store/editorReducer';
import { useAuth } from './useAuth';

const AUTOSAVE_MS = 800;
const RETRY_MS = 5000;
const UNTITLED = 'Untitled project';

export function designFromTemplate(t: Template): Design {
  const store = t.store === 'play' ? 'play' : 'ios';
  return createDefaultDesign({ ...t.design, store, device: defaultDeviceForStore(store) });
}

interface Meta {
  id: string; // uuid, or 'local' for the signed-out project
  /** Raw text from the name field; may be empty while the user is typing. */
  name: string;
}

/** What one save writes. `snapshot` is compared with the last saved one to skip no-op saves. */
interface PendingSave {
  id: string;
  name: string;
  design: Design;
  snapshot: string;
}

const savedName = (name: string) => name.trim() || UNTITLED;
const snapshotOf = (name: string, design: Design) => JSON.stringify({ name: savedName(name), design });

class StorageFullError extends Error {}

/** Writes one save. Local saves are synchronous under the hood, so they finish even during page unload. */
async function persist(p: PendingSave): Promise<void> {
  if (p.id === 'local') {
    const ok = saveLocalProject({ id: 'local', name: savedName(p.name), design: p.design, updatedAt: '' });
    if (!ok) throw new StorageFullError('Browser storage is full. Sign in to keep large screenshots in the cloud.');
    return;
  }
  await updateProject(p.id, { name: savedName(p.name), design: p.design });
}

/**
 * Deletes the files in `seen` that none of `keep` references, and forgets them.
 * On failure they go back into `seen`, so a later save retries.
 */
function deleteUnreferenced(seen: Set<string>, keep: Design[]) {
  const used = new Set(keep.flatMap(screenshotPathsIn));
  const doomed = [...seen].filter((path) => !used.has(path));
  if (doomed.length === 0) return;
  doomed.forEach((path) => seen.delete(path));
  deleteScreenshots(doomed).catch(() => doomed.forEach((path) => seen.add(path)));
}

/** Shared across StrictMode's double effect so one visit to /editor/new creates one project, not two. */
let creating: { key: string; promise: Promise<string> } | null = null;

/**
 * Loads the project for /editor/:id and autosaves changes.
 *  - 'new'   → creates a project (Supabase when signed in, else local) and redirects
 *  - 'local' → the browser-only project
 *  - uuid    → a project row in Supabase
 */
/**
 * `templateId`: a built-in template for a new project.
 * `userTemplateId`: one of the signed-in user's saved templates for a new project.
 */
export function useProject(routeId: string | undefined, templateId: string | null, userTemplateId: string | null = null) {
  const { user, plan, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(editorReducer, undefined, () => initEditor(createDefaultDesign()));
  const [meta, setMeta] = useState<Meta | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const lastSaved = useRef<string | null>(null);
  /** The latest unsaved change, so it can be flushed on unload / leaving the editor. */
  const pending = useRef<PendingSave | null>(null);
  /** Only the newest save may update the status (an older, slower request must not say "Saved"). */
  const saveSeq = useRef(0);
  const retryTimer = useRef<number | undefined>(undefined);

  // ── Storage cleanup ──
  // Every Storage path this project's slides have pointed at during the session. A path is
  // deleted only after an autosave, and only once neither the saved design, the current
  // design nor any undo/redo step references it — so undo can always bring a screenshot back.
  const seenPaths = useRef(new Set<string>());
  /** Only files in screenshots/<user>/<project>/ are ever deleted (null for local projects). */
  const pathPrefix = useRef<string | null>(null);
  /** The design the database last confirmed (cloud projects only). */
  const lastSavedDesign = useRef<Design | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  /**
   * Saves the pending change right away, without waiting for the debounce. Fire-and-forget.
   * `leaving`: the editor is closing this project, so undo history is gone and any file the
   * saved design doesn't use can be deleted. (Not on beforeunload: the user may click "Stay".)
   */
  const flushPending = useCallback((leaving: boolean) => {
    const p = pending.current;
    pending.current = null;
    // Capture now: by the time the save finishes, a newly opened project may own these refs.
    const seen = seenPaths.current;
    let saved: Promise<Design | null> = Promise.resolve(lastSavedDesign.current);
    if (p && p.snapshot !== lastSaved.current) {
      lastSaved.current = p.snapshot;
      saved = persist(p).then(() => (p.id === 'local' ? null : p.design));
    }
    saved
      .then((design) => {
        if (leaving && design) deleteUnreferenced(seen, [design]);
      })
      .catch(() => undefined); // save failed: keep every file
  }, []);

  // ── Load ──────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    flushPending(true); // switching projects: save the previous one's last edit, then tidy its files
    seenPaths.current = new Set();
    pathPrefix.current = null;
    lastSavedDesign.current = null;
    setMeta(null);
    setError(null);

    (async () => {
      try {
        if (!routeId || routeId === 'new') {
          const signedIn = Boolean(supabase && user);
          // Signed out with no template: reuse the browser project instead of silently replacing it.
          // (Picking a template asks for confirmation on the Templates page first.)
          if (userTemplateId && !signedIn) {
            setError('Sign in to use your saved templates.');
            return;
          }
          if (!signedIn && !templateId && loadLocalProject()) {
            navigate('/editor/local', { replace: true });
            return;
          }
          const key = `${user?.id ?? 'local'}|${templateId ?? ''}|${userTemplateId ?? ''}`;
          if (creating?.key !== key) {
            const promise = (async () => {
              let design = createDefaultDesign();
              if (userTemplateId) {
                const t = await getUserTemplate(userTemplateId);
                if (!t) throw new Error('That saved template no longer exists.');
                design = designFromUserTemplate(t);
              } else if (templateId) {
                const t = await getTemplate(templateId);
                if (t) design = designFromTemplate(t);
              }
              if (signedIn) {
                const p = await createProject(UNTITLED, design);
                if (userTemplateId && user) {
                  const own = await adoptTemplateFiles(user.id, p.id, design);
                  if (own) await updateProject(p.id, { design: own });
                }
                return p.id;
              }
              if (!saveLocalProject({ id: 'local', name: UNTITLED, design, updatedAt: '' })) {
                throw new Error('This browser blocked local storage. Sign in to save projects in the cloud.');
              }
              return 'local';
            })();
            creating = { key, promise };
          }
          const mine = creating;
          try {
            const id = await mine.promise;
            if (!cancelled) navigate(`/editor/${id}`, { replace: true });
          } finally {
            // Done (or failed): let the next visit create a fresh project / retry.
            if (!cancelled && creating === mine) creating = null;
          }
          return;
        }

        if (routeId === 'local') {
          const p = loadLocalProject() ?? { id: 'local', name: UNTITLED, design: createDefaultDesign(), updatedAt: '' };
          if (cancelled) return;
          lastSaved.current = snapshotOf(p.name, p.design);
          dispatch({ type: 'load', design: p.design });
          setMeta({ id: 'local', name: p.name });
          setStatus('local');
          return;
        }

        if (!supabase || !user) {
          setError('Sign in to open this project.');
          return;
        }
        const p = await getProject(routeId);
        if (cancelled) return;
        if (!p) {
          setError('Project not found, or you don’t have access to it.');
          return;
        }
        lastSaved.current = snapshotOf(p.name, p.design);
        lastSavedDesign.current = p.design;
        pathPrefix.current = `${user.id}/${p.id}/`;
        dispatch({ type: 'load', design: p.design });
        setMeta({ id: p.id, name: p.name });
        setStatus('saved');
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the project.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [routeId, templateId, userTemplateId, user?.id, authLoading, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Remember every screenshot path the design passes through (uploads, undo, redo…).
  useEffect(() => {
    const prefix = pathPrefix.current;
    if (!prefix) return;
    for (const path of screenshotPathsIn(state.design)) {
      if (path.startsWith(prefix)) seenPaths.current.add(path);
    }
  }, [state.design]);

  // ── Autosave ──────────────────────────────────────────────
  useEffect(() => {
    if (!meta) return;
    const snapshot = snapshotOf(meta.name, state.design);
    if (snapshot === lastSaved.current) {
      pending.current = null;
      return;
    }
    const save: PendingSave = { id: meta.id, name: meta.name, design: state.design, snapshot };
    pending.current = save;
    window.clearTimeout(retryTimer.current);

    setStatus('saving');
    const timer = window.setTimeout(async () => {
      const seq = ++saveSeq.current;
      // The load effect replaces this Set when another project opens; use it to tell if we're still on this one.
      const seenAtStart = seenPaths.current;
      try {
        await persist(save);
        if (seenPaths.current !== seenAtStart) return; // project switched mid-save: its refs belong to the new one
        if (pending.current === save) pending.current = null;
        lastSaved.current = snapshot;
        if (save.id !== 'local') {
          // The removal is now in the database, so files nothing points at any more can go.
          lastSavedDesign.current = save.design;
          const now = stateRef.current;
          deleteUnreferenced(seenPaths.current, [save.design, now.design, ...now.past, ...now.future]);
        }
        if (seq !== saveSeq.current) return;
        setStatus(save.id === 'local' ? 'local' : 'saved');
        setError(null); // clears an earlier "storage full" / "not saved" toast
      } catch (e) {
        if (seq !== saveSeq.current) return;
        setStatus('error');
        if (e instanceof StorageFullError || e instanceof ProjectGoneError) {
          setError(e.message);
          return; // retrying won't help
        }
        // Slow / offline network: try again shortly instead of waiting for the next edit.
        setError('Couldn’t save — check your connection. Retrying…');
        retryTimer.current = window.setTimeout(() => setRetryTick((t) => t + 1), RETRY_MS);
      }
    }, AUTOSAVE_MS);

    return () => window.clearTimeout(timer);
  }, [state.design, meta, retryTick]);

  // ── Don't lose the last edit on refresh / tab close / leaving the editor ──
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const p = pending.current;
      if (!p || p.snapshot === lastSaved.current) return;
      flushPending(false);
      if (p.id !== 'local') {
        // A network save may not finish before the page goes away, so ask the browser to confirm.
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.clearTimeout(retryTimer.current);
      flushPending(true); // in-app navigation (logo, back button) unmounts the editor
    };
  }, [flushPending]);

  /** Saves any pending change now and waits for it — e.g. before a server function reads the project. */
  const saveNow = useCallback(async () => {
    const p = pending.current;
    if (!p || p.snapshot === lastSaved.current) return;
    await persist(p);
    if (pending.current === p) pending.current = null;
    lastSaved.current = p.snapshot;
    if (p.id !== 'local') lastSavedDesign.current = p.design;
    setStatus(p.id === 'local' ? 'local' : 'saved');
  }, []);

  const rename = useCallback((name: string) => {
    // Keep the raw text so the field can be cleared and retyped; the fallback name is applied on save.
    setMeta((m) => (m ? { ...m, name: name.slice(0, 120) } : m));
  }, []);

  return {
    state,
    dispatch,
    meta,
    rename,
    saveNow,
    status,
    error,
    userId: user?.id ?? null,
    plan,
    loading: !meta && !error,
  };
}
