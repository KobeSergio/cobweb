import { describe, expect, it } from 'vitest'
import type { Socials } from '@/lib/demo/types'
import { PAGE_LINK_MAX, PAGE_LINK_PATTERNS } from '@/lib/mint/links'
import { sectionsSchema } from '@/lib/mint/page-doc'
import type { MintPageSettingsView } from '@/lib/mint/settings-core'
import {
  draftInvalid,
  draftOf,
  inputOf,
  LIMITS,
  mediaAskOf,
  memberLinkError,
  pickedFileProblem,
  pickedFiles,
  pickedUrls,
  socialError,
  tokenArtSource,
  type DraftFile,
  type DraftSections,
  type MintPageDraft,
} from './mint-page-draft'

const COLLECTION = '0a977c0b-7e53-476b-8c08-6c685315c3af'
const key = (n: number, extension = 'png') => `${COLLECTION}/${n.toString(16).padStart(64, '0')}.${extension}`
const url = (value: string) => `https://media.example/${value}`

const view: MintPageSettingsView = {
  published: false,
  description: 'Owls.',
  media: { banner: { key: key(1), url: url(key(1)) }, avatar: null, about: null },
  socials: { x: 'https://x.com/owls' },
  featuredTokenIds: [3],
  sections: {
    team: {
      enabled: true,
      members: [
        { id: 'team-1', name: 'Mara', role: 'Artist', bio: '', imageKey: key(2), imageUrl: url(key(2)) },
      ],
    },
    roadmap: { enabled: false, items: [] },
    faq: { enabled: false, items: [] },
    music: { enabled: true, key: key(3, 'mp3'), fileName: 'theme.mp3', url: url(key(3, 'mp3')) },
    carousel: {
      enabled: true,
      items: [
        {
          id: 'slide-1',
          kind: 'upload',
          key: key(4, 'mp4'),
          url: url(key(4, 'mp4')),
          fileName: 'a.mp4',
          mediaType: 'video',
        },
        { id: 'slide-2', kind: 'token', tokenId: 7 },
      ],
    },
  },
  art: { realBaseUri: null, supply: 10, projectType: 'generative' },
  updatedAt: '2026-10-16T07:42:17.123456+00:00',
}
const picked = (name: string, type: string): DraftFile => ({
  kind: 'picked',
  file: new File(['x'.repeat(10)], name, { type }),
  url: `blob:${name}`,
  width: 500,
  height: 500,
})

describe('the Mint page draft (docs/specs/2026-10-16-mint-page-live-data.md, section 7.9)', () => {
  it('turns a saved view into the input it was saved from, every file as its key', () => {
    const input = inputOf(draftOf(view), new Map())
    expect(input).toEqual({
      published: false,
      description: 'Owls.',
      media: { banner: key(1), avatar: null, about: null },
      socials: { website: null, x: 'https://x.com/owls', discord: null, telegram: null },
      featuredTokenIds: [3],
      sections: {
        team: {
          enabled: true,
          members: [{ id: 'team-1', name: 'Mara', role: 'Artist', bio: '', imageKey: key(2) }],
        },
        roadmap: { enabled: false, items: [] },
        faq: { enabled: false, items: [] },
        music: { enabled: true, key: key(3, 'mp3'), fileName: 'theme.mp3' },
        carousel: {
          enabled: true,
          items: [
            { id: 'slide-1', kind: 'upload', key: key(4, 'mp4'), fileName: 'a.mp4', mediaType: 'video' },
            { id: 'slide-2', kind: 'token', tokenId: 7 },
          ],
        },
      },
      updatedAt: '2026-10-16T07:42:17.123456+00:00',
    })
  })

  it("keeps the view's stamp through the draft and back to the save, null without a row (final fix wave M2)", () => {
    const draft = draftOf(view)
    expect(draft.updatedAt).toBe(view.updatedAt)
    draft.description = 'Changed.'
    expect(inputOf(draft, new Map()).updatedAt).toBe(view.updatedAt)
    expect(inputOf(draftOf({ ...view, updatedAt: null }), new Map()).updatedAt).toBeNull()
  })

  it('lists each picked file once with its slot, and keys it as its upload was named', () => {
    const avatar = picked('avatar.png', 'image/png')
    const draft = draftOf(view)
    draft.media.avatar = avatar
    draft.media.about = avatar
    draft.sections.team.members[0]!.image = picked('mara.jpg', 'image/jpeg')
    const files = pickedFiles(draft)
    expect(files.map((entry) => [entry.slot, entry.file.name])).toEqual([
      ['avatar', 'avatar.png'],
      ['team', 'mara.jpg'],
    ])
    expect(mediaAskOf(files[0]!, 'ab'.repeat(32))).toEqual({
      slot: 'avatar',
      mime: 'image/png',
      bytes: 10,
      width: 500,
      height: 500,
      contentHash: 'ab'.repeat(32),
    })
    const keys = new Map(files.map((entry, index) => [entry.file, key(10 + index)]))
    const input = inputOf(draft, keys)
    expect([input.media.avatar, input.media.about, input.sections.team.members[0]?.imageKey]).toEqual([
      key(10),
      key(10),
      key(11),
    ])
    expect(() => inputOf(draft, new Map())).toThrow()
  })

  it("leaves out empty links and a member's blank links, and the track's name with no track", () => {
    const draft = draftOf(view)
    draft.socials = { website: '  ', x: 'https://x.com/owls ' }
    draft.sections.team.members[0] = {
      ...draft.sections.team.members[0]!,
      x: ' ',
      discord: 'https://discord.gg/m',
    }
    draft.sections.music.track = null
    const input = inputOf(draft, new Map())
    expect(input.socials).toEqual({ website: null, x: 'https://x.com/owls', discord: null, telegram: null })
    expect(input.sections.team.members[0]).toEqual({
      id: 'team-1',
      name: 'Mara',
      role: 'Artist',
      bio: '',
      imageKey: key(2),
      discord: 'https://discord.gg/m',
    })
    expect(input.sections.music).toEqual({ enabled: true, key: null, fileName: null })
  })

  it("lists every picked file's object URL, which the tab keeps while a draft shows it", () => {
    const draft = draftOf(view)
    const avatar = picked('avatar.png', 'image/png')
    draft.media.avatar = avatar
    draft.media.about = avatar
    draft.sections.music.track = picked('theme.mp3', 'audio/mpeg')
    expect(pickedUrls(draft)).toEqual(['blob:avatar.png', 'blob:avatar.png', 'blob:theme.mp3'])
    expect(pickedUrls(draftOf(view))).toEqual([])
  })
})

