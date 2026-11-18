import { customFontFamily, customFontId, uid } from '@/lib/constants';
import { supabase } from '@/lib/supabase';
import type { Design } from '@/lib/types';

export const FONT_BUCKET = 'fonts';
export const MAX_FONT_BYTES = 2 * 1024 * 1024;

export interface UserFont {
  id: string;
  family: string;
  path: string;
}

const FORMATS = {
  ttf: { mime: 'font/ttf', css: 'truetype' },
  otf: { mime: 'font/otf', css: 'opentype' },
  woff2: { mime: 'font/woff2', css: 'woff2' },
} as const;
type FontExt = keyof typeof FORMATS;

/** A font registered with document.fonts, plus a data URL so export can embed it. */
interface LoadedFont {
  id: string;
  dataUrl: string;
  format: string;
}

/** id → load in progress / done (null = failed). Shared so each font is fetched once per page. */
const loads = new Map<string, Promise<LoadedFont | null>>();
/** id → storage path, from listUserFonts(), so loading needn't query the row again. */
const knownPaths = new Map<string, string>();

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

const extOf = (name: string): FontExt | null => {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext && ext in FORMATS ? (ext as FontExt) : null;
};

/** Checks the file's first bytes, so a renamed PNG doesn't reach Storage. */
function looksLikeFont(buffer: ArrayBuffer, ext: FontExt): boolean {
  const b = new Uint8Array(buffer.slice(0, 4));
  const tag = String.fromCharCode(...b);
  if (ext === 'woff2') return tag === 'wOF2';
  // TrueType (00 01 00 00 or 'true'), CFF OpenType ('OTTO'); either may carry .ttf or .otf.
  return tag === 'OTTO' || tag === 'true' || (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0);
}

/** Returns an error message, or null if the file may be uploaded. */
export function validateFontFile(file: File): string | null {
  if (!extOf(file.name)) return `${file.name}: use a .ttf, .otf or .woff2 font`;
  if (file.size > MAX_FONT_BYTES) return `${file.name}: larger than 2 MB`;
  if (file.size === 0) return `${file.name}: the file is empty`;
  return null;
}

/** "my-brand_Bold.ttf" → "my brand Bold"; made unique against the user's existing names. */
function familyFromFileName(name: string, taken: string[]): string {
  const base =
    name
      .replace(/\.[^.]+$/, '')
      .replace(/[-_]+/g, ' ')
      .replace(/[^\p{L}\p{N} ]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 70) || 'Custom font';
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!lower.has(`${base} (${n})`.toLowerCase())) return `${base} (${n})`;
}

function bufferToDataUrl(buffer: ArrayBuffer, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([buffer], { type: mime }));
  });
}

/**
 * Registers the font with the FontFace API under its own family name (sf-<id>).
 * One face covers every weight (100–900), so the bold headline uses the uploaded
 * glyphs instead of a synthesised bold.
 */
async function register(id: string, buffer: ArrayBuffer, ext: FontExt): Promise<LoadedFont> {
  const face = new FontFace(customFontFamily(id), buffer, { weight: '100 900', style: 'normal', display: 'block' });
  await face.load();
  document.fonts.add(face);
  return { id, dataUrl: await bufferToDataUrl(buffer, FORMATS[ext].mime), format: FORMATS[ext].css };
}

export async function listUserFonts(): Promise<UserFont[]> {
  const { data, error } = await requireClient()
    .from('user_fonts')
    .select('id, family, path')
    .order('created_at', { ascending: true });
  if (error) throw error;
  const fonts = (data ?? []) as UserFont[];
  fonts.forEach((f) => knownPaths.set(f.id, f.path));
  return fonts;
}

/**
 * Downloads an uploaded font through a short-lived signed URL and registers it.
 * Resolves false if it can't be loaded (deleted, someone else's, offline) — text then falls back to Inter.
 */
