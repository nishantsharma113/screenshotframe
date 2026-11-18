// Supabase Edge Function: POST { projectId, targetLocale } → { slides: [{ id, headline, subtitle }], remaining }
// Translates every slide's headline and subtitle from the project's main language (design.locales[0])
// in one request to DeepL or Google. See README → "Auto-translate" for setup and deploy commands.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { handle, type Db } from './handler.ts';

Deno.serve((req) =>
  handle(req, {
    // Acts as the caller: their JWT goes to PostgREST, so RLS decides what they can read.
    clientFor: (authHeader) =>
      createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      }) as unknown as Db,
    fetch,
    env: { provider: Deno.env.get('TRANSLATE_PROVIDER'), apiKey: Deno.env.get('TRANSLATE_API_KEY') },
  }),
);
