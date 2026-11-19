import { Link } from 'react-router-dom';

/** `compact` shows only the mark (editor top bar); the name stays available to screen readers. */
export function Logo({ compact = false, to = '/' }: { compact?: boolean; to?: string }) {
  return (
    <Link to={to} className="logo" aria-label={compact ? 'Shotframe home' : undefined}>
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <rect x="1" y="1" width="26" height="26" rx="7" fill="#4F46E5" />
        <rect x="9" y="6" width="10" height="16" rx="2.5" stroke="#fff" strokeWidth="2" />
      </svg>
      {!compact && <span>Shotframe</span>}
    </Link>
  );
}
