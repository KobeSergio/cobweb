import { readFileSync } from 'node:fs'
import { ART_PROBLEM_CODES, WORKER_FAILURE_CODES } from '@cobweb/shared/render-queue'
import { describe, expect, it } from 'vitest'

/** Every render problem code in the render library's source, as it declares them. */
function renderProblemCodes(): string[] {
  const source = readFileSync(new URL('../../render/src/problems.ts', import.meta.url), 'utf8')
  const union = /export type RenderProblemCode =([^]*?)\n\n/.exec(source)?.[1] ?? ''
  return [...union.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]!)
}

/** Thrown only by the preview collage, whose failure is logged and skipped: it never fails a job. */
const NEVER_FAILS_A_JOB = ['empty-collage']

/** In ART_PROBLEM_CODES but written by the worker, not thrown by the render library. */
const WORKER_ONLY = ['batch-too-large']

describe('the exported code lists', () => {
  it('ART_PROBLEM_CODES covers every render problem code except the one that never fails a job', () => {
    const codes = renderProblemCodes()
    expect(codes.length).toBeGreaterThanOrEqual(9)
    const art = ART_PROBLEM_CODES.filter((code) => !WORKER_ONLY.includes(code))
    expect([...art, ...NEVER_FAILS_A_JOB].sort()).toEqual([...codes].sort())
  })

  it('keeps the worker failure codes apart from the render problem codes', () => {
    for (const code of WORKER_FAILURE_CODES) expect(renderProblemCodes()).not.toContain(code)
    for (const code of WORKER_ONLY) expect(WORKER_FAILURE_CODES).toContain(code)
  })
})
