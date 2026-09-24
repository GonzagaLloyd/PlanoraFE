import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  build: {
    target: 'es2015',
    sourcemap: false,
    minify: mode !== 'development',
    emptyOutDir: mode !== 'development',
    lib: {
      entry: 'src/loader.ts',
      formats: ['iife'],
      name: 'PlanoraLoader',
      fileName: () => 'loader.js',
    },
  },
}));
