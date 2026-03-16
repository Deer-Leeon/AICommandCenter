import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// When building for Electron, all asset URLs must be relative (./assets/...)
// because the app loads from a file:// URL, not a web server.
// Set VITE_ELECTRON=true in the electron:build:dmg script to enable this.
const isElectronBuild = process.env.VITE_ELECTRON === 'true';

export default defineConfig({
  plugins: [react()],
  base: isElectronBuild ? './' : '/',
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    host: true,
    allowedHosts: ['nexus.lj-buchmiller.com', 'localhost'],
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    // Smaller chunks = faster individual resource loads + better cache granularity
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          // recharts + d3 is ~250 KB — only load when a chart widget is on the grid
          if (id.includes('recharts') || id.includes('/d3-') || id.includes('victory-vendor')) return 'vendor-charts';
          // Supabase client: large but needed at auth time — separate so other vendor chunks are smaller
          if (id.includes('@supabase')) return 'vendor-supabase';
          // Everything else (React, router, dnd-kit, zustand…) in one stable vendor chunk.
          // Keeping them together avoids circular-chunk warnings from cross-package imports.
          return 'vendor';
        },
      },
    },
  },
})
