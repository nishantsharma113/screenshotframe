import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useEditorLink } from '@/hooks/useEditorLink';
import { isSupabaseConfigured } from '@/lib/supabase';
import { Logo } from './Logo';

export function SiteHeader() {
  const { user, isAdmin, signOut } = useAuth();
  const editorLink = useEditorLink();
  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Logo />
        <nav aria-label="Main" className="site-nav">
          <a href={`${import.meta.env.BASE_URL}#features`}>Features</a>
          <Link to="/templates">Templates</Link>
          <Link to="/icon">Icon generator</Link>
          <a href={`${import.meta.env.BASE_URL}#pricing`}>Pricing</a>
          <a href={`${import.meta.env.BASE_URL}#faq`}>FAQ</a>
        </nav>
        <div className="site-header__actions">
          {isSupabaseConfigured &&
            (user ? (
              <>
                {isAdmin && (
                  <span className="pill" title="Admin account · Extended plan (all features)">
                    Admin · Pro
                  </span>
                )}
                <Link to="/projects" className="btn btn--ghost">
                  My projects
                </Link>
                <Link to="/account/billing" className="btn btn--ghost">
                  Billing
                </Link>
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
