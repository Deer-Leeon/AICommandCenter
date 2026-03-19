/**
 * RevealOverlay
 *
 * Covers the entire app from the first React render until the wave animation
 * completes, preventing any flash of unstyled / partially-loaded UI.
 *
 * Lifecycle:
 *   1. Mounts immediately (renders when !revealed).
 *   2. On mount, removes the static #nexus-preload div from index.html —
 *      that div covered the screen before React ran; this component takes over.
 *   3. While waiting for data (revealing === false): solid dark cover, no animation.
 *   4. When revealing === true: CSS wave animation plays (1.5 s).
 *   5. finishReveal() is called → revealed = true → this component unmounts.
 */

import { useEffect, useRef } from 'react';
import { useRevealStore } from '../store/useRevealStore';

export function RevealOverlay() {
  const { revealing, revealed, finishReveal } = useRevealStore();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hand off from the static HTML pre-loader to this React component.
  // Run once on mount: remove the <div id="nexus-preload"> that was painted by
  // the browser before any JS loaded. We are now the cover.
  useEffect(() => {
    document.getElementById('nexus-preload')?.remove();
  }, []);

  // Start the finishReveal timer when the wave animation begins.
  // Must match the animation duration in index.css (.nexus-reveal-overlay: 0.6s).
  useEffect(() => {
    if (!revealing) return;
    timerRef.current = setTimeout(finishReveal, 600);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [revealing, finishReveal]);

  // Unmount entirely once revealed — app takes over with no cover
  if (revealed) return null;

  return (
    <div
      className={revealing ? 'nexus-reveal-overlay' : undefined}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        background: 'var(--bg)',
        pointerEvents: 'all',
        animation: revealing ? undefined : 'none',
      }}
      aria-hidden="true"
    />
  );
}
