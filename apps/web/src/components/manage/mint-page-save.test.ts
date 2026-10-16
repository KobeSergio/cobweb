import { describe, expect, it, vi, type Mock } from 'vitest'
import { PAGE_UPLOAD_FAILED } from '@/lib/art/result'
import type { MintPageSettingsView } from '@/lib/mint/settings-core'
import { draftOf, type DraftFile, type MintPageDraft } from './mint-page-draft'
import { runSave, type SaveSteps } from './mint-page-save'

const COLLECTION = '0a977c0b-7e53-476b-8c08-6c685315c3af'
const key = (n: number) => `${COLLECTION}/${n.toString(16).padStart(64, '0')}.png`

const view: MintPageSettingsView = {
  published: false,
  description: 'Owls.',
  media: { banner: null, avatar: null, about: null },
  socials: {},
  featuredTokenIds: [],
  sections: {
    team: { enabled: false, members: [] },
    roadmap: { enabled: false, items: [] },
    faq: { enabled: false, items: [] },
    music: { enabled: false, key: null, fileName: null, url: null },
    carousel: { enabled: false, items: [] },
  },
  art: { realBaseUri: null, supply: 10, projectType: 'generative' },
}
/** The view the save answers: the avatar stored. */
const saved: MintPageSettingsView = {
  ...view,
  media: { banner: null, avatar: { key: key(10), url: `https://media.example/${key(10)}` }, about: null },
}

const picked = (name: string, type: string): DraftFile => ({
  kind: 'picked',
  file: new File(['x'.repeat(10)], name, { type }),
  url: `blob:${name}`,
  width: 500,
  height: 500,
})

/** A draft with two files to upload: an avatar and a team photo. */
function twoFiles(): MintPageDraft {
  const draft = draftOf(view)
  draft.media.avatar = picked('avatar.png', 'image/png')
  draft.sections.team = {
    enabled: true,
    members: [
      { id: 'team-1', name: 'Mara', role: 'Artist', bio: '', image: picked('mara.jpg', 'image/jpeg') },
    ],
  }
  return draft
}

type Steps = { [K in keyof SaveSteps]: Mock<SaveSteps[K]> }

/** Steps that succeed: each file signed in order with a PUT URL, each PUT and the save accepted. */
function stepsOf(override: Partial<Steps> = {}): Steps {
  return {
    hash: vi.fn<SaveSteps['hash']>(async () => 'ab'.repeat(32)),
    presign: vi.fn<SaveSteps['presign']>(async (asks) => ({
      ok: true,
      data: asks.map((_, index) => ({ key: key(10 + index), putUrl: `https://bucket.example/put/${index}` })),
    })),
    put: vi.fn<SaveSteps['put']>(async () => true),
    save: vi.fn<SaveSteps['save']>(async () => ({ ok: true, data: saved })),
    ...override,
  }
}

const live = { sample: false }
const puts = (steps: Steps) => steps.put.mock.calls.map(([url, file]) => [url, file.name])

describe('runSave (docs/specs/2026-10-16-mint-page-live-data.md, section 7.9)', () => {
  it('PUTs each picked file to the URL signed for it, paired by index, then saves the draft with their keys', async () => {
    const steps = stepsOf()
    const outcome = await runSave(twoFiles(), steps, live)
    expect(steps.presign.mock.calls[0]![0].map((ask) => ask.slot)).toEqual(['avatar', 'team'])
    expect(puts(steps)).toEqual([
      ['https://bucket.example/put/0', 'avatar.png'],
      ['https://bucket.example/put/1', 'mara.jpg'],
    ])
    const input = steps.save.mock.calls[0]![0]
    expect([input.media.avatar, input.sections.team.members[0]?.imageKey]).toEqual([key(10), key(11)])
    expect(outcome).toEqual({ ok: true, draft: draftOf(saved) })
  })

  it('does not PUT a file the bucket already holds, and still saves its key', async () => {
    const steps = stepsOf({
      presign: vi.fn<SaveSteps['presign']>(async () => ({
        ok: true,
        data: [
          { key: key(10), putUrl: null },
          { key: key(11), putUrl: 'https://bucket.example/put/1' },
        ],
      })),
    })
    await runSave(twoFiles(), steps, live)
    expect(puts(steps)).toEqual([['https://bucket.example/put/1', 'mara.jpg']])
    expect(steps.save.mock.calls[0]![0].media.avatar).toBe(key(10))
  })

  it('never reaches the save when a PUT fails or throws', async () => {
    for (const put of [
      vi.fn<SaveSteps['put']>(async () => false),
      vi.fn<SaveSteps['put']>(() => Promise.reject(new TypeError('Failed to fetch'))),
    ]) {
      const steps = stepsOf({ put })
      expect(await runSave(twoFiles(), steps, live)).toEqual({ ok: false, error: PAGE_UPLOAD_FAILED })
      expect(put).toHaveBeenCalledTimes(1)
      expect(steps.save).not.toHaveBeenCalled()
    }
  })

  it('stops before signing when a file cannot be hashed', async () => {
    const steps = stepsOf({
      hash: vi.fn<SaveSteps['hash']>(() =>
        Promise.reject(new DOMException('The file could not be read.', 'NotReadableError')),
      ),
    })
    expect(await runSave(twoFiles(), steps, live)).toEqual({ ok: false, error: PAGE_UPLOAD_FAILED })
    expect(steps.presign).not.toHaveBeenCalled()
    expect(steps.save).not.toHaveBeenCalled()
  })

  it('refuses signed answers it cannot pair with the files, and a refused signing, before any PUT', async () => {
    const short = stepsOf({
      presign: vi.fn<SaveSteps['presign']>(async () => ({
        ok: true,
        data: [{ key: key(10), putUrl: 'https://bucket.example/put/0' }],
      })),
    })
    expect(await runSave(twoFiles(), short, live)).toEqual({ ok: false, error: PAGE_UPLOAD_FAILED })
    const refused = stepsOf({
      presign: vi.fn<SaveSteps['presign']>(async () => ({
        ok: false,
        error: 'Use a PNG, JPG, WebP or GIF image.',
      })),
    })
    expect(await runSave(twoFiles(), refused, live)).toEqual({
      ok: false,
      error: 'Use a PNG, JPG, WebP or GIF image.',
    })
    for (const steps of [short, refused]) {
      expect(steps.put).not.toHaveBeenCalled()
      expect(steps.save).not.toHaveBeenCalled()
    }
  })

  it('answers a refused save with its error', async () => {
    const error = 'Some fields could not be saved. Check them and try again.'
    const steps = stepsOf({ save: vi.fn<SaveSteps['save']>(async () => ({ ok: false, error })) })
    expect(await runSave(twoFiles(), steps, live)).toEqual({ ok: false, error })
  })

  it('saves a draft with no picked files without hashing, signing or uploading', async () => {
    const steps = stepsOf()
    expect(await runSave(draftOf(view), steps, live)).toEqual({ ok: true, draft: draftOf(saved) })
    expect(steps.hash).not.toHaveBeenCalled()
    expect(steps.presign).not.toHaveBeenCalled()
    expect(steps.put).not.toHaveBeenCalled()
    expect(steps.save).toHaveBeenCalledTimes(1)
  })

  it('writes nothing in sample mode, and answers the draft as sent', async () => {
    const steps = stepsOf()
    const draft = twoFiles()
    const outcome = await runSave(draft, steps, { sample: true })
    expect(outcome.ok && outcome.draft).toBe(draft)
    for (const step of Object.values(steps)) expect(step).not.toHaveBeenCalled()
  })
})
