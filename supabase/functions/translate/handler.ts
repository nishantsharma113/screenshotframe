// Request handling for the `translate` Edge Function, kept free of Deno globals so it can be
// tested with fake dependencies (see handler_test.ts). index.ts wires up the real ones.

/** Locales the app offers (src/lib/constants.ts LANGUAGES). */
export const SUPPORTED_LOCALES = ['en', 'hi', 'es', 'de', 'fr', 'pt', 'ja', 'ar', 'he'] as const;
type Locale = (typeof SUPPORTED_LOCALES)[number];

const PAID_PLANS = ['standard', 'extended'];

export type Provider = 'deepl' | 'google';

/** The subset of a supabase-js client this handler uses (makes it easy to fake in tests). */
export interface Db {
  auth: { getUser(jwt: string): Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  from(table: string): {
    select(cols: string): {
      eq(col: string, value: string): { maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }> };
    };
  };
  rpc(fn: string): Promise<{ data: unknown; error: { message: string } | null }>;
}

export interface Deps {
  /** A client that acts as the caller (their JWT in the Authorization header), so RLS applies. */
  clientFor(authHeader: string): Db;
  fetch: typeof fetch;
  env: { provider: string | undefined; apiKey: string | undefined };
}

interface Slide {
  id: string;
  headline?: Record<string, string>;
  subtitle?: Record<string, string>;
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const fail = (status: number, error: string) => json(status, { error });

class ProviderError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return fail(405, 'Use POST.');

  // ── Who is calling ──
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!jwt) return fail(401, 'Sign in to use auto-translate.');
  const db = deps.clientFor(authHeader);
  const { data: auth, error: authErr } = await db.auth.getUser(jwt); // verifies the JWT with Supabase Auth
  const user = auth?.user;
  if (authErr || !user) return fail(401, 'Your session has expired. Sign in again.');

  // ── What they asked for ──
  let body: { projectId?: unknown; targetLocale?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(400, 'Send JSON: { projectId, targetLocale }.');
  }
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  const target = typeof body.targetLocale === 'string' ? body.targetLocale : '';
  if (!UUID.test(projectId)) return fail(400, 'projectId must be a project id.');
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(target)) return fail(400, `Unsupported language: ${target || '(none)'}.`);

  // ── Plan ──
  let profile = await db.from('profiles').select('plan, is_admin').eq('id', user.id).maybeSingle();
  if (profile.error) profile = await db.from('profiles').select('plan').eq('id', user.id).maybeSingle(); // before 0002_admin
  const p = (profile.data ?? {}) as { plan?: string; is_admin?: boolean };
  if (!p.is_admin && !PAID_PLANS.includes(p.plan ?? 'basic')) {
    return fail(403, 'Auto-translate is on the Standard plan.');
  }

  // ── Project (RLS: only the owner's row is visible) ──
  const { data: row, error: projErr } = await db.from('projects').select('design').eq('id', projectId).maybeSingle();
  if (projErr) return fail(500, 'Could not load the project.');
  const design = (row as { design?: { locales?: string[]; slides?: Slide[] } } | null)?.design;
  if (!design) return fail(404, 'Project not found, or you don’t have access to it.');
  const source = design.locales?.[0] ?? 'en';
  if (source === target) return fail(400, 'That is already the project’s main language.');
  const slides = Array.isArray(design.slides) ? design.slides : [];

  // ── One batch: every non-empty headline and subtitle in the main language ──
  const texts: string[] = [];
  const slots: { slide: number; field: 'headline' | 'subtitle' }[] = [];
  slides.forEach((s, i) => {
    for (const field of ['headline', 'subtitle'] as const) {
      const t = s[field]?.[source] ?? '';
      if (t.trim()) {
        texts.push(t);
        slots.push({ slide: i, field });
      }
    }
  });
  const result = slides.map((s) => ({ id: s.id, headline: '', subtitle: '' }));
  if (texts.length === 0) return json(200, { slides: result, remaining: null });

  const provider: Provider = deps.env.provider?.toLowerCase() === 'google' ? 'google' : 'deepl';
  if (!deps.env.apiKey) return fail(500, 'Auto-translate isn’t set up: the TRANSLATE_API_KEY secret is missing.');
  const unsupported = providerUnsupported(provider, source, target);
  if (unsupported) return fail(400, unsupported);

  // ── Daily limit (counted before calling the paid API) ──
  const { data: remaining, error: quotaErr } = await db.rpc('consume_translate_quota');
  if (quotaErr) return fail(500, 'Could not check today’s auto-translate limit.');
  if (remaining === -1) return fail(429, 'You’ve used today’s 50 auto-translations. Try again tomorrow (UTC).');

  let translated: string[];
  try {
    translated = await translateBatch(deps.fetch, provider, deps.env.apiKey, texts, source as Locale, target as Locale);
  } catch (e) {
    return fail(502, e instanceof ProviderError ? e.message : 'The translation service didn’t respond. Try again.');
  }
  if (translated.length !== texts.length) return fail(502, 'The translation service returned an unexpected answer.');

  slots.forEach((slot, k) => {
    result[slot.slide][slot.field] = translated[k];
  });
  return json(200, { slides: result, remaining });
}

