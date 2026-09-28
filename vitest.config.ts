import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'jsdom',
    // Threads start faster than forked processes; parallel forks each booting
    // jsdom timed out on slower Windows machines.
    pool: 'threads',
  },
});
