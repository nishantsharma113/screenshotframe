import { supabase } from '@/lib/supabase';

export interface TranslatedSlide {
  id: string;
  headline: string;
  subtitle: string;
}

export interface TranslateResult {
  slides: TranslatedSlide[];
  /** Auto-translations left today (null when nothing needed translating). */
  remaining: number | null;
}

/**
 * Calls the `translate` Edge Function for a saved cloud project. The function translates every
 * slide from the project's main language in one batch. Throws an Error with a readable message.
 */
export async function autoTranslate(projectId: string, targetLocale: string): Promise<TranslateResult> {
  if (!supabase) throw new Error('Auto-translate needs Supabase.');
  const { data, error } = await supabase.functions.invoke<TranslateResult>('translate', {
    body: { projectId, targetLocale },
  });
  if (error) {
    // HTTP errors carry the function's JSON ({ error }) in `context`, a Response.
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      const body = (await ctx.json().catch(() => null)) as { error?: string } | null;
      if (body?.error) throw new Error(body.error);
      if (ctx.status === 404) throw new Error('The translate function isn’t deployed yet (see README → Auto-translate).');
      throw new Error(`The translate function failed (${ctx.status}).`);
    }
    throw new Error('Couldn’t reach the translate function. Check your connection, and that it’s deployed.');
  }
  if (!data || !Array.isArray(data.slides)) throw new Error('The translate function returned an unexpected answer.');
  return data;
}
