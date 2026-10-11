import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = import.meta.dirname
const libraryFiles = readdirSync(SRC).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))

describe('the render core stays pure', () => {
  it('reads no clock, environment, network or file system', () => {
    expect(libraryFiles.length).toBeGreaterThan(5)
    for (const file of libraryFiles) {
      const text = readFileSync(join(SRC, file), 'utf8')
      expect(text, file).not.toMatch(/\bDate\b/)
      expect(text, file).not.toMatch(/process\.env/)
      expect(text, file).not.toMatch(/\bfetch\b/)
      expect(text, file).not.toMatch(/\bfs\b/)
      expect(text, file).not.toMatch(/\b(performance|hrtime|Math\.random)\b/)
    }
  })
})
