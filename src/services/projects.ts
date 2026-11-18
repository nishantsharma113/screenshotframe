import { createDefaultDesign, legacySizeId } from '@/lib/constants';
import { getPreset } from '@/config/storeSizes';
import { supabase } from '@/lib/supabase';
import type { Design, Project } from '@/lib/types';

const LOCAL_KEY = 'shotframe:local-project';

/** The server refused a new project because the plan's project limit is reached (0007_billing.sql). */
export class PlanLimitError extends Error {}

/** The row is gone (deleted elsewhere) or no longer visible to this user — retrying won't help. */
export class ProjectGoneError extends Error {}

interface ProjectRow {
  id: string;
  name: string;
  design: Design;
  updated_at: string;
}

/**
 * Fills in missing fields so an old or hand-edited row can't crash the editor
 * (e.g. a design saved before a field existed, or `slides` missing / empty).
 */
export function normalizeDesign(raw: Partial<Design> | null | undefined): Design {
  const base = createDefaultDesign();
  const d = { ...base, ...(raw ?? {}) };
  const slides = Array.isArray(d.slides) && d.slides.length ? d.slides : base.slides;
  const locales = Array.isArray(d.locales) && d.locales.length ? d.locales : base.locales;
  const activeLocale = locales.includes(d.activeLocale) ? d.activeLocale : locales[0];
  // Projects from before size presets: keep the size they were made at (closest preset).
  const sizeId = getPreset(raw?.sizeId) ? raw!.sizeId : legacySizeId(d.store, d.device);
  return { ...d, slides, locales, activeLocale, sizeId };
}

const toProject = (row: ProjectRow): Project => ({
  id: row.id,
  name: row.name || 'Untitled project',
  design: normalizeDesign(row.design),
  updatedAt: row.updated_at,
});

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

export async function listProjects(): Promise<Project[]> {
  const { data, error } = await requireClient()
    .from('projects')
    .select('id, name, design, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data as ProjectRow[]).map(toProject);
}

export async function getProject(id: string): Promise<Project | null> {
  const { data, error } = await requireClient()
    .from('projects')
    .select('id, name, design, updated_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? toProject(data as ProjectRow) : null;
}

export async function createProject(name: string, design: Design): Promise<Project> {
  const { data, error } = await requireClient()
    .from('projects')
    .insert({ name, design })
    .select('id, name, design, updated_at')
    .single();
  if (error) {
    if (error.message.includes('PLAN_LIMIT_PROJECTS')) {
      const limit = error.message.match(/allows (\d+)/)?.[1] ?? '';
      throw new PlanLimitError(`Your plan includes ${limit || 'a limited number of'} projects. Upgrade to create more, or delete one you no longer need.`);
    }
    throw error;
  }
  return toProject(data as ProjectRow);
}

export async function updateProject(id: string, patch: { name?: string; design?: Design }): Promise<void> {
  const { data, error } = await requireClient().from('projects').update(patch).eq('id', id).select('id');
  if (error) throw error;
  // RLS turns "deleted in another tab" into a silent no-op; report it instead of showing "Saved".
  if (!data?.length) throw new ProjectGoneError('This project was deleted or you no longer have access to it.');
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await requireClient().from('projects').delete().eq('id', id);
  if (error) throw error;
}

/* ── Local (signed-out) project ─────────────────────────────── */

export function loadLocalProject(): Project | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Project;
    return { ...p, id: 'local', name: p.name || 'Untitled project', design: normalizeDesign(p.design) };
  } catch {
    return null;
  }
}

/** Returns false when the browser storage is full (large images). */
export function saveLocalProject(project: Project): boolean {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...project, updatedAt: new Date().toISOString() }));
    return true;
  } catch {
    return false;
  }
}

export function clearLocalProject() {
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch {
    // storage blocked (private mode): nothing to clear
  }
}
