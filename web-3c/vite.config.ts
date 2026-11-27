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
    },
  },
});
