import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Plan } from '@/lib/types';

interface AuthState {
  user: User | null;
  session: Session | null;
  /** Effective plan: admins always get the top plan. */
  plan: Plan;
  isAdmin: boolean;
  loading: boolean;
  /** Re-reads the plan (e.g. after checkout). */
  refreshPlan: () => void;
  signInWithEmail: (email: string, redirectPath?: string) => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  /** Resolves to true when the account still needs email confirmation. */
  signUpWithPassword: (email: string, password: string, redirectPath?: string) => Promise<{ needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
}

/** Turns Supabase auth errors into sentences a user can act on. */
function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Wrong email or password.';
  if (m.includes('email not confirmed')) return 'Confirm your email first — check your inbox for the link we sent.';
  if (m.includes('already registered')) return 'An account with this email already exists. Sign in instead.';
  if (m.includes('password should be')) return 'Use a password with at least 6 characters.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Wait a minute and try again.';
  if (m.includes('failed to fetch') || m.includes('network') || m.includes('load failed')) {
    // Keep the browser's own wording: it tells DNS blocks, extensions and offline apart.
    return `Can’t reach the server (${message}). Check your connection, browser extensions or DNS, then try again.`;
  }
  return message;
}

/** Full URL for an in-app path, including the base path the app is served from (e.g. GitHub Pages). */
const appUrl = (path: string) => `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`;

function requireAuthClient() {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase.auth;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [plan, setPlan] = useState<Plan>('basic');
  const [isAdmin, setIsAdmin] = useState(false);
  const [planTick, setPlanTick] = useState(0);
  const [loading, setLoading] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) return;
    // finally: a failed session check (offline) must not leave every page stuck on "loading".
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => sub.subscription.unsubscribe();
  }, []);

  /** Whose plan is currently in state, so a refresh doesn't flash Basic for the same user. */
  const planOwner = useRef<string | null>(null);

  useEffect(() => {
    const userId = session?.user.id;
    if (planOwner.current !== (userId ?? null)) {
      // Different (or no) user: start from Basic. A refresh for the same user keeps the
      // current plan until the new answer arrives, so paid features don't flicker off.
      setPlan('basic');
      setIsAdmin(false);
      planOwner.current = userId ?? null;
    }
    if (!supabase || !userId) return;
    const client = supabase;
    let cancelled = false;
    (async () => {
      let { data, error } = await client.from('profiles').select('plan, is_admin').eq('id', userId).maybeSingle();
      if (error) {
        // is_admin doesn't exist until migration 0002 runs; fall back to the plan alone.
        ({ data, error } = await client.from('profiles').select('plan').eq('id', userId).maybeSingle());
      }
      if (cancelled || !data) return;
      const admin = (data as { is_admin?: boolean }).is_admin === true;
      setIsAdmin(admin);
      // The plan the server enforces (0007: cancelled/expired/failed subscriptions fall back to
      // Basic at the right time). Before 0007 is installed, use the stored plan.
      const { data: effective, error: rpcErr } = await client.rpc('my_plan');
      if (cancelled) return;
      setPlan(!rpcErr && typeof effective === 'string' ? (effective as Plan) : admin ? 'extended' : ((data.plan as Plan) ?? 'basic'));
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [session?.user.id, planTick]);

  const value: AuthState = {
    user: session?.user ?? null,
    session,
    plan,
    isAdmin,
    loading,
    refreshPlan: () => setPlanTick((t) => t + 1),
    async signInWithEmail(email, redirectPath = '/projects') {
      const { error } = await requireAuthClient().signInWithOtp({
        email,
        options: { emailRedirectTo: appUrl(redirectPath) },
      });
      if (error) throw new Error(friendlyAuthError(error.message));
    },
    async signInWithPassword(email, password) {
      const { error } = await requireAuthClient().signInWithPassword({ email, password });
      if (error) throw new Error(friendlyAuthError(error.message));
    },
    async signUpWithPassword(email, password, redirectPath = '/projects') {
      const { data, error } = await requireAuthClient().signUp({
        email,
        password,
        options: { emailRedirectTo: appUrl(redirectPath) },
      });
      if (error) throw new Error(friendlyAuthError(error.message));
      // With email confirmation on, Supabase hides existing accounts by returning a user with no identities.
      if (data.user && data.user.identities?.length === 0) {
        throw new Error(friendlyAuthError('already registered'));
      }
      return { needsConfirmation: !data.session };
    },
    async signOut() {
      await supabase?.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
