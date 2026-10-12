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

  it('reads the jobs secret, named by JOBS_SECRET_ARN, for the jobs entry points', async () => {
    delete process.env.RENDER_SECRET_ARN
    process.env.JOBS_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:000000000000:secret:jobs'
    mocks.send.mockResolvedValue({ SecretString: '{"SUPABASE_SERVICE_ROLE_KEY":"k"}' })
    mocks.productionDeps.mockReturnValue({ name: 'jobs ports' })
    const { loadDeps } = await import('./deps.ts')
    expect(await loadDeps('jobs')).toEqual({ name: 'jobs ports' })
    expect((mocks.send.mock.calls[0]?.[0] as { input: unknown }).input).toEqual({
      SecretId: 'arn:aws:secretsmanager:us-east-1:000000000000:secret:jobs',
    })
    expect(mocks.productionDeps.mock.calls[0]?.[2]).toBe('jobs')
    delete process.env.JOBS_SECRET_ARN
  })

  it('reads the render secret for the render entry point', async () => {
    mocks.send.mockResolvedValue({ SecretString: '{}' })
    mocks.productionDeps.mockReturnValue({ name: 'ports' })
    const { loadDeps } = await import('./deps.ts')
    await loadDeps('render')
    expect(mocks.productionDeps.mock.calls[0]?.[2]).toBe('render')
  })

  it('names the missing jobs ARN', async () => {
    delete process.env.JOBS_SECRET_ARN
    const { loadDeps } = await import('./deps.ts')
    await expect(loadDeps('jobs')).rejects.toThrow('JOBS_SECRET_ARN is not set.')
  })

  it('names the missing ARN and nothing else', async () => {
    delete process.env.RENDER_SECRET_ARN
    const { loadDeps } = await import('./deps.ts')
    await expect(loadDeps()).rejects.toThrow('RENDER_SECRET_ARN is not set.')
  })
})
