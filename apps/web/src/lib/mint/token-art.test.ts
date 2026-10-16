import { describe, expect, it, vi } from 'vitest'
import { gatewayUrlOf, METADATA_TIMEOUT_MS, tokenArtOf } from './token-art'

const GATEWAY = 'https://ipfs.io/ipfs'
const CID = 'bafybeihkoviema7g3gxyt6la7vd5ho32ictqbilu3wnlo3rs7ewhnp7lly'

/** A fetch that answers each URL from the table, 404 for any other. */
function gatewayFetch(table: Record<string, unknown>) {
  return vi.fn(async (url: string) =>
    url in table
      ? new Response(JSON.stringify(table[url]), { status: 200 })
      : new Response('missing', { status: 404 }),
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}

describe('gatewayUrlOf (docs/specs/2026-10-16-mint-page-live-data.md, section 7.7)', () => {
  it("turns ipfs:// into the gateway's path, keeps https:// and refuses other schemes", () => {
    expect(gatewayUrlOf(`ipfs://${CID}/12`, GATEWAY)).toBe(`${GATEWAY}/${CID}/12`)
    expect(gatewayUrlOf(`ipfs://ipfs/${CID}/a.png`, GATEWAY)).toBe(`${GATEWAY}/${CID}/a.png`)
    expect(gatewayUrlOf('https://cdn.example/owl.png', GATEWAY)).toBe('https://cdn.example/owl.png')
    expect(gatewayUrlOf('http://cdn.example/owl.png', GATEWAY)).toBeNull()
    expect(gatewayUrlOf('data:image/png;base64,AAAA', GATEWAY)).toBeNull()
    expect(gatewayUrlOf('ipfs://', GATEWAY)).toBeNull()
  })
})

describe('tokenArtOf', () => {
  it("reads the metadata's image through the gateway at the token's URI", async () => {
    const fetchImpl = gatewayFetch({ [`${GATEWAY}/${CID}/7`]: { image: `ipfs://${CID}/images/7.png` } })
    expect(await tokenArtOf(`ipfs://${CID}/`, 7, GATEWAY, fetchImpl)).toEqual({
      layers: [`${GATEWAY}/${CID}/images/7.png`],
      video: false,
    })
  })

  it('plays an MP4 image as a video', async () => {
    const fetchImpl = gatewayFetch({ [`${GATEWAY}/${CID}/1`]: { image: 'https://cdn.example/owl.mp4' } })
    expect(await tokenArtOf(`ipfs://${CID}/`, 1, GATEWAY, fetchImpl)).toEqual({
      layers: ['https://cdn.example/owl.mp4'],
      video: true,
    })
  })

  it('reads a single-file base for every id, the placeholder before the reveal', async () => {
    const fetchImpl = gatewayFetch({
      [`${GATEWAY}/${CID}/metadata.json`]: { image: `ipfs://${CID}/placeholder.gif` },
    })
    for (const id of [1, 9, 300])
      expect(await tokenArtOf(`ipfs://${CID}/metadata.json`, id, GATEWAY, fetchImpl)).toEqual({
        layers: [`${GATEWAY}/${CID}/placeholder.gif`],
        video: false,
      })
  })

  it('answers null when there is no art to show: metadata without an image, an image of another scheme, an empty base', async () => {
    const fetchImpl = gatewayFetch({
      [`${GATEWAY}/${CID}/2`]: { name: 'no image' },
      [`${GATEWAY}/${CID}/3`]: { image: 'http://cdn.example/3.png' },
      [`${GATEWAY}/${CID}/4`]: null,
    })
    expect(await tokenArtOf(`ipfs://${CID}/`, 2, GATEWAY, fetchImpl)).toBeNull()
    expect(await tokenArtOf(`ipfs://${CID}/`, 3, GATEWAY, fetchImpl)).toBeNull()
    expect(await tokenArtOf(`ipfs://${CID}/`, 4, GATEWAY, fetchImpl)).toBeNull()
    expect(await tokenArtOf('', 1, GATEWAY, fetchImpl)).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('throws for a read that fails, answers another status or is not JSON, so the page tries it again (final fix wave M7)', async () => {
    const missing = gatewayFetch({})
    await expect(tokenArtOf(`ipfs://${CID}/`, 1, GATEWAY, missing)).rejects.toThrow('answered 404')
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    await expect(tokenArtOf(`ipfs://${CID}/`, 1, GATEWAY, offline)).rejects.toThrow('Failed to fetch')
    const page = vi.fn(
      async () => new Response('<html>busy</html>', { status: 200 }),
    ) as unknown as typeof fetch
    await expect(tokenArtOf(`ipfs://${CID}/`, 1, GATEWAY, page)).rejects.toThrow()
  })

  it('fails a read that has not answered before its timeout, the read abandoned (fix round 1, item 5)', async () => {
    const timeout = new AbortController()
    const timer = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    // A read that never answers until its signal aborts, as a gateway stuck looking for a CID does.
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('The operation timed out.')))
      })) as unknown as typeof fetch
    try {
      const art = tokenArtOf(`ipfs://${CID}/`, 1, GATEWAY, hanging)
      timeout.abort()
      await expect(art).rejects.toThrow('The operation timed out.')
      expect(timer).toHaveBeenCalledWith(METADATA_TIMEOUT_MS)
      expect(METADATA_TIMEOUT_MS).toBe(10_000)
    } finally {
      timer.mockRestore()
    }
  })
})
