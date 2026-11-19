import { Icon } from '@/components/Icon';
import { useTheme } from '@/hooks/useTheme';

/** Sun/moon icon button that flips the light/dark theme. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} onClick={toggle}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}
