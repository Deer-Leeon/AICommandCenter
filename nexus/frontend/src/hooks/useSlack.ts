import { useEffect, useCallback, useState } from 'react';
import { useStore } from '../store/useStore';
import type { SlackMessage } from '../types';
import { apiFetch } from '../lib/api';
import { wcRead, wcWrite, wcIsStale, wcAge, WC_KEY, WC_TTL, awaitPrefetchOrFetch } from '../lib/widgetCache';

export interface SlackChannel {
  id: string;
  name: string;
}

const DEFAULT_PREFETCH_EP = '/api/slack/messages?limit=10';

// Progressive rendering: if cached data is younger than this, delay the first
// background refresh to prevent visible content swaps on load.
const DEFER_THRESHOLD_MS = 30 * 60_000;
const DEFER_DELAY_MS     = 10_000;

export function useSlack() {
  const { slackMessages, setSlackMessages } = useStore();
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [activeChannel, setActiveChannel] = useState<string>(
    () => localStorage.getItem('nexus-slack-channel') ?? '',
  );

  const [isCacheStale, setIsCacheStale] = useState(
    () => wcIsStale(WC_KEY.SLACK_MESSAGES, WC_TTL.SLACK),
  );

  // hasLoaded: immediately true if we have a cache hit, otherwise true after first fetch
  const [hasLoaded, setHasLoaded] = useState(
    () => wcRead(WC_KEY.SLACK_MESSAGES) !== null,
  );

  const fetchMessages = useCallback(async (channel?: string) => {
    try {
      const ch = channel ?? activeChannel;
      const query = ch ? `?channel=${encodeURIComponent(ch)}&limit=10` : '?limit=10';
      const endpoint = `/api/slack/messages${query}`;

      const res = (!channel && !activeChannel)
        ? await awaitPrefetchOrFetch(DEFAULT_PREFETCH_EP, () => apiFetch(endpoint))
        : await apiFetch(endpoint);

      if (res.ok) {
        const data: SlackMessage[] = await res.json();
        setSlackMessages(data);
        wcWrite(WC_KEY.SLACK_MESSAGES, data);
        setIsCacheStale(false);
      }
    } catch {
      // keep cached data
    } finally {
      setHasLoaded(true);
    }
  }, [activeChannel, setSlackMessages]);

  const fetchChannels = useCallback(async () => {
    try {
      const res = await apiFetch('/api/slack/channels');
      if (res.ok) {
        const data: SlackChannel[] = await res.json();
        setChannels(data);
      }
    } catch {
      // ignore
    }
  }, []);

  const switchChannel = useCallback((channelName: string) => {
    setActiveChannel(channelName);
    localStorage.setItem('nexus-slack-channel', channelName);
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  // Initial fetch + polling with progressive deferral.
  useEffect(() => {
    const cacheAge = !activeChannel ? wcAge(WC_KEY.SLACK_MESSAGES) : Infinity;
    const deferMs = cacheAge < DEFER_THRESHOLD_MS ? DEFER_DELAY_MS : 0;

    let delay: ReturnType<typeof setTimeout> | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    function startPolling() {
      fetchMessages();
      interval = setInterval(() => fetchMessages(), 30_000);
    }

    if (deferMs > 0) {
      delay = setTimeout(startPolling, deferMs);
    } else {
      startPolling();
    }

    return () => {
      if (delay !== null) clearTimeout(delay);
      if (interval !== null) clearInterval(interval);
    };
  }, [fetchMessages, activeChannel]);

  return {
    messages: slackMessages,
    channels,
    activeChannel,
    switchChannel,
    refetch: fetchMessages,
    isCacheStale,
    hasLoaded,
  };
}
