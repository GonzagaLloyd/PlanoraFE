import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig(({ mode }) => ({
  define: {
    __PLANORA_VERSION__: JSON.stringify(pkg.version),
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  build: {
    target: 'es2020',
    sourcemap: true,
    minify: mode !== 'development',
    emptyOutDir: mode !== 'development',
    lib: {
      // index = npm entry (no side effects), widget = CDN entry (attaches window.Planora)
      entry: { index: 'src/index.ts', widget: 'src/cdn.ts' },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
    rollupOptions: {
      output: {
        // The lazily loaded screenshot library gets a stable name (see scripts/check-size.mjs).
        chunkFileNames: (chunk) =>
          chunk.moduleIds.some((id) => id.includes('modern-screenshot')) ? 'chunks/screenshot-[hash].js' : 'chunks/core-[hash].js',
        // Library ES builds skip whitespace minification by default; the CDN bundle needs it.
        minify: mode !== 'development',
      },
    },
  },
}));
