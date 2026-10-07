import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '.')
const engineFiles = readdirSync(SRC).filter(
  (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'fixture.ts',
)

describe('the engine stays framework-free', () => {
  it('imports nothing from react, next, node or the DOM, and rolls no dice of its own', () => {
    for (const file of engineFiles) {
      const text = readFileSync(join(SRC, file), 'utf8')
      expect(text, file).not.toMatch(/from ['"](react|next|node:)/)
      expect(text, file).not.toMatch(/\b(document|window|localStorage)\b/)
      if (file !== 'random.ts') expect(text, file).not.toMatch(/Math\.random/)
    }
  })
})
