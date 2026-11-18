import { useCallback, useEffect, useState } from 'react';
import { customFontId } from '@/lib/constants';
import { supabase } from '@/lib/supabase';
import { ensureFontLoaded, listUserFonts, uploadUserFont, type UserFont } from '@/services/fonts';

/**
 * The signed-in user's uploaded fonts for the editor: lists them, loads the one the design
 * uses, and uploads new ones. Without Supabase or a user it stays empty.
 */
export function useUserFonts(userId: string | null, designFont: string) {
  const [fonts, setFonts] = useState<UserFont[]>([]);
  const [uploading, setUploading] = useState(false);
  /** Bumped when a font finishes loading, so the canvas re-measures text. */
  const [, setLoadedTick] = useState(0);

  useEffect(() => {
    if (!supabase || !userId) {
      setFonts([]);
      return;
    }
    let cancelled = false;
    listUserFonts()
      .then((list) => !cancelled && setFonts(list))
      .catch(() => !cancelled && setFonts([]));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Load the font the design uses (on open, after undo/redo, or when picked).
  const activeId = customFontId(designFont);
  useEffect(() => {
    if (!activeId || !supabase) return;
    let cancelled = false;
    void ensureFontLoaded(activeId).then((ok) => ok && !cancelled && setLoadedTick((t) => t + 1));
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const upload = useCallback(
    async (file: File): Promise<UserFont> => {
      if (!userId) throw new Error('Sign in to upload fonts.');
      setUploading(true);
      try {
        const font = await uploadUserFont(file, userId, fonts.map((f) => f.family));
        setFonts((list) => [...list, font]);
        return font;
      } finally {
        setUploading(false);
      }
    },
    [userId, fonts],
  );

  return { fonts, upload, uploading };
}
