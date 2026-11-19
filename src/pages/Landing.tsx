import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PLANS, PLAN_ORDER, isPaidPlan } from '@shared/plans';
import { Icon, type IconName } from '@/components/Icon';
import { SiteHeader } from '@/components/SiteHeader';
import { SlideView } from '@/components/SlideView';
import { useAuth } from '@/hooks/useAuth';
import { useEditorLink } from '@/hooks/useEditorLink';
import { createDefaultDesign, getDevice } from '@/lib/constants';
import { BILLING_ENABLED } from '@/config/features';
import { formatPrice, getPrices, type Prices } from '@/services/billing';

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'phone', title: 'Real device frames', body: 'Latest iPhone, iPad, Pixel and Android tablet frames, in portrait or landscape.' },
  { icon: 'move', title: 'Simple editor', body: 'Change device, background, layout and headlines. Every change saves automatically.' },
  { icon: 'download', title: 'Smart export', body: 'Design once, get every store size for every language in a single ZIP.' },
  { icon: 'globe', title: 'Localization', body: 'Add languages and keep a translated headline set per store locale.' },
  { icon: 'cube', title: '3D device angles', body: 'Tilt devices for depth without opening a 3D tool.' },
  { icon: 'code', title: 'Your data, your backend', body: 'Projects and uploads live in your own Supabase project.' },
];

// Plans, features and limits: supabase/functions/_shared/plans.ts (shared with the server).
// Prices: read live from the Razorpay plans, so this page always matches checkout.

const FAQ = [
  ['Do I need an account?', 'No. Open the editor and start; your project is kept in this browser. Sign in to save projects to the cloud and open them anywhere.'],
  ['Which sizes can I export?', 'iPhone 6.9" and 6.5", iPad 13", and Google Play phone and tablet sizes, in portrait or landscape, plus the Google Play feature graphic (1024 × 500).'],
  ['Can I translate my screenshots?', 'Yes. Add a language and edit each headline for it; export includes one folder per language.'],
  ['Where are my screenshots stored?', 'Signed in: in Supabase Storage under your account. Signed out: only in this browser.'],
];

const heroDesign = createDefaultDesign();

