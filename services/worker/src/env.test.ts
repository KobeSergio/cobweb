import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { artS3Options, filebaseS3Options, need, productionDeps, WORKER_ENV } from './env.ts'

const LOCAL = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key-value',
  ART_S3_ENDPOINT: 'http://127.0.0.1:54321/storage/v1/s3',
  ART_S3_REGION: 'local',
  ART_S3_BUCKET: 'art',
  ART_S3_ACCESS_KEY_ID: 'art-key-id',
  ART_S3_SECRET_ACCESS_KEY: 'art-key-secret',
  ART_S3_FORCE_PATH_STYLE: '1',
  RENDER_S3_BUCKET: 'render',
  FILEBASE_BUCKET: 'cobweb-pins',
  FILEBASE_ACCESS_KEY_ID: 'filebase-key-id',
  FILEBASE_SECRET_ACCESS_KEY: 'filebase-key-secret',
  RENDER_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/000000000000/render',
}

describe('the env names', () => {
  it('never start with NEXT_PUBLIC_', () => {
    for (const name of WORKER_ENV) expect(name.startsWith('NEXT_PUBLIC_')).toBe(false)
  })

  it('are all in .env.example, which sets no secret and no public name', () => {
    const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
    const lines = example.split('\n').filter((line) => line && !line.startsWith('#'))
    const names = lines.map((line) => line.split('=')[0])
    for (const name of WORKER_ENV) expect(names, name).toContain(name)
    expect(names).toContain('RPC_URL_31337')
    expect(names).toContain('FACTORY_ADDRESS_31337')
    expect(example).not.toContain('NEXT_PUBLIC_SUPABASE')
    for (const line of lines)
      if (/KEY|SECRET|RPC_URL/.test(line.split('=')[0] ?? '')) expect(line.endsWith('=')).toBe(true)
  })
})

describe('need', () => {
  it('names the missing variable and never a value', () => {
    expect(need({ A: 'value' }, 'A')).toBe('value')
    expect(() => need({ A: '' }, 'A')).toThrow('A is not set.')
    expect(() => need({}, 'SUPABASE_SERVICE_ROLE_KEY')).toThrow('SUPABASE_SERVICE_ROLE_KEY is not set.')
  })
})

describe('artS3Options', () => {
  it('uses the endpoint, path style and keys of local storage, with the checksum settings that work there', () => {
    expect(artS3Options(LOCAL)).toEqual({
      region: 'local',
      endpoint: 'http://127.0.0.1:54321/storage/v1/s3',
      forcePathStyle: true,
      credentials: { accessKeyId: 'art-key-id', secretAccessKey: 'art-key-secret' },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
  })

  it('leaves credentials to the role on AWS', () => {
    expect(artS3Options({ ART_S3_REGION: 'us-east-1' })).toEqual({
      region: 'us-east-1',
      forcePathStyle: false,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
    expect(() => artS3Options({})).toThrow('ART_S3_REGION is not set.')
  })
})

describe('filebaseS3Options', () => {
  it('defaults to the documented endpoint and needs both keys', () => {
    expect(filebaseS3Options(LOCAL)).toEqual({
      region: 'us-east-1',
      endpoint: 'https://s3.filebase.com',
      forcePathStyle: true,
      credentials: { accessKeyId: 'filebase-key-id', secretAccessKey: 'filebase-key-secret' },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
    expect(filebaseS3Options({ ...LOCAL, FILEBASE_S3_ENDPOINT: 'http://127.0.0.1:9000' }).endpoint).toBe(
      'http://127.0.0.1:9000',
    )
    expect(() => filebaseS3Options({})).toThrow('FILEBASE_ACCESS_KEY_ID is not set.')
  })
})

describe('productionDeps', () => {
  it('builds every port without opening a connection', () => {
    const deps = productionDeps(LOCAL, () => {})
    expect(Object.keys(deps).sort()).toEqual(['chain', 'jobs', 'log', 'pinner', 'queue', 'retry', 'store'])
    expect(deps.retry?.delaysMs).toEqual([1000, 3000, 6000])
  })

  it('refuses an incomplete environment by name, without echoing any value', () => {
    for (const name of [
      'SUPABASE_SERVICE_ROLE_KEY',
      'RENDER_S3_BUCKET',
      'FILEBASE_BUCKET',
      'RENDER_QUEUE_URL',
    ]) {
      let message = ''
      try {
        productionDeps({ ...LOCAL, [name]: undefined }, () => {})
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).toBe(`${name} is not set.`)
      for (const value of Object.values(LOCAL)) expect(message).not.toContain(value)
    }
  })

  it('refuses the art bucket as the render bucket, before building any client or reading anything else', () => {
    // Nothing else in this environment is set, so a client built first would fail on another name.
    const env = { ART_S3_BUCKET: 'art', RENDER_S3_BUCKET: 'art', ART_S3_REGION: 'local' }
    expect(() => productionDeps(env, () => {})).toThrow('RENDER_S3_BUCKET must not be the art bucket.')
    expect(() => productionDeps({ ...LOCAL, RENDER_S3_BUCKET: LOCAL.ART_S3_BUCKET }, () => {})).toThrow(
      'RENDER_S3_BUCKET must not be the art bucket.',
    )
  })
})
