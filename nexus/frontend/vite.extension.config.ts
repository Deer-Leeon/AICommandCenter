import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite build configuration for the Chrome Extension target.
 *
 * Key differences from the standard web build:
 *  • base: './'            — all asset URLs are relative; required so the
 *                            extension can serve from chrome-extension://...
 *  • input: index.extension.html — uses the inline-script-free entry HTML
 *  • outDir: dist-extension — separate output folder; keep web dist clean
 *  • VITE_IS_EXTENSION flag — lets runtime code detect extension context
 *  • No service worker     — extensions can't register SW on their own pages
 */
export default defineConfig({
  plugins: [react()],

  // Relative base so every <script src>, <link href>, CSS url() all resolve
  // correctly from chrome-extension://[id]/index.html
  base: './',

  build: {
    outDir: 'dist-extension',
    emptyOutDir: true,

    rollupOptions: {
      input: 'index.extension.html',

      output: {
        // Predictable entry name so manifest can reference it if needed
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',

        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          // recharts + d3 — only load when a chart widget is visible
          if (
            id.includes('recharts') ||
            id.includes('/d3-') ||
            id.includes('victory-vendor')
          )
            return 'vendor-charts';
          // Supabase — large but needed at auth time
          if (id.includes('@supabase')) return 'vendor-supabase';
          // Everything else (React, router, zustand, dnd-kit…)
          return 'vendor';
        },
      },
    },
  },

  // Build-time flag: lets main.tsx / supabase.ts know this is an extension
  define: {
    'import.meta.env.VITE_IS_EXTENSION': JSON.stringify('true'),
  },
});