export function Landing() {
  const [yearly, setYearly] = useState(false);
  const editorLink = useEditorLink();
  const { user } = useAuth();
  const [prices, setPrices] = useState<Prices | null | undefined>(undefined);
  useEffect(() => {
    if (BILLING_ENABLED) void getPrices().then(setPrices);
  }, []);
  const interval = yearly ? 'yearly' : 'monthly';
  /** Paid plans go to Billing (via sign-up when signed out), with the plan pre-selected. */
  const planLink = (id: string) => {
    if (!isPaidPlan(id)) return editorLink;
    const billing = `/account/billing?plan=${id}&interval=${interval}`;
    return user ? billing : `/signin?mode=signup&next=${encodeURIComponent(billing)}`;
  };

  return (
    <div className="light-page">
      <SiteHeader />

      <section className="container hero">
        <span className="pill">For iOS and Android developers</span>
        <h1>
          Store screenshots that make people <span className="hero__accent">tap Install</span>
        </h1>
        <p className="hero__lead">
          Put your app in real device frames, add headlines, and export every size the App Store and Google Play ask
          for — in a few minutes, right in your browser.
        </p>
        <div className="hero__cta">
          <Link to={editorLink} className="btn btn--primary btn--lg">
            Start designing — it’s free
          </Link>
          <Link to="/templates" className="btn btn--outline btn--lg">
            Browse templates
          </Link>
        </div>
        <p className="muted small">No account needed to start</p>
      </section>

      <section className="container hero-strip" aria-label="Example screenshots">
        <div className="hero-strip__scroll">
          <div className="hero-strip__row">
            {heroDesign.slides.map((s, i) => (
              <SlideView key={s.id} design={heroDesign} slide={s} index={i} size={getDevice('iphone').previewSize} scale={0.5} />
            ))}
          </div>
        </div>
        <p className="muted small center">One panoramic background flows across all five screenshots.</p>
      </section>

      <section id="features" className="band">
        <div className="container section">
          <span className="eyebrow">Features</span>
          <h2>Everything a store listing needs</h2>
          <p className="section__lead">Built for indie developers and small teams who would rather ship than fight a design tool.</p>
          <div className="card-grid">
            {FEATURES.map((f) => (
              <div className="feature" key={f.title}>
                <div className="feature__icon">
                  <Icon name={f.icon} size={22} />
                </div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="container section">
        <span className="eyebrow">How it works</span>
        <h2>Three steps to a finished listing</h2>
        <ol className="card-grid steps">
          <li>
            <span className="steps__num">1</span>
            <h3>Upload your screens</h3>
            <p>Drop in plain screenshots from your simulator or phone.</p>
          </li>
          <li>
            <span className="steps__num">2</span>
            <h3>Pick a template and edit</h3>
            <p>Change the device, background, headlines and fonts.</p>
          </li>
          <li>
            <span className="steps__num">3</span>
            <h3>Export every size</h3>
            <p>Download one ZIP with the exact sizes each store requires.</p>
          </li>
        </ol>
      </section>

      {BILLING_ENABLED && (
        <section id="pricing" className="band">
          <div className="container section">
            <div className="pricing__head">
              <div>
                <h2>Simple pricing</h2>
                <p className="section__lead">Start free. Upgrade when you need more.</p>
              </div>
              <div className="segmented" role="group" aria-label="Billing period">
                <button type="button" aria-pressed={!yearly} onClick={() => setYearly(false)}>
                  Monthly
                </button>
                <button type="button" aria-pressed={yearly} onClick={() => setYearly(true)}>
                  Yearly
                </button>
              </div>
            </div>
            <div className="card-grid">
              {PLAN_ORDER.map((id) => {
                const p = PLANS[id];
                const paid = isPaidPlan(id);
                const price = paid ? prices?.[id]?.[interval] : null;
                return (
                  <div key={id} className={`plan ${p.popular ? 'plan--popular' : ''}`}>
                    <div className="plan__top">
                      <h3>{p.name}</h3>
                      {p.popular && <span className="plan__badge">Most popular</span>}
                    </div>
                    <div>
                      <span className="plan__price">{!paid ? 'Free' : price ? formatPrice(price) : prices === undefined ? '…' : 'Soon'}</span>{' '}
                      <span className="plan__per">{!paid ? 'forever' : price ? (yearly ? '/ year' : '/ month') : ''}</span>
                    </div>
                    <p className="plan__blurb">{p.blurb}</p>
                    <ul>
                      {p.bullets.map((b) => (
                        <li key={b.text} className={b.soon ? 'is-soon' : undefined}>
                          <Icon name="check" size={18} />
                          <span>
                            {b.text}
                            {b.soon && <span className="soon-badge">Coming soon</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <Link to={planLink(id)} className={`btn btn--lg ${p.popular ? 'btn--white' : 'btn--dark'}`}>
                      {!paid ? 'Start free' : `Choose ${p.name}`}
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section id="faq" className="container section faq">
        <span className="eyebrow">FAQ</span>
        <h2>Questions</h2>
        {FAQ.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </section>

      <section className="container cta-band-wrap">
        <div className="cta-band">
          <h2>Your next release deserves better screenshots</h2>
          <p>Open the editor and have a full set ready before your build finishes uploading.</p>
          <Link to={editorLink} className="btn btn--white btn--lg">
            Start designing
          </Link>
        </div>
      </section>

      <footer className="site-footer">
        <div className="container site-footer__inner">
          <span>© {new Date().getFullYear()} Shotframe</span>
          <nav aria-label="Footer">
            <a href="#privacy">Privacy</a>
            <a href="#terms">Terms</a>
            <a href="#contact">Contact</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
