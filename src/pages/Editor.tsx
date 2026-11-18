import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Canvas } from '@/components/editor/Canvas';
import { ExportDialog } from '@/components/editor/ExportDialog';
import { FeaturePanel } from '@/components/editor/FeaturePanel';
import { SaveTemplateDialog } from '@/components/editor/SaveTemplateDialog';
import { LeftPanel } from '@/components/editor/LeftPanel';
import { RightPanel, type FontUploadAccess } from '@/components/editor/RightPanel';
import { TopBar } from '@/components/editor/TopBar';
import { useProject } from '@/hooks/useProject';
import { useUserFonts } from '@/hooks/useUserFonts';
import { MAX_SLIDES, PLAN_FEATURES, customFontRef, languageLabel } from '@/lib/constants';
import { isSupabaseConfigured } from '@/lib/supabase';
import { uploadScreenshot, validateImage } from '@/services/storage';
import { autoTranslate } from '@/services/translate';
import { saveUserTemplate } from '@/services/userTemplates';

export function Editor() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const { state, dispatch, meta, rename, saveNow, status, error, userId, plan, loading } = useProject(
    id,
    search.get('template'),
    search.get('userTemplate'),
  );
  const [showExport, setShowExport] = useState(false);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** A long-running action's status; shown in the toast until it finishes (notices auto-hide). */
  const [progress, setProgress] = useState<string | null>(null);

  // Without a backend there is no plan to check, so everything is unlocked for local development.
  const can3d = !isSupabaseConfigured || PLAN_FEATURES.angle3d.includes(plan);
  const canLocalize = !isSupabaseConfigured || PLAN_FEATURES.localization.includes(plan);
  // Uploading needs Storage, so unlike the features above it can't be unlocked without Supabase.
  const fontUploadAccess: FontUploadAccess = !isSupabaseConfigured
    ? 'unavailable'
    : !userId
      ? 'signin'
      : PLAN_FEATURES.customFonts.includes(plan)
        ? 'ok'
        : 'plan';
  const userFonts = useUserFonts(userId, state.design.font);

  const handleFontFile = useCallback(
    async (file: File) => {
      try {
        const font = await userFonts.upload(file);
        dispatch({ type: 'set', patch: { font: customFontRef(font.id) } });
        setNotice(`Added “${font.family}”.`);
      } catch (e) {
        setNotice(e instanceof Error ? `Font upload failed: ${e.message}` : 'Font upload failed.');
      }
    },
    [userFonts, dispatch],
  );

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  // Undo / redo shortcuts (not while typing in a field, and not behind the export dialog)
  useEffect(() => {
    if (showExport || showSaveTemplate) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select')) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' || key === 'y') {
        e.preventDefault();
        dispatch({ type: key === 'y' || e.shiftKey ? 'redo' : 'undo' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, showExport, showSaveTemplate]);

  // A file dropped outside a drop zone would make the browser open it and leave the editor.
  useEffect(() => {
    const block = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    return () => {
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', block);
    };
  }, []);

  /**
   * Auto-translate: save first (the function reads the saved project), call the Edge Function,
   * then fill the locale with one reducer action, so a single Undo reverts the whole translation.
   */
  const handleAutoTranslate = useCallback(
    async (locale: string) => {
      if (!meta || progress) return;
      if (!isSupabaseConfigured) return setNotice('Auto-translate needs Supabase (see README).');
      if (!userId) return setNotice('Sign in to use auto-translate.');
      if (meta.id === 'local') return setNotice('Auto-translate works on cloud projects. Start a new project while signed in.');
      if (!PLAN_FEATURES.autoTranslate.includes(plan)) return setNotice('Auto-translate is on the Standard plan.');
      const label = languageLabel(locale);
      setProgress(`Translating to ${label}…`);
      try {
        await saveNow();
        const result = await autoTranslate(meta.id, locale);
        dispatch({ type: 'applyTranslation', locale, slides: result.slides });
        const n = result.slides.length;
        const left = result.remaining === null ? '' : ` ${result.remaining} auto-translation${result.remaining === 1 ? '' : 's'} left today.`;
        setNotice(`Translated ${n} slide${n === 1 ? '' : 's'} to ${label}. Undo restores the previous text.${left}`);
      } catch (e) {
        setNotice(`Auto-translate failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      } finally {
        setProgress(null);
      }
    },
    [meta, progress, userId, plan, saveNow, dispatch],
  );

  /** Background image for the project or one slide: same checks and storage as screenshots. */
  const handleBackgroundImage = useCallback(
    async (files: File[], target: 'project' | number) => {
      const file = files[0];
      if (!meta || !file || uploading) return;
      const problem = validateImage(file);
      if (problem) return setNotice(problem);
      setUploading(true);
      try {
        const cloudUser = meta.id === 'local' ? null : userId;
        const img = await uploadScreenshot(file, { userId: cloudUser, projectId: meta.id });
        dispatch({ type: 'setBackdrop', target, patch: { image: { url: img.url, path: img.path } } });
      } catch (e) {
        setNotice(e instanceof Error ? `Background upload failed: ${e.message}` : 'Background upload failed.');
      } finally {
        setUploading(false);
      }
    },
    [meta, userId, dispatch, uploading],
  );

  /** App icon for the feature graphic: same checks and storage as screenshots. */
  const handleIconFiles = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!meta || !file || uploading) return;
      const problem = validateImage(file);
      if (problem) return setNotice(problem);
      if (files.length > 1) setNotice('Only the first image is used as the icon.');
      setUploading(true);
      try {
        const cloudUser = meta.id === 'local' ? null : userId;
        const img = await uploadScreenshot(file, { userId: cloudUser, projectId: meta.id });
        dispatch({ type: 'setFeatureIcon', url: img.url, path: img.path });
      } catch (e) {
        setNotice(e instanceof Error ? `Icon upload failed: ${e.message}` : 'Icon upload failed.');
      } finally {
        setUploading(false);
      }
    },
    [meta, userId, dispatch, uploading],
  );

  const handleFiles = useCallback(
    async (files: File[], startIndex: number) => {
      if (!meta || files.length === 0) return;
      if (uploading) return; // a second drop while the first is still uploading
      const problems = files.map(validateImage).filter((p): p is string => p !== null);
      let valid = files.filter((f) => validateImage(f) === null);
      // Slides beyond MAX_SLIDES are never created, so don't upload files that would be dropped.
      const room = MAX_SLIDES - startIndex;
      if (valid.length > room) {
        problems.push(`Only ${room} more ${room === 1 ? 'slide fits' : 'slides fit'} (max ${MAX_SLIDES}); skipped ${valid.length - room}`);
        valid = valid.slice(0, room);
      }
      if (problems.length) setNotice(problems.join(' · '));
      if (!valid.length) return;

      setUploading(true);
      try {
        const cloudUser = meta.id === 'local' ? null : userId;
        // allSettled: one failed file shouldn't throw away the ones that uploaded.
        const results = await Promise.allSettled(
          valid.map((f) => uploadScreenshot(f, { userId: cloudUser, projectId: meta.id })),
        );
        const images = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
        if (images.length) dispatch({ type: 'setImages', images, startIndex });
        const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        if (failed.length) {
          const reason = failed[0].reason instanceof Error ? failed[0].reason.message : 'network error';
          setNotice(`${failed.length} of ${valid.length} uploads failed: ${reason}`);
        }
      } finally {
        setUploading(false);
      }
    },
    [meta, userId, dispatch, uploading],
  );

  if (error && !meta) {
    return (
      <div className="editor editor--message">
        <p>{error}</p>
        <div className="row-gap">
          {userId ? (
            <Link to="/projects" className="btn btn--primary">
              My projects
            </Link>
          ) : (
            isSupabaseConfigured && (
              <Link to={`/signin?next=${encodeURIComponent(`/editor/${id ?? ''}`)}`} className="btn btn--primary">
                Sign in
              </Link>
            )
          )}
          <Link to="/" className="btn btn--ghost-dark">
            Home
          </Link>
        </div>
      </div>
    );
  }

  if (loading || !meta) {
    return (
      <div className="editor editor--message">
        <p>Opening your project…</p>
      </div>
    );
  }

  const { design, selected } = state;
  const projectName = meta.name.trim() || 'Untitled project';

  return (
    <div className="editor">
      <TopBar
        name={meta.name}
        onRename={rename}
        status={status}
        store={design.store}
        onStore={(store) => dispatch({ type: 'setStore', store })}
        canUndo={state.past.length > 0}
        canRedo={state.future.length > 0}
        onUndo={() => dispatch({ type: 'undo' })}
        onRedo={() => dispatch({ type: 'redo' })}
        onExport={() => setShowExport(true)}
        onSaveTemplate={() => {
          // Saved templates live in Supabase and are a Standard-plan feature.
          if (!isSupabaseConfigured) return setNotice('Saved templates need Supabase (see README).');
          if (!userId) return setNotice('Sign in to save your own templates.');
          if (!PLAN_FEATURES.userTemplates.includes(plan)) return setNotice('Saved templates are on the Standard plan.');
          setShowSaveTemplate(true);
        }}
      />

      {meta.id === 'local' && isSupabaseConfigured && (
        <div className="banner">
          This project is saved only in this browser.{' '}
          {userId ? (
            <>
              Start a <Link to="/editor/new">new cloud project</Link> to keep work in your account.
            </>
          ) : (
            <>
              <Link to="/signin">Sign in or create an account</Link> to keep projects in the cloud.
            </>
          )}
        </div>
      )}

      <div className="editor__body">
        <LeftPanel
          design={design}
          selected={selected}
          dispatch={dispatch}
          uploading={uploading}
          onFiles={(files) => handleFiles(files, selected)}
          onBackgroundImage={(files, target) => void handleBackgroundImage(files, target)}
        />
        <Canvas
          design={design}
          selected={selected}
          dispatch={dispatch}
          onDropOnSlide={(files, i) => handleFiles(files, i)}
          featureSelected={state.featureSelected}
          onDropIcon={(files) => void handleIconFiles(files)}
        />
        {state.featureSelected ? (
          <FeaturePanel design={design} dispatch={dispatch} uploading={uploading} onIconFiles={(files) => void handleIconFiles(files)} />
        ) : (
          <RightPanel
            design={design}
            selected={selected}
            dispatch={dispatch}
            can3d={can3d}
            canLocalize={canLocalize}
            onLocked={(feature) => setNotice(`${feature} ${feature.endsWith('s') ? 'are' : 'is'} on the Standard plan.`)}
            userFonts={userFonts.fonts}
            fontUploadAccess={fontUploadAccess}
            fontUploading={userFonts.uploading}
            onUploadFont={(file) => void handleFontFile(file)}
            onNotice={setNotice}
            onAutoTranslate={(locale) => void handleAutoTranslate(locale)}
            translating={progress !== null}
          />
        )}
      </div>

      {showExport && <ExportDialog design={design} projectName={projectName} onClose={() => setShowExport(false)} />}
      {showSaveTemplate && userId && (
        <SaveTemplateDialog
          defaultName={projectName}
          onClose={() => setShowSaveTemplate(false)}
          onSave={async (name) => {
            const t = await saveUserTemplate(userId, name, design);
            setNotice(`Saved “${t.name}” to My templates.`);
          }}
        />
      )}

      {(progress || notice || (error && meta)) && (
        <div className="toast" role="status" aria-busy={progress !== null}>
          {progress ?? notice ?? error}
        </div>
      )}
    </div>
  );
}
