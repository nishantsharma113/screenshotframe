import { Link, NavLink } from 'react-router-dom';
import { BILLING_ENABLED } from '@/config/features';
import { useAuth } from '@/hooks/useAuth';
import { useEditorLink } from '@/hooks/useEditorLink';
import { isSupabaseConfigured } from '@/lib/supabase';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';

export function SiteHeader() {
  const { user, isAdmin, signOut } = useAuth();
  const editorLink = useEditorLink();
  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Logo />
        <nav aria-label="Main" className="site-nav">
          {user && <NavLink to="/projects">My projects</NavLink>}
          <a href={`${import.meta.env.BASE_URL}#features`}>Features</a>
          <NavLink to="/templates">Templates</NavLink>
          <NavLink to="/icon">Icon generator</NavLink>
          {BILLING_ENABLED && <a href={`${import.meta.env.BASE_URL}#pricing`}>Pricing</a>}
          <a href={`${import.meta.env.BASE_URL}#faq`}>FAQ</a>
        </nav>
        <div className="site-header__actions">
          <ThemeToggle />
          {isSupabaseConfigured &&
            (user ? (
              <>
                {isAdmin && (
                  <span className="pill" title="Admin account · Extended plan (all features)">
                    Admin · Pro
                  </span>
                )}
                {BILLING_ENABLED && (
                  <Link to="/account/billing" className="btn btn--ghost">
                    Billing
                  </Link>
                )}
                <button type="button" className="btn btn--ghost" onClick={() => void signOut()}>
                  Sign out
                </button>
              </>
            ) : (
              <Link to="/signin" className="btn btn--ghost">
                Sign in
              </Link>
            ))}
          <Link to={editorLink} className="btn btn--primary">
            Open editor
          </Link>
        </div>
      </div>
    </header>
  );
}
