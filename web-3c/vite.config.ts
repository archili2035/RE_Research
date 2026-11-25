import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { localReferenceAssets } from './reference-assets.ts';

export default defineConfig({
  base: './',
  plugins: [localReferenceAssets()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        m2: fileURLToPath(new URL('./m2.html', import.meta.url)),
        m7: fileURLToPath(new URL('./m7.html', import.meta.url)),
      },
    },
  },
});
