import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Prompt tests drive real readline/raw-mode code through fake streams;
    // keep them on the same event loop rather than spreading across workers.
    fileParallelism: false
  }
})
