export type RenderProblemCode =
  | 'layer-size'
  | 'bad-dna'
  | 'missing-image'
  | 'batch-range'
  | 'missing-batch'
  | 'reserved-key'
  | 'duplicate-name'
  | 'empty-collage'
  | 'decode'

/**
 * Every refusal the library makes. The worker stores `code` and `message` on the batch row, so
 * messages are plain sentences.
 */
export class RenderProblem extends Error {
  code: RenderProblemCode
  declare tokenId?: number
  declare detail?: Record<string, string | number>

  constructor(
    code: RenderProblemCode,
    message: string,
    options: { tokenId?: number; detail?: Record<string, string | number> } = {},
  ) {
    super(message)
    this.name = 'RenderProblem'
    this.code = code
    if (options.tokenId !== undefined) this.tokenId = options.tokenId
    if (options.detail !== undefined) this.detail = options.detail
  }
}

/** The same problem tagged with the token it happened on. A problem that already names one is kept. */
export function forToken(problem: RenderProblem, tokenId: number): RenderProblem {
  if (problem.tokenId !== undefined) return problem
  return new RenderProblem(problem.code, `Token ${tokenId}: ${problem.message}`, {
    tokenId,
    ...(problem.detail ? { detail: problem.detail } : {}),
  })
}

/** The reason text of anything thrown, for a problem's detail. */
export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
