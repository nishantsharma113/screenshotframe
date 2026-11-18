// Run: deno test supabase/functions/translate/  (or see README → Auto-translate)
import { assert, assertEquals } from 'jsr:@std/assert@1.0.13';
import { handle, type Db, type Deps } from './handler.ts';

const PROJECT = '11111111-2222-3333-4444-555555555555';
const DESIGN = {
  locales: ['en', 'de'],
  slides: [
    { id: 's1', headline: { en: 'Build habits\nthat stick' }, subtitle: { en: 'Track anything' } },
    { id: 's2', headline: { en: 'See your streaks' }, subtitle: { en: '' } }, // empty subtitle: not sent
    { id: 's3', headline: {}, subtitle: { en: 'Only a subtitle' } },
  ],
};

interface FakeOpts {
  user?: { id: string } | null;
  plan?: string;
  isAdmin?: boolean;
  noAdminColumn?: boolean;
  design?: unknown;
  remaining?: number;
  provider?: string;
  apiKey?: string;
  providerStatus?: number;
  providerBody?: unknown;
}

function setup(o: FakeOpts = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  let rpcCalls = 0;
  const db: Db = {
    auth: { getUser: async (jwt) => ({ data: { user: jwt === 'good' ? (o.user === undefined ? { id: 'u1' } : o.user) : null }, error: null }) },
    from: (table) => ({
      select: (cols) => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === 'profiles') {
              if (cols.includes('is_admin') && o.noAdminColumn) return { data: null, error: { message: 'column is_admin does not exist' } };
              return { data: { plan: o.plan ?? 'standard', ...(cols.includes('is_admin') ? { is_admin: o.isAdmin ?? false } : {}) }, error: null };
            }
            return { data: o.design === undefined ? { design: DESIGN } : o.design, error: null };
          },
        }),
      }),
    }),
    rpc: async () => {
      rpcCalls++;
      return { data: o.remaining ?? 42, error: null };
    },
  };
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const body = JSON.parse(String(init?.body ?? '{}'));
    const n = (body.text ?? body.q ?? []).length;
    const ok = o.providerBody ??
      (String(url).includes('deepl')
        ? { translations: Array.from({ length: n }, (_, i) => ({ text: `DE:${(body.text as string[])[i]}` })) }
        : { data: { translations: Array.from({ length: n }, (_, i) => ({ translatedText: `G:${(body.q as string[])[i]}` })) } });
    return new Response(JSON.stringify(ok), { status: o.providerStatus ?? 200 });
  }) as typeof fetch;
  const deps: Deps = {
    clientFor: () => db,
    fetch: fakeFetch,
    env: { provider: o.provider, apiKey: o.apiKey === undefined ? 'key:fx' : o.apiKey },
  };
  return { deps, calls, rpc: () => rpcCalls };
}

