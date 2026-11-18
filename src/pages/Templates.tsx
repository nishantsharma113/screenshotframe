import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { MyTemplates } from '@/components/MyTemplates';
import { SiteHeader } from '@/components/SiteHeader';
import { useAuth } from '@/hooks/useAuth';
import { readableTextColor } from '@/lib/constants';
import type { Template, TemplateCategory } from '@/lib/types';
import { loadLocalProject } from '@/services/projects';
import { listTemplates } from '@/services/templates';

const CATEGORIES: ('All' | TemplateCategory)[] = ['All', 'Minimal', 'Bold', 'Panoramic', 'Dark', 'Playful'];
const STORES = [
  { id: 'all', label: 'All stores' },
  { id: 'ios', label: 'App Store' },
  { id: 'play', label: 'Google Play' },
] as const;

export function Templates() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('All');
  const [store, setStore] = useState<(typeof STORES)[number]['id']>('all');
  const [query, setQuery] = useState('');
  const { user } = useAuth();
  const navigate = useNavigate();
  // ?tab=mine opens "My templates" (linkable, survives refresh).
  const [search, setSearch] = useSearchParams();
  const tab = search.get('tab') === 'mine' ? 'mine' : 'all';
  const setTab = (t: 'all' | 'mine') => setSearch(t === 'mine' ? { tab: 'mine' } : {}, { replace: true });

  useEffect(() => {
    listTemplates().then(setTemplates);
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (templates ?? []).filter(
      (t) =>
        (category === 'All' || t.category === category) &&
        (store === 'all' || t.store === store || t.store === 'both') &&
        (!q || t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)),
    );
  }, [templates, category, store, query]);

  const pickTemplate = (t: Template) => {
    if (!user && loadLocalProject()) {
      const ok = window.confirm('This replaces the project saved in this browser. Sign in to keep several projects. Continue?');
      if (!ok) return;
    }
    navigate(`/editor/new?template=${encodeURIComponent(t.id)}`);
  };

  return (
    <div className="light-page">
      <SiteHeader />
      <main className="container section">
        <h1 className="page-title">Templates</h1>
        <p className="section__lead">Pick one, swap in your screenshots, and change anything.</p>

        <div className="segmented" role="tablist" aria-label="Template source" style={{ marginBottom: 20 }}>
          <button type="button" role="tab" aria-selected={tab === 'all'} aria-pressed={tab === 'all'} onClick={() => setTab('all')}>
            All templates
          </button>
          <button type="button" role="tab" aria-selected={tab === 'mine'} aria-pressed={tab === 'mine'} onClick={() => setTab('mine')}>
            My templates
          </button>
        </div>

        {tab === 'mine' ? (
          <MyTemplates />
        ) : (
          <>
            <div className="filters">
              <div className="chips" role="group" aria-label="Style">
                {CATEGORIES.map((c) => (
                  <button key={c} type="button" className="chip" aria-pressed={category === c} onClick={() => setCategory(c)}>
                    {c}
                  </button>
                ))}
              </div>
              <div className="filters__right">
                <label className="search">
                  <span className="sr-only">Search templates</span>
                  <Icon name="search" />
                  <input type="search" placeholder="Search templates" value={query} onChange={(e) => setQuery(e.target.value)} />
                </label>
                <div className="segmented" role="group" aria-label="Store">
                  {STORES.map((s) => (
                    <button key={s.id} type="button" aria-pressed={store === s.id} onClick={() => setStore(s.id)}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
    
            {templates === null ? (
              <p className="muted">Loading templates…</p>
            ) : (
              <>
                <p className="muted small" aria-live="polite">
                  {shown.length} {shown.length === 1 ? 'template' : 'templates'}
                </p>
                {shown.length === 0 ? (
                  <div className="empty">
                    <p>No templates match these filters.</p>
                    <button
                      type="button"
                      className="btn btn--outline"
                      onClick={() => {
                        setCategory('All');
                        setStore('all');
                        setQuery('');
                      }}
                    >
                      Clear filters
                    </button>
                  </div>
                ) : (
                  <div className="template-grid">
                    {shown.map((t) => (
                      <article key={t.id} className="template-card">
                        <div className="template-card__preview">
                          {[0, 1, 2].map((i) => (
                            <div key={i} className="mini-slide" style={{ background: t.design.background }}>
                              <div className="mini-slide__line" style={{ background: readableTextColor(t.design.background) }} />
                              <div className="mini-slide__line mini-slide__line--short" style={{ background: readableTextColor(t.design.background) }} />
                              <div className="mini-slide__device" />
                            </div>
                          ))}
                        </div>
                        <div className="template-card__body">
                          <div>
                            <h2>{t.name}</h2>
                            <p className="muted small">
                              {t.category} · {t.store === 'both' ? 'iOS and Android' : t.store === 'ios' ? 'App Store' : 'Google Play'}
                            </p>
                          </div>
                          <button type="button" className="btn btn--outline" onClick={() => pickTemplate(t)}>
                            Use
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
