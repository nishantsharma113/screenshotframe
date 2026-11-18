import { useAuth } from './useAuth';

/**
 * Signed in → a fresh cloud project.
 * Signed out → the single browser project (created on first visit, kept after).
 */
export function useEditorLink(): string {
  const { user } = useAuth();
  return user ? '/editor/new' : '/editor/local';
}
