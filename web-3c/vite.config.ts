import { fileURLToPath } from 'node:url';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import { localReferenceAssets } from './reference-assets.ts';

export default defineConfig({
  base: './',
  plugins: [localReferenceAssets()],
  server: {
    fs: {
      allow: [
        searchForWorkspaceRoot(fileURLToPath(new URL('.', import.meta.url))),
        fileURLToPath(new URL('../reports/web-3c/asset-audit.json', import.meta.url)),
        fileURLToPath(new URL('../docs/player/motions.json', import.meta.url)),
      ],
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        m2: fileURLToPath(new URL('./m2.html', import.meta.url)),
        m7: fileURLToPath(new URL('./m7.html', import.meta.url)),
        jsonViewer: fileURLToPath(new URL('./json-viewer.html', import.meta.url)),
      },
      output: {
        // Physics (Rapier with its inlined wasm) and rendering (Three.js) change rarely; keep them in their own chunks.
        manualChunks(id) {
          if (id.includes('@dimforge/rapier3d')) return 'vendor-rapier';
          if (id.includes('node_modules/three/')) return 'vendor-three';
        },
      },
    },
    chunkSizeWarningLimit: 2600, // vendor-rapier carries the inlined wasm (~2.2 MB) by design
  },
});