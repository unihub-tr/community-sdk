import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['Tests/contract/**/*.test.ts'],
    environment: 'node',
    // Real requests to UNIHUB_BASE_URL (default production); skipped without UNIHUB_TEST_KEY.
    testTimeout: 20_000,
    // Show the server Date line the suite logs; it is this run's freshness evidence.
    silent: false,
    // One file at a time: the backend refuses a second request per key + IP within 200 ms, and
    // two files run in parallel have separate pacing queues (Phase 04, 2026-11-06).
    fileParallelism: false,
  },
});
