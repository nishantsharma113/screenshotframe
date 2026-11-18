import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * The Supabase client, or null when env vars are missing.
 * Without Supabase the app still works: projects are saved in localStorage
 * and templates come from FALLBACK_TEMPLATES.
 */
export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null;

export const isSupabaseConfigured = supabase !== null;

export const SCREENSHOT_BUCKET = 'screenshots';