describe('socialError', () => {
  it('takes an empty link and what the save takes, and names the fix for the rest', () => {
    expect(socialError('', 'x')).toBeNull()
    expect(socialError('https://x.com/owls', 'x')).toBeNull()
    expect(socialError('https://www.twitter.com/owls', 'x')).toBeNull()
    expect(socialError('http://x.com/owls', 'x')).toBe('Use a link that starts with https://.')
    expect(socialError('https://example.com/owls', 'x')).toBe('Use a link on x.com.')
    expect(socialError('https://example.com/owls', 'discord')).toBe('Use a link on discord.gg.')
    expect(socialError('https://example.com/owls', 'telegram')).toBe('Use a link on t.me.')
    expect(socialError('https://x.com/', 'x')).toBe('Use a link on x.com with its path.')
    expect(socialError('https://x.com/a b', 'x')).toBe('Remove the spaces from the link.')
    expect(socialError(`https://example.com/${'a'.repeat(190)}`, 'website')).toBe(
      'Use a link of at most 200 characters.',
    )
    expect(socialError('owls', 'website')).toBe('Enter a full link, starting with https://.')
  })

  it("decides by the save's own patterns, not a URL parser that lowercases the host or takes a port or a space", () => {
    const links: [keyof Socials, string, boolean][] = [
      ['x', 'https://X.com/owls', false],
      ['x', 'https://x.com:443/owls', false],
      ['x', 'https://x.com/a b', false],
      ['x', 'https://twitter.com/owls', true],
      ['discord', 'https://www.discord.com/invite/owls', true],
      ['telegram', 'https://telegram.me/owls', true],
      ['telegram', 'https://t.me/', false],
      ['website', 'https://foo', true],
      ['website', 'https://', false],
      ['website', `https://example.com/${'a'.repeat(180)}`, true],
      ['website', `https://example.com/${'a'.repeat(181)}`, false],
    ]
    for (const [key, link, takes] of links) {
      expect(PAGE_LINK_PATTERNS[key].test(link) && link.length <= PAGE_LINK_MAX, `${key}: ${link}`).toBe(
        takes,
      )
      expect(socialError(link, key) === null, `${key}: ${link}`).toBe(takes)
    }
  })
})

describe('memberLinkError', () => {
  it("flags exactly the team links the save's schema refuses", () => {
    const links: [string, boolean][] = [
      ['https://foo', true],
      ['https://x.com/mara', true],
      ['https://x.com/a b', false],
      ['http://x.com/mara', false],
      ['x.com/mara', false],
      ['https://', false],
      [`https://x.com/${'m'.repeat(26)}`, true],
      [`https://x.com/${'m'.repeat(27)}`, false],
    ]
    const sections = inputOf(draftOf(view), new Map()).sections
    const member = sections.team.members[0]!
    for (const [link, takes] of links) {
      expect(memberLinkError(link) === null, link).toBe(takes)
      const team = { enabled: true, members: [{ ...member, x: link }] }
      expect(sectionsSchema.safeParse({ ...sections, team }).success, link).toBe(takes)
    }
    expect(memberLinkError(' ')).toBeNull()
  })
})

