import { uid } from '@/lib/constants';
import { SCREENSHOT_BUCKET, supabase } from '@/lib/supabase';
import type { Design } from '@/lib/types';
import { normalizeDesign } from './projects';
import { deleteProjectFolder } from './storage';

export interface UserTemplate {
  id: string;
  name: string;
  design: Design;
  createdAt: string;
}

interface Row {
  id: string;
  name: string;
  design: Design;
  created_at: string;
}

const toTemplate = (r: Row): UserTemplate => ({ id: r.id, name: r.name, design: normalizeDesign(r.design), createdAt: r.created_at });

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

/** Folder for a template's own files (inside the user's screenshots folder, so existing RLS covers it). */
const templateFolder = (userId: string, templateId: string) => `${userId}/templates/${templateId}`;

/**
 * The parts of a design worth reusing: everything except content tied to one project.
 * Screenshots, the feature-graphic icon and per-slide background images are project files
 * and would break when that project is deleted, so they are left out.
 */
function stripProjectFiles(design: Design): Design {
  return {
    ...design,
    slides: design.slides.map((s) => ({
      ...s,
      imageUrl: null,
      imagePath: null,
      ...(s.backdrop ? { backdrop: { ...s.backdrop, image: s.backdrop.image && !s.backdrop.image.path ? s.backdrop.image : null } } : {}),
    })),
    ...(design.featureGraphic ? { featureGraphic: { ...design.featureGraphic, iconUrl: null, iconPath: null } } : {}),
  };
}

export async function listUserTemplates(): Promise<UserTemplate[]> {
  const { data, error } = await requireClient()
    .from('user_templates')
    .select('id, name, design, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as Row[]).map(toTemplate);
}

export async function getUserTemplate(id: string): Promise<UserTemplate | null> {
  const { data, error } = await requireClient().from('user_templates').select('id, name, design, created_at').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? toTemplate(data as Row) : null;
}

/**
 * Saves the design as a template. A project background image stored in Supabase is copied
 * into the template's own folder first, so the template keeps working after the project is gone.
 */
export async function saveUserTemplate(userId: string, name: string, design: Design): Promise<UserTemplate> {
  const client = requireClient();
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new Error('Give the template a name.');
  const id = uid();
  const stored = stripProjectFiles(design);

  const bgPath = design.backgroundImage?.path;
  if (bgPath) {
    const ext = bgPath.split('.').pop() || 'png';
    const copyPath = `${templateFolder(userId, id)}/background.${ext}`;
    const { error: copyErr } = await client.storage.from(SCREENSHOT_BUCKET).copy(bgPath, copyPath);
    if (copyErr) throw new Error(`Could not copy the background image: ${copyErr.message}`);
    const { data } = client.storage.from(SCREENSHOT_BUCKET).getPublicUrl(copyPath);
    stored.backgroundImage = { url: data.publicUrl, path: copyPath };
  }

  const { data, error } = await client
    .from('user_templates')
    .insert({ id, name: clean, design: stored })
    .select('id, name, design, created_at')
    .single();
  if (error) {
    if (bgPath) await deleteProjectFolder(userId, `templates/${id}`).catch(() => undefined);
    throw error;
  }
  return toTemplate(data as Row);
}

/** Deletes the template row, then its files. */
export async function deleteUserTemplate(userId: string, id: string): Promise<void> {
  const { error } = await requireClient().from('user_templates').delete().eq('id', id);
  if (error) throw error;
  await deleteProjectFolder(userId, `templates/${id}`).catch(() => undefined); // orphans are harmless
}

/**
 * After a project is created from a template: copy the template's background image into the
 * project's own folder, so deleting the template later can't break the project.
 * Returns the design to save, or null when nothing needed copying (or the copy failed —
 * the project then keeps pointing at the template's file).
 */
export async function adoptTemplateFiles(userId: string, projectId: string, design: Design): Promise<Design | null> {
  const from = design.backgroundImage?.path;
  if (!supabase || !from || !from.startsWith(`${userId}/templates/`)) return null;
  const ext = from.split('.').pop() || 'png';
  const to = `${userId}/${projectId}/${uid()}.${ext}`;
  const { error } = await supabase.storage.from(SCREENSHOT_BUCKET).copy(from, to);
  if (error) return null;
  const { data } = supabase.storage.from(SCREENSHOT_BUCKET).getPublicUrl(to);
  return { ...design, backgroundImage: { url: data.publicUrl, path: to } };
}

/** A fresh design for a new project: same look, new slide ids so nothing is shared. */
export function designFromUserTemplate(t: UserTemplate): Design {
  return { ...t.design, slides: t.design.slides.map((s) => ({ ...s, id: uid() })) };
}
