// A node resolve hook for scripts that import the app's TypeScript modules: `@/` maps to
// apps/web/src/ (the tsconfig path), and a relative or mapped import without an extension gets
// ".ts" when the bare path does not resolve (packages/dna imports its files that way).
//
//   node --import ./scripts/resolve-ts.mjs scripts/verify-chain.ts

import { registerHooks } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const src = resolve(dirname(fileURLToPath(import.meta.url)), '../src')
const HAS_EXTENSION = /\.(ts|tsx|js|mjs|cjs|json)$/

registerHooks({
  resolve(specifier, context, nextResolve) {
    const target = specifier.startsWith('@/')
      ? pathToFileURL(resolve(src, specifier.slice(2))).href
      : specifier
    try {
      return nextResolve(target, context)
    } catch (error) {
      const local = target.startsWith('.') || target.startsWith('file:')
      if (local && !HAS_EXTENSION.test(target)) return nextResolve(`${target}.ts`, context)
      throw error
    }
  },
})
