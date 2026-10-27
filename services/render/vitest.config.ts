import { defineConfig } from 'vitest/config'

// The CAR packing tests build directories of thousands of entries and the collage tests decode images at
// the 8192 by 8192 input limit; on a shared CI runner each takes 5 to 8 seconds, past vitest's 5 second
// default (CI run 40479016905, 27 October 2026). A minute leaves room without hiding a hang.
export default defineConfig({
  test: { testTimeout: 60_000 },
})
