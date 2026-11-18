import { uid } from '@/lib/constants';
import { SCREENSHOT_BUCKET, supabase } from '@/lib/supabase';

export interface UploadedImage {
  url: string;
  path: string | null;
}

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ['image/png', 'image/jpeg', 'image/webp'];

export function validateImage(file: File): string | null {
  if (!ALLOWED.includes(file.type)) return `${file.name}: use PNG, JPG or WebP`;
  if (file.size > MAX_BYTES) return `${file.name}: larger than 10 MB`;
  return null;
}

/**
 * Uploads to Supabase Storage when the user is signed in;
 * otherwise returns a data: URL so the local project can keep the image.
 */
export async function uploadScreenshot(file: File, opts: { userId: string | null; projectId: string }): Promise<UploadedImage> {
  if (supabase && opts.userId) {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
    const path = `${opts.userId}/${opts.projectId}/${uid()}.${ext}`;
    const { error } = await supabase.storage.from(SCREENSHOT_BUCKET).upload(path, file, {
      cacheControl: '31536000',
      contentType: file.type,
      upsert: false,
    });
    if (error) throw error;
    const { data } = supabase.storage.from(SCREENSHOT_BUCKET).getPublicUrl(path);
    return { url: data.publicUrl, path };
  }
  return { url: await readAsDataUrl(file), path: null };
}

/** Storage's remove() accepts at most 1000 paths per call. */
const REMOVE_BATCH = 1000;

/**
 * Deletes files from the screenshots bucket. Throws on a Storage error so callers can retry.
 * RLS only lets a user delete inside their own folder (needs 0003_rls_fixes.sql for the SELECT rule).
 */
export async function deleteScreenshots(paths: string[]): Promise<void> {
  if (!supabase || paths.length === 0) return;
  for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
    const { error } = await supabase.storage.from(SCREENSHOT_BUCKET).remove(paths.slice(i, i + REMOVE_BATCH));
    if (error) throw error;
  }
}

export async function deleteScreenshot(path: string | null) {
  if (path) await deleteScreenshots([path]);
}

/**
 * Deletes every file in screenshots/<userId>/<projectId>/. Returns how many were removed.
 * Uploads are stored flat in that folder, so sub-folders are not walked.
 */
export async function deleteProjectFolder(userId: string, projectId: string): Promise<number> {
  if (!supabase) return 0;
  const bucket = supabase.storage.from(SCREENSHOT_BUCKET);
  const folder = `${userId}/${projectId}`;
  let removed = 0;
  // Re-list from the start after each batch, since the deleted files are gone from the listing.
  // The cap stops an endless loop if Storage reports success but keeps the files.
  for (let round = 0; round < 50; round++) {
    const { data, error } = await bucket.list(folder, { limit: REMOVE_BATCH });
    if (error) throw error;
    const files = (data ?? []).filter((f) => f.id !== null); // id is null for sub-folder entries
    if (files.length === 0) break;
    await deleteScreenshots(files.map((f) => `${folder}/${f.name}`));
    removed += files.length;
    if (files.length < REMOVE_BATCH) break;
  }
  return removed;
}

/**
 * Storage paths a design points at: slide screenshots, background images and the feature graphic's icon
 * (cloud uploads only; local data URLs have none). Storage cleanup keeps every path listed here.
 */
export function screenshotPathsIn(design: {
  slides: { imagePath: string | null; backdrop?: { image?: { path: string | null } | null } }[];
  featureGraphic?: { iconPath: string | null };
  backgroundImage?: { path: string | null } | null;
}): string[] {
  const paths: string[] = [];
  for (const s of design.slides) {
    if (s.imagePath) paths.push(s.imagePath);
    if (s.backdrop?.image?.path) paths.push(s.backdrop.image.path);
  }
  if (design.featureGraphic?.iconPath) paths.push(design.featureGraphic.iconPath);
  if (design.backgroundImage?.path) paths.push(design.backgroundImage.path);
  return paths;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