/* ── Providers ─────────────────────────────────────────────── */

// DeepL wants upper-case codes; English and Portuguese targets need a variant. Hindi isn't offered.
const DEEPL_TARGET: Partial<Record<Locale, string>> = { en: 'EN-US', pt: 'PT-BR', es: 'ES', de: 'DE', fr: 'FR', ja: 'JA', ar: 'AR', he: 'HE' };
const DEEPL_SOURCE: Partial<Record<Locale, string>> = { en: 'EN', pt: 'PT', es: 'ES', de: 'DE', fr: 'FR', ja: 'JA', ar: 'AR', he: 'HE' };

function providerUnsupported(provider: Provider, source: string, target: string): string | null {
  if (provider !== 'deepl') return null;
  const name = (c: string) => ({ hi: 'Hindi', he: 'Hebrew' } as Record<string, string>)[c] ?? c;
  if (!DEEPL_TARGET[target as Locale]) return `${name(target)} isn’t available with DeepL. Translate it by hand, or switch the function to Google.`;
  if (!DEEPL_SOURCE[source as Locale]) return `DeepL can’t translate from ${name(source)}.`;
  return null;
}

export async function translateBatch(
  fetchFn: typeof fetch,
  provider: Provider,
  apiKey: string,
  texts: string[],
  source: Locale,
  target: Locale,
): Promise<string[]> {
  if (provider === 'deepl') {
    // Free-plan keys end in ":fx" and use a different host.
    const host = apiKey.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
    const res = await fetchFn(`${host}/v2/translate`, {
      method: 'POST',
      headers: { Authorization: `DeepL-Auth-Key ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: texts,
        source_lang: DEEPL_SOURCE[source],
        target_lang: DEEPL_TARGET[target],
        preserve_formatting: true, // keep the line breaks people put in headlines
      }),
    });
    if (res.status === 403) throw new ProviderError('DeepL rejected the API key (check TRANSLATE_API_KEY).');
    if (res.status === 456) throw new ProviderError('The DeepL account’s monthly character quota is used up.');
    if (res.status === 429) throw new ProviderError('DeepL is rate-limiting requests. Try again in a minute.');
    if (!res.ok) throw new ProviderError(`DeepL returned an error (${res.status}).`);
    const data = (await res.json()) as { translations?: { text: string }[] };
    return (data.translations ?? []).map((t) => t.text);
  }

  const res = await fetchFn(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: texts, source, target, format: 'text' }),
  });
  if (res.status === 400 || res.status === 403) {
    const msg = ((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message;
    throw new ProviderError(`Google Translate refused the request${msg ? `: ${msg}` : ''} (check TRANSLATE_API_KEY).`);
  }
  if (res.status === 429) throw new ProviderError('Google Translate is rate-limiting requests. Try again in a minute.');
  if (!res.ok) throw new ProviderError(`Google Translate returned an error (${res.status}).`);
  const data = (await res.json()) as { data?: { translations?: { translatedText: string }[] } };
  return (data.data?.translations ?? []).map((t) => t.translatedText);
}
