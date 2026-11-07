import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit suites only; the contract suite (real network) runs via `npm run test:contract`.
    include: ['Tests/unit/**/*.test.ts'],
    environment: 'node',
    // fetch is injected per test; nothing reaches the network.
    restoreMocks: true,
  },
});
