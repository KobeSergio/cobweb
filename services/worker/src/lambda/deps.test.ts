import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  productionDeps: vi.fn(),
}))
vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class {
    send = mocks.send
  },
  GetSecretValueCommand: class {
    constructor(public input: unknown) {}
  },
}))
vi.mock('../env.ts', () => ({ productionDeps: mocks.productionDeps }))

describe('loadDeps', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.send.mockReset()
    mocks.productionDeps.mockReset()
    process.env.RENDER_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:000000000000:secret:render'
  })

  it('reads the secret and builds the ports once per container', async () => {
    const ports = { name: 'ports' }
    mocks.send.mockResolvedValue({ SecretString: '{"SUPABASE_SERVICE_ROLE_KEY":"k"}' })
    mocks.productionDeps.mockReturnValue(ports)
    const { loadDeps } = await import('./deps.ts')
    expect(await Promise.all([loadDeps(), loadDeps()])).toEqual([ports, ports])
    expect(await loadDeps()).toBe(ports)
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.productionDeps).toHaveBeenCalledTimes(1)
    expect(mocks.productionDeps.mock.calls[0]?.[0]).toMatchObject({ SUPABASE_SERVICE_ROLE_KEY: 'k' })
  })

  it('tries again after a failed build', async () => {
    mocks.send.mockRejectedValueOnce(new Error('throttled'))
    mocks.send.mockResolvedValue({ SecretString: '{}' })
    mocks.productionDeps.mockReturnValue({ name: 'ports' })
    const { loadDeps } = await import('./deps.ts')
    await expect(loadDeps()).rejects.toThrow('throttled')
    expect(await loadDeps()).toEqual({ name: 'ports' })
  })

  it('names the missing ARN and nothing else', async () => {
    delete process.env.RENDER_SECRET_ARN
    const { loadDeps } = await import('./deps.ts')
    await expect(loadDeps()).rejects.toThrow('RENDER_SECRET_ARN is not set.')
  })
})