const post = (body: unknown, token = 'good') =>
  new Request('http://x/translate', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const ok = { projectId: PROJECT, targetLocale: 'de' };

Deno.test('CORS preflight', async () => {
  const res = await handle(new Request('http://x', { method: 'OPTIONS' }), setup().deps);
  assertEquals(res.status, 204);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
});

Deno.test('401 without a token, or with a token Supabase Auth rejects', async () => {
  const { deps, calls } = setup();
  assertEquals((await handle(new Request('http://x', { method: 'POST', body: '{}' }), deps)).status, 401);
  assertEquals((await handle(post(ok, 'forged'), deps)).status, 401);
  assertEquals(calls.length, 0);
});

Deno.test('400 for bad input', async () => {
  const { deps } = setup();
  assertEquals((await handle(post({ projectId: 'nope', targetLocale: 'de' }), deps)).status, 400);
  assertEquals((await handle(post({ projectId: PROJECT, targetLocale: 'xx' }), deps)).status, 400);
  assertEquals((await handle(post({ projectId: PROJECT, targetLocale: 'en' }), deps)).status, 400); // = main language
});

Deno.test('403 on the basic plan; admins and standard/extended pass', async () => {
  const basic = setup({ plan: 'basic' });
  const res = await handle(post(ok), basic.deps);
  assertEquals(res.status, 403);
  assertEquals(basic.calls.length, 0);
  assertEquals(basic.rpc(), 0); // no quota used
  assertEquals((await handle(post(ok), setup({ plan: 'basic', isAdmin: true }).deps)).status, 200);
  assertEquals((await handle(post(ok), setup({ plan: 'extended' }).deps)).status, 200);
  assertEquals((await handle(post(ok), setup({ plan: 'standard', noAdminColumn: true }).deps)).status, 200);
});

Deno.test('404 when RLS hides the project', async () => {
  const s = setup({ design: null });
  assertEquals((await handle(post(ok), s.deps)).status, 404);
  assertEquals(s.rpc(), 0);
});

Deno.test('one DeepL batch with every non-empty text, mapped back per slide', async () => {
  const s = setup();
  const res = await handle(post(ok), s.deps);
  assertEquals(res.status, 200);
  assertEquals(s.calls.length, 1); // ONE request
  const req = s.calls[0];
  assertEquals(req.url, 'https://api-free.deepl.com/v2/translate'); // ":fx" key → free host
  assertEquals((req.init.headers as Record<string, string>).Authorization, 'DeepL-Auth-Key key:fx');
  const sent = JSON.parse(String(req.init.body));
  assertEquals(sent.text, ['Build habits\nthat stick', 'Track anything', 'See your streaks', 'Only a subtitle']);
  assertEquals([sent.source_lang, sent.target_lang], ['EN', 'DE']);
  const body = await res.json();
  assertEquals(body.slides, [
    { id: 's1', headline: 'DE:Build habits\nthat stick', subtitle: 'DE:Track anything' },
    { id: 's2', headline: 'DE:See your streaks', subtitle: '' },
    { id: 's3', headline: '', subtitle: 'DE:Only a subtitle' },
  ]);
  assertEquals(body.remaining, 42);
  assertEquals(s.rpc(), 1);
});

Deno.test('paid DeepL key uses api.deepl.com; English/Portuguese targets get a variant', async () => {
  const s = setup({ apiKey: 'paid-key', design: { design: { ...DESIGN, locales: ['de', 'en'], slides: [{ id: 'a', headline: { de: 'Hallo' }, subtitle: {} }] } } });
  await handle(post({ projectId: PROJECT, targetLocale: 'en' }), s.deps);
  assertEquals(s.calls[0].url, 'https://api.deepl.com/v2/translate');
  assertEquals(JSON.parse(String(s.calls[0].init.body)).target_lang, 'EN-US');
});

Deno.test('Google provider: one request, source/target codes, format text', async () => {
  const s = setup({ provider: 'google', apiKey: 'gkey' });
  const res = await handle(post({ projectId: PROJECT, targetLocale: 'hi' }), s.deps);
  assertEquals(res.status, 200);
  assertEquals(s.calls.length, 1);
  assert(s.calls[0].url.startsWith('https://translation.googleapis.com/language/translate/v2?key=gkey'));
  const sent = JSON.parse(String(s.calls[0].init.body));
  assertEquals([sent.source, sent.target, sent.format], ['en', 'hi', 'text']);
  assertEquals((await res.json()).slides[0].headline, 'G:Build habits\nthat stick');
});

Deno.test('Hindi with DeepL is refused before using quota or calling DeepL', async () => {
  const s = setup();
  const res = await handle(post({ projectId: PROJECT, targetLocale: 'hi' }), s.deps);
  assertEquals(res.status, 400);
  assert((await res.json()).error.includes('Hindi'));
  assertEquals(s.calls.length, 0);
  assertEquals(s.rpc(), 0);
});

Deno.test('429 when the daily limit is used up; the provider is not called', async () => {
  const s = setup({ remaining: -1 });
  const res = await handle(post(ok), s.deps);
  assertEquals(res.status, 429);
  assert((await res.json()).error.includes('50'));
  assertEquals(s.calls.length, 0);
});

Deno.test('nothing to translate: no quota, no API call', async () => {
  const s = setup({ design: { design: { locales: ['en'], slides: [{ id: 'a', headline: { en: '  ' }, subtitle: {} }] } } });
  const res = await handle(post(ok), s.deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).slides, [{ id: 'a', headline: '', subtitle: '' }]);
  assertEquals([s.calls.length, s.rpc()], [0, 0]);
});

Deno.test('provider errors become readable 502s', async () => {
  for (const [status, text] of [[403, 'API key'], [456, 'quota'], [500, '500']] as const) {
    const res = await handle(post(ok), setup({ providerStatus: status, providerBody: {} }).deps);
    assertEquals(res.status, 502);
    assert((await res.json()).error.includes(text), `status ${status}`);
  }
  const wrongCount = await handle(post(ok), setup({ providerBody: { translations: [{ text: 'only one' }] } }).deps);
  assertEquals(wrongCount.status, 502);
});

Deno.test('500 with a clear message when the API key secret is missing', async () => {
  const s = setup({ apiKey: '' });
  const res = await handle(post(ok), s.deps);
  assertEquals(res.status, 500);
  assert((await res.json()).error.includes('TRANSLATE_API_KEY'));
  assertEquals(s.rpc(), 0);
});
