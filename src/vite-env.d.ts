/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** "true" shows pricing and billing (see src/config/features.ts) */
  readonly VITE_ENABLE_BILLING?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