describe('draftInvalid', () => {
  it('refuses a long description, a bad link, and a blank name or answer, and takes the saved draft', () => {
    const draft = draftOf(view)
    expect(draftInvalid(draft)).toBe(false)
    expect(draftInvalid({ ...draft, description: 'd'.repeat(2001) })).toBe(true)
    expect(draftInvalid({ ...draft, socials: { discord: 'https://example.com/x' } })).toBe(true)
    const member = draft.sections.team.members[0]!
    expect(
      draftInvalid({
        ...draft,
        sections: { ...draft.sections, team: { enabled: true, members: [{ ...member, name: ' ' }] } },
      }),
    ).toBe(true)
    expect(
      draftInvalid({
        ...draft,
        sections: { ...draft.sections, team: { enabled: true, members: [{ ...member, x: 'x.com/m' }] } },
      }),
    ).toBe(true)
    expect(
      draftInvalid({
        ...draft,
        sections: {
          ...draft.sections,
          faq: { enabled: true, items: [{ id: 'f', question: 'Q', answer: '' }] },
        },
      }),
    ).toBe(true)
  })

  it('takes each section at its count and refuses one over it, as the save does', () => {
    expect(LIMITS).toMatchObject({ members: 12, milestones: 12, questions: 20, slides: 5 })
    const draft = draftOf(view)
    const member = draft.sections.team.members[0]!
    const many = <T>(count: number, item: (index: number) => T) =>
      Array.from({ length: count }, (_, index) => item(index))
    const withSection = <K extends keyof DraftSections>(key: K, value: DraftSections[K]): MintPageDraft => ({
      ...draft,
      sections: { ...draft.sections, [key]: value },
    })
    const sized: [number, (count: number) => MintPageDraft][] = [
      [
        LIMITS.members,
        (count) =>
          withSection('team', {
            enabled: true,
            members: many(count, (index) => ({ ...member, id: `team-${index}` })),
          }),
      ],
      [
        LIMITS.milestones,
        (count) =>
          withSection('roadmap', {
            enabled: true,
            items: many(count, (index) => ({
              id: `road-${index}`,
              date: 'Q1 2027',
              title: 'Mint',
              description: '',
            })),
          }),
      ],
      [
        LIMITS.questions,
        (count) =>
          withSection('faq', {
            enabled: true,
            items: many(count, (index) => ({ id: `faq-${index}`, question: 'When?', answer: 'Soon.' })),
          }),
      ],
      [
        LIMITS.slides,
        (count) =>
          withSection('carousel', {
            enabled: true,
            items: many(count, (index) => ({
              id: `slide-${index}`,
              kind: 'token' as const,
              tokenId: index + 1,
            })),
          }),
      ],
    ]
    for (const [cap, sizedTo] of sized) {
      expect(draftInvalid(sizedTo(cap))).toBe(false)
      expect(sectionsSchema.safeParse(inputOf(sizedTo(cap), new Map()).sections).success).toBe(true)
      expect(draftInvalid(sizedTo(cap + 1))).toBe(true)
      expect(sectionsSchema.safeParse(inputOf(sizedTo(cap + 1), new Map()).sections).success).toBe(false)
    }
  })
})

describe('pickedFileProblem', () => {
  it('refuses an image the browser could not draw in every image slot, and leaves the rest to the slot rules', () => {
    const unread = (mime: string) => ({ mime, bytes: 10, width: null, height: null })
    for (const slot of ['banner', 'avatar', 'about', 'team', 'slide'] as const)
      expect(pickedFileProblem(slot, unread('image/png')), slot).toBe(
        'The image could not be read. Try another file.',
      )
    expect(pickedFileProblem('slide', unread('video/mp4'))).toBeNull()
    expect(pickedFileProblem('music', unread('audio/mpeg'))).toBeNull()
    expect(pickedFileProblem('banner', unread('image/svg+xml'))).toBe('Use a PNG, JPG, WebP or GIF image.')
    expect(pickedFileProblem('banner', { mime: 'image/png', bytes: 10, width: 1500, height: 500 })).toBeNull()
    expect(pickedFileProblem('avatar', { mime: 'image/png', bytes: 10, width: 200, height: 200 })).toBe(
      'The avatar must be at least 400 by 400.',
    )
  })
})

describe('tokenArtSource (fix wave 2 T2)', () => {
  it('draws a token from its metadata only once the real job has a base, never for a single asset', () => {
    const base = 'ipfs://bafybeiexample/'
    expect(tokenArtSource(base, 'generative')).toBe('metadata')
    expect(tokenArtSource(base, 'one_of_one')).toBe('metadata')
    // Finish the art later leaves no base: no metadata is read, so the pattern stands in for the art.
    expect(tokenArtSource(null, 'generative')).toBe('pattern')
    expect(tokenArtSource(null, 'one_of_one')).toBe('pattern')
    expect(tokenArtSource(base, 'single_asset')).toBe('pattern')
  })
})
