import { useEffect, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { apiFetch } from '../lib/api';

export function useObsidian() {
  const { obsidianContent, setObsidianContent } = useStore();

  const fetchContent = useCallback(async () => {
    try {
      const groceryFile = 'Shopping/Groceries.md';
      const res = await apiFetch(
        `/api/obsidian/file?path=${encodeURIComponent(groceryFile)}`
      );
      if (res.ok) {
        const data = await res.json();
        setObsidianContent(data.content || '');
      }
    } catch {
      console.warn('Obsidian fetch failed, keeping cached data');
    }
  }, [setObsidianContent]);

  useEffect(() => {
    fetchContent();
    const interval = setInterval(fetchContent, 120_000);
    return () => clearInterval(interval);
  }, [fetchContent]);

  return { content: obsidianContent, refetch: fetchContent };
}
