import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'shotframe-theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

/** The saved choice, if the user ever picked one; otherwise null (follow the system). */
function savedTheme(): Theme | null {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : null;
  } catch {
    return null;
  }
}

function currentTheme(): Theme {
  return savedTheme() ?? (media().matches ? 'dark' : 'light');
}

/**
 * Light/dark theme on <html data-theme>. index.html sets it before first paint;
 * this keeps it in sync, follows the system until the user picks one, and saves that pick.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(currentTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const mq = media();
    const onChange = () => {
      if (!savedTheme()) setThemeState(mq.matches ? 'dark' : 'light');
    };
    // Another tab changed it.
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setThemeState(currentTheme());
    };
    mq.addEventListener('change', onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      mq.removeEventListener('change', onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const setTheme = useCallback((t: Theme) => {
    try {
      localStorage.setItem(KEY, t);
    } catch {
      // Private mode: the choice lasts for this page only.
    }
    setThemeState(t);
  }, []);

  const toggle = useCallback(() => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'), [setTheme]);

  return { theme, setTheme, toggle };
}
