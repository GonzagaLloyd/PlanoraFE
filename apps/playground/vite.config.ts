import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  // Multi-page app: unknown URLs return a real 404 (the demo's "failing API call").
  appType: 'mpa',
  esbuild: { jsx: 'automatic' },
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        plain: resolve(__dirname, 'plain.html'),
        react: resolve(__dirname, 'react.html'),
        hostile: resolve(__dirname, 'hostile.html'),
        public: resolve(__dirname, 'public.html'),
      },
    },
  },
});
