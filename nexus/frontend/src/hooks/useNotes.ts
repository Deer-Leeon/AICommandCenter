import { useState, useCallback, useEffect } from 'react';
import { apiFetch } from '../lib/api';
import { wcRead, wcWrite, awaitPrefetchOrFetch, WC_KEY } from '../lib/widgetCache';
import type { QuickNote } from '../types';

const ENDPOINT = '/api/notes';

export function useNotes() {
  const [notes, setNotes] = useState<QuickNote[]>(() => {
    const cached = wcRead<QuickNote[]>(WC_KEY.NOTES);
    return cached?.data ?? [];
  });

  const [hasLoaded, setHasLoaded] = useState(
    () => wcRead(WC_KEY.NOTES) !== null,
  );

  const fetchNotes = useCallback(async () => {
    try {
      const res = await awaitPrefetchOrFetch(ENDPOINT, () => apiFetch(ENDPOINT));
      if (!res.ok) return;
      const data: QuickNote[] = await res.json();
      const items = Array.isArray(data) ? data : [];
      setNotes(items);
      wcWrite(WC_KEY.NOTES, items);
    } catch {
      // keep cached data on network error
    } finally {
      setHasLoaded(true);
    }
  }, []);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  /** Create a new note. Returns the persisted note on success, null on failure. */
  const createNote = useCallback(async (
    title: string,
    content: string,
  ): Promise<QuickNote | null> => {
    try {
      const res = await apiFetch(ENDPOINT, {
        method: 'POST',
        body: JSON.stringify({ title, content }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const note: QuickNote = await res.json();
      setNotes(prev => {
        const updated = [note, ...prev];
        wcWrite(WC_KEY.NOTES, updated);
        return updated;
      });
      return note;
    } catch (err) {
      console.error('[useNotes] createNote failed:', err);
      return null;
    }
  }, []);

  /**
   * Update an existing note (title + content). Optimistic — updates local
   * state immediately and syncs to server. Re-sorts by updatedAt desc.
   */
  const updateNote = useCallback(async (
    id: string,
    title: string,
    content: string,
  ): Promise<void> => {
    const now = new Date().toISOString();
    setNotes(prev => {
      const updated = prev
        .map(n => n.id === id ? { ...n, title, content, updatedAt: now } : n)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      wcWrite(WC_KEY.NOTES, updated);
      return updated;
    });

    try {
      await apiFetch(`${ENDPOINT}/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ title, content }),
      });
    } catch {
      // Optimistic update stays — note is still in local state
    }
  }, []);

  /**
   * Delete a note with optimistic removal and rollback on failure.
   */
  const deleteNote = useCallback(async (id: string): Promise<void> => {
    let snapshot: QuickNote | undefined;
    setNotes(prev => {
      snapshot = prev.find(n => n.id === id);
      const updated = prev.filter(n => n.id !== id);
      wcWrite(WC_KEY.NOTES, updated);
      return updated;
    });

    try {
      await apiFetch(`${ENDPOINT}/${id}`, { method: 'DELETE' });
    } catch {
      if (snapshot) {
        setNotes(prev => {
          const updated = [snapshot!, ...prev].sort(
            (a, b) => b.updatedAt.localeCompare(a.updatedAt),
          );
          wcWrite(WC_KEY.NOTES, updated);
          return updated;
        });
      }
    }
  }, []);

  return { notes, createNote, updateNote, deleteNote, hasLoaded };
}
