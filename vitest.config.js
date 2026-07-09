import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests don't need the server
    include: ['tests/**/*.test.js'],
    // Integration tests are skipped unless SERVER_RUNNING=1 is set
    testTimeout: 10000,
  },
});
