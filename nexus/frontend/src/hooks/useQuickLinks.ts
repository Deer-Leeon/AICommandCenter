import { useState, useCallback, useEffect } from 'react';
import { apiFetch } from '../lib/api';
import { wcRead, wcWrite, awaitPrefetchOrFetch, WC_KEY } from '../lib/widgetCache';
import type { QuickLink } from '../types';

const ENDPOINT = '/api/quick-links';

type LinksMap = Record<number, QuickLink>;

function arrayToMap(links: QuickLink[]): LinksMap {
  const map: LinksMap = {};
  for (const link of links) map[link.slotIndex] = link;
  return map;
}

function mapToArray(map: LinksMap): QuickLink[] {
  return Object.values(map).sort((a, b) => a.slotIndex - b.slotIndex);
}

export function useQuickLinks() {
  const [links, setLinks] = useState<LinksMap>(() => {
    const cached = wcRead<QuickLink[]>(WC_KEY.LINKS);
    return cached ? arrayToMap(cached.data) : {};
  });

  const [hasLoaded, setHasLoaded] = useState(
    () => wcRead(WC_KEY.LINKS) !== null,
  );

  const fetchLinks = useCallback(async () => {
    try {
      const res = await awaitPrefetchOrFetch(ENDPOINT, () => apiFetch(ENDPOINT));
      if (!res.ok) return;
      const data: QuickLink[] = await res.json();
      const map = arrayToMap(data);
      setLinks(map);
      wcWrite(WC_KEY.LINKS, data);
    } catch {
      // network error — keep cached data
    } finally {
      setHasLoaded(true);
    }
  }, []);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  /** Optimistically save a link (create or update) */
  const saveLink = useCallback(async (link: QuickLink) => {
    const prev = { ...links };
    setLinks(next => {
      const updated = { ...next, [link.slotIndex]: link };
      wcWrite(WC_KEY.LINKS, mapToArray(updated));
      return updated;
    });
    try {
      await apiFetch(ENDPOINT, {
        method: 'PUT',
        body: JSON.stringify(link),
      });
    } catch {
      setLinks(prev);
      wcWrite(WC_KEY.LINKS, mapToArray(prev));
    }
  }, [links]);

  /** Optimistically remove a link */
  const removeLink = useCallback(async (slotIndex: number) => {
    const prev = { ...links };
    setLinks(next => {
      const updated = { ...next };
      delete updated[slotIndex];
      wcWrite(WC_KEY.LINKS, mapToArray(updated));
      return updated;
    });
    try {
      await apiFetch(`${ENDPOINT}/${slotIndex}`, { method: 'DELETE' });
    } catch {
      setLinks(prev);
      wcWrite(WC_KEY.LINKS, mapToArray(prev));
    }
  }, [links]);

  /**
   * Swap or move two slots — used for drag-to-reorder.
   * If dst is empty, src is moved there (src slot cleared).
   * If both are filled, they are swapped.
   */
  const swapLinks = useCallback(async (srcIdx: number, dstIdx: number) => {
    if (srcIdx === dstIdx) return;
    const srcLink = links[srcIdx];
    if (!srcLink) return;

    const dstLink = links[dstIdx];
    const prev = { ...links };

    // Optimistic update
    const next: LinksMap = { ...links };
    next[dstIdx] = { ...srcLink, slotIndex: dstIdx };
    if (dstLink) {
      next[srcIdx] = { ...dstLink, slotIndex: srcIdx };
    } else {
      delete next[srcIdx];
    }
    setLinks(next);
    wcWrite(WC_KEY.LINKS, mapToArray(next));

    // Persist to server
    try {
      const upserts: QuickLink[] = [next[dstIdx]];
      if (next[srcIdx]) upserts.push(next[srcIdx]);

      await apiFetch(`${ENDPOINT}/batch`, {
        method: 'POST',
        body: JSON.stringify({ links: upserts }),
      });

      // If src slot is now empty, delete it from DB
      if (!next[srcIdx]) {
        await apiFetch(`${ENDPOINT}/${srcIdx}`, { method: 'DELETE' });
      }
    } catch {
      setLinks(prev);
      wcWrite(WC_KEY.LINKS, mapToArray(prev));
    }
  }, [links]);

  return { links, saveLink, removeLink, swapLinks, hasLoaded, fetchLinks };
}
