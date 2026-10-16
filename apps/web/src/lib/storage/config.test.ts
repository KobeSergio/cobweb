import { afterEach, describe, expect, it, vi } from 'vitest'
import { mintPageBucket, renderBucket } from './config'

// The module carries the server-only marker, which refuses to load outside a server build.
vi.mock('server-only', () => ({}))

describe('the buckets beside the art bucket (final fix wave M8)', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('answer their own names, the mint page bucket mint-page by default', () => {
    vi.stubEnv('ART_S3_BUCKET', 'art')
    vi.stubEnv('RENDER_S3_BUCKET', 'render')
    vi.stubEnv('MINT_PAGE_S3_BUCKET', '')
    expect(renderBucket()).toBe('render')
    expect(mintPageBucket()).toBe('mint-page')
    vi.stubEnv('MINT_PAGE_S3_BUCKET', 'page-media')
    expect(mintPageBucket()).toBe('page-media')
  })

  it('refuse the art bucket, which the upload sweep empties of what no upload records', () => {
    vi.stubEnv('ART_S3_BUCKET', 'art')
    vi.stubEnv('RENDER_S3_BUCKET', 'art')
    vi.stubEnv('MINT_PAGE_S3_BUCKET', 'art')
    expect(() => renderBucket()).toThrow('RENDER_S3_BUCKET names the art bucket')
    expect(() => mintPageBucket()).toThrow('MINT_PAGE_S3_BUCKET names the art bucket')
    // The default name is refused too when the art bucket carries it.
    vi.stubEnv('ART_S3_BUCKET', 'mint-page')
    vi.stubEnv('MINT_PAGE_S3_BUCKET', '')
    expect(() => mintPageBucket()).toThrow('MINT_PAGE_S3_BUCKET names the art bucket')
  })
})