export function ensureFontLoaded(id: string): Promise<boolean> {
  let load = loads.get(id);
  if (!load) {
    load = (async () => {
      const client = requireClient();
      let path = knownPaths.get(id);
      if (!path) {
        const { data } = await client.from('user_fonts').select('path').eq('id', id).maybeSingle();
        path = (data as { path?: string } | null)?.path;
      }
      const ext = path ? extOf(path) : null;
      if (!path || !ext) return null;
      const { data: signed, error } = await client.storage.from(FONT_BUCKET).createSignedUrl(path, 60 * 60);
      if (error || !signed) return null;
      const res = await fetch(signed.signedUrl);
      if (!res.ok) return null;
      return register(id, await res.arrayBuffer(), ext);
    })().catch(() => null);
    loads.set(id, load);
    // Let a failed load be retried later (e.g. after coming back online).
    void load.then((r) => r === null && loads.delete(id));
  }
  return load.then(Boolean);
}

/** Loads every uploaded font the designs use. Never throws. */
export async function ensureDesignFonts(designs: Pick<Design, 'font'>[]): Promise<void> {
  if (!supabase) return;
  const ids = [...new Set(designs.map((d) => customFontId(d.font)).filter((id): id is string => id !== null))];
  await Promise.all(ids.map(ensureFontLoaded));
}

/**
 * @font-face rules (fonts inlined as data URLs) for the uploaded fonts these designs use.
 * html-to-image only embeds fonts it finds in stylesheets, and fonts added with the FontFace
 * API aren't in any stylesheet — without this CSS an exported PNG would fall back to Inter.
 */
export async function customFontEmbedCSS(designs: Pick<Design, 'font'>[]): Promise<string> {
  await ensureDesignFonts(designs);
  const rules: string[] = [];
  for (const d of designs) {
    const id = customFontId(d.font);
    const loaded = id ? await loads.get(id) : null;
    if (loaded && !rules.some((r) => r.includes(customFontFamily(loaded.id)))) {
      rules.push(
        `@font-face{font-family:'${customFontFamily(loaded.id)}';src:url(${loaded.dataUrl}) format('${loaded.format}');` +
          'font-weight:100 900;font-style:normal;font-display:block;}',
      );
    }
  }
  return rules.join('\n');
}

/**
 * Validates, uploads to fonts/<userId>/<random>.<ext>, records it in user_fonts and registers it.
 * `taken`: the user's existing family names, so the new one gets a unique name.
 */
export async function uploadUserFont(file: File, userId: string, taken: string[]): Promise<UserFont> {
  const problem = validateFontFile(file);
  if (problem) throw new Error(problem);
  const ext = extOf(file.name) as FontExt;
  const buffer = await file.arrayBuffer();
  if (!looksLikeFont(buffer, ext)) throw new Error(`${file.name}: this isn’t a font file`);

  // Make sure the browser can actually use it before storing anything.
  try {
    await new FontFace(`sf-check-${uid()}`, buffer).load();
  } catch {
    throw new Error(`${file.name}: the browser can’t read this font`);
  }

  const client = requireClient();
  const { mime } = FORMATS[ext];
  const path = `${userId}/${uid()}.${ext}`;
  const { error: upErr } = await client.storage
    .from(FONT_BUCKET)
    .upload(path, new Blob([buffer], { type: mime }), { contentType: mime, upsert: false });
  if (upErr) throw upErr;

  const family = familyFromFileName(file.name, taken);
  const { data, error } = await client.from('user_fonts').insert({ family, path }).select('id, family, path').single();
  if (error || !data) {
    await client.storage.from(FONT_BUCKET).remove([path]); // don't leave an unlisted file behind
    throw error ?? new Error('Could not save the font.');
  }
  const font = data as UserFont;
  knownPaths.set(font.id, font.path);
  loads.set(font.id, register(font.id, buffer, ext).catch(() => null));
  await loads.get(font.id);
  return font;
}
