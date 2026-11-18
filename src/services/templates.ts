import { FALLBACK_TEMPLATES } from '@/lib/constants';
import { supabase } from '@/lib/supabase';
import type { Template } from '@/lib/types';

export async function listTemplates(): Promise<Template[]> {
  if (!supabase) return FALLBACK_TEMPLATES;
  const { data, error } = await supabase
    .from('templates')
    .select('id, name, category, store, design')
    .order('sort', { ascending: true });
  if (error || !data?.length) return FALLBACK_TEMPLATES;
  return data as Template[];
}

export async function getTemplate(id: string): Promise<Template | null> {
  const all = await listTemplates();
  return all.find((t) => t.id === id) ?? null;
}
