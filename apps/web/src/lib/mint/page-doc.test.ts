import { describe, expect, it } from 'vitest'
import {
  emptySections,
  pageDocSchema,
  pageSectionsOf,
  pageStaticOf,
  sectionsSchema,
  type PageDoc,
  type StoredSections,
} from './page-doc'

const COLLECTION = '0a977c0b-7e53-476b-8c08-6c685315c3af'
const key = (n: number, extension = 'png') => `${COLLECTION}/${n.toString(16).padStart(64, '0')}.${extension}`
const media = (value: string) => `https://media.example/${value}`
const urls = { media, gateway: 'https://ipfs.io/ipfs' }

/** Every section on and filled, within the limits. */
const full: StoredSections = {
  team: {
    enabled: true,
    members: [
      {
        id: 'team-1',
        name: 'Mara Quill',
        role: 'Artist',
        bio: 'Draws every owl by hand.',
        imageKey: key(1),
        x: 'https://x.com/mara',
      },
      { id: 'team-2', name: 'Tobin', role: 'Community', bio: '', imageKey: null },
    ],
  },
  roadmap: { enabled: true, items: [{ id: 'road-1', date: 'Q4 2026', title: 'Mint', description: '' }] },
  faq: { enabled: true, items: [{ id: 'faq-1', question: 'How many?', answer: 'Up to three.' }] },
  music: { enabled: true, key: key(2, 'mp3'), fileName: 'theme.mp3' },
  carousel: {
    enabled: true,
    items: [
      { id: 'slide-1', kind: 'upload', key: key(3, 'mp4'), fileName: 'trailer.mp4', mediaType: 'video' },
      { id: 'slide-2', kind: 'token', tokenId: 5 },
    ],
  },
}

const doc: PageDoc = {
  slug: 'night-owls',
  name: 'Night Owls',
  symbol: 'OWLS',
  projectType: 'generative',
  chainId: 31337,
  contract: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
  description: 'Owls who keep odd hours.',
  media: { banner: key(4), avatar: null, aboutBanner: key(5, 'jpg') },
  socials: { website: 'https://example.com', x: null, discord: 'https://discord.gg/owls', telegram: null },
  featuredTokenIds: [5, 10],
  sections: full,
  phases: [
    { id: 1, name: 'Holders', description: 'For holders.', visible: true, position: 0 },
    { id: 0, name: 'Public', description: '', visible: true, position: 1 },
  ],
  placeholders: ['ipfs://bafybeiplaceholder/metadata.json'],
  published: true,
}

describe('sectionsSchema (docs/specs/2026-10-16-mint-page-live-data.md, section 4.1)', () => {
  it('takes the five sections within their limits, and the empty ones', () => {
    expect(sectionsSchema.safeParse(full).success).toBe(true)
    expect(sectionsSchema.safeParse(emptySections()).success).toBe(true)
  })

  it("refuses what is over legacy's limits", () => {
    const member = full.team.members[0]!
    const over: [string, StoredSections][] = [
      [
        '13 members',
        {
          ...full,
          team: {
            enabled: true,
            members: Array.from({ length: 13 }, (_, n) => ({ ...member, id: `m-${n}` })),
          },
        },
      ],
      [
        'a 21-character name',
        { ...full, team: { enabled: true, members: [{ ...member, name: 'n'.repeat(21) }] } },
      ],
      ['a blank role', { ...full, team: { enabled: true, members: [{ ...member, role: '  ' }] } }],
      [
        'a 501-character bio',
        { ...full, team: { enabled: true, members: [{ ...member, bio: 'b'.repeat(501) }] } },
      ],
      [
        'an http link',
        { ...full, team: { enabled: true, members: [{ ...member, x: 'http://x.com/mara' }] } },
      ],
      [
        'a 41-character link',
        {
          ...full,
          team: { enabled: true, members: [{ ...member, discord: `https://discord.gg/${'d'.repeat(22)}` }] },
        },
      ],
      [
        '13 milestones',
        {
          ...full,
          roadmap: {
            enabled: true,
            items: Array.from({ length: 13 }, (_, n) => ({
              id: `r-${n}`,
              date: 'Q1',
              title: 'T',
              description: '',
            })),
          },
        },
      ],
      [
        'a 21-character title',
        {
          ...full,
          roadmap: {
            enabled: true,
            items: [{ id: 'r', date: 'Q1', title: 't'.repeat(21), description: '' }],
          },
        },
      ],
      [
        '21 questions',
        {
          ...full,
          faq: {
            enabled: true,
            items: Array.from({ length: 21 }, (_, n) => ({ id: `f-${n}`, question: 'Q', answer: 'A' })),
          },
        },
      ],
      [
        'a 41-character question',
        { ...full, faq: { enabled: true, items: [{ id: 'f', question: 'q'.repeat(41), answer: 'A' }] } },
      ],
      [
        'an empty answer',
        { ...full, faq: { enabled: true, items: [{ id: 'f', question: 'Q', answer: '' }] } },
      ],
      ['a track without its name', { ...full, music: { enabled: true, key: key(2, 'mp3'), fileName: null } }],
      [
        'six slides',
        {
          ...full,
          carousel: {
            enabled: true,
            items: Array.from({ length: 6 }, (_, n) => ({
              id: `s-${n}`,
              kind: 'token' as const,
              tokenId: n + 1,
            })),
          },
        },
      ],
      [
        'a video slide on an image key',
        {
          ...full,
          carousel: {
            enabled: true,
            items: [{ id: 's', kind: 'upload', key: key(3), fileName: 'a.png', mediaType: 'video' }],
          },
        },
      ],
      ['token 0', { ...full, carousel: { enabled: true, items: [{ id: 's', kind: 'token', tokenId: 0 }] } }],
      [
        'an id with capitals',
        { ...full, faq: { enabled: true, items: [{ id: 'Faq', question: 'Q', answer: 'A' }] } },
      ],
      [
        'a repeated id',
        {
          ...full,
          faq: {
            enabled: true,
            items: [
              { id: 'f', question: 'Q', answer: 'A' },
              { id: 'f', question: 'R', answer: 'B' },
            ],
          },
        },
      ],
    ]
    for (const [label, value] of over) expect(sectionsSchema.safeParse(value).success, label).toBe(false)
  })
})

describe('pageSectionsOf', () => {
  it('turns keys into URLs and keeps the sections that are on and have content', () => {
    const sections = pageSectionsOf(full, media)
    expect(sections.team?.[0]).toEqual({
      id: 'team-1',
      name: 'Mara Quill',
      role: 'Artist',
      bio: 'Draws every owl by hand.',
      imageUrl: media(key(1)),
      x: 'https://x.com/mara',
    })
    expect(sections.team?.[1]?.imageUrl).toBeNull()
    expect(sections.music).toEqual({ url: media(key(2, 'mp3')), fileName: 'theme.mp3' })
    expect(sections.carousel).toEqual([
      {
        id: 'slide-1',
        kind: 'upload',
        url: media(key(3, 'mp4')),
        fileName: 'trailer.mp4',
        mediaType: 'video',
      },
      { id: 'slide-2', kind: 'token', tokenId: 5 },
    ])
    expect(sections.roadmap).toHaveLength(1)
    expect(sections.faq).toHaveLength(1)
  })

  it('leaves off a section that fails its schema, is switched off or is empty, and keeps the rest', () => {
    const sections = pageSectionsOf(
      {
        ...full,
        team: { enabled: true, members: [{ id: 'x', name: '', role: 'r', bio: '', imageKey: null }] },
        roadmap: { ...full.roadmap, enabled: false },
        faq: { enabled: true, items: [] },
      },
      media,
    )
    expect(Object.keys(sections).sort()).toEqual(['carousel', 'music'])
    expect(pageSectionsOf({}, media)).toEqual({})
    expect(pageSectionsOf('not an object', media)).toEqual({})
  })

  it('leaves off a team whose member links to javascript:, and drops a field no schema names (final fix wave M5)', () => {
    const member = full.team.members[0]!
    const scripted = pageSectionsOf(
      { ...full, team: { enabled: true, members: [{ ...member, x: 'javascript:alert(1)' }] } },
      media,
    )
    expect(scripted.team).toBeUndefined()
    expect(Object.keys(scripted).sort()).toEqual(['carousel', 'faq', 'music', 'roadmap'])
    const extra = pageSectionsOf(
      {
        ...full,
        team: { enabled: true, members: [{ ...member, html: '<img src=x onerror=alert(1)>' }] },
        faq: { ...full.faq, onclick: 'alert(1)' },
      },
      media,
    )
    expect(extra.team?.[0]).toEqual({
      id: 'team-1',
      name: 'Mara Quill',
      role: 'Artist',
      bio: 'Draws every owl by hand.',
      imageUrl: media(key(1)),
      x: 'https://x.com/mara',
    })
    expect(extra.faq).toEqual(full.faq.items)
  })

  it('leaves off a section that names a key of another shape, such as a URL (final fix wave M5)', () => {
    const sections = pageSectionsOf(
      {
        ...full,
        team: {
          enabled: true,
          members: [{ ...full.team.members[0]!, imageKey: 'https://evil.example/a.png' }],
        },
        music: { enabled: true, key: 'https://evil.example/theme.mp3', fileName: 'theme.mp3' },
        carousel: {
          enabled: true,
          items: [
            {
              id: 's',
              kind: 'upload',
              key: `${COLLECTION}/layers/a.png`,
              fileName: 'a.png',
              mediaType: 'image',
            },
          ],
        },
      },
      media,
    )
    expect(Object.keys(sections).sort()).toEqual(['faq', 'roadmap'])
  })
})

describe('pageDocSchema and pageStaticOf (section 4.3)', () => {
  it('parses the document, and refuses one without its fields', () => {
    expect(pageDocSchema.parse(JSON.parse(JSON.stringify(doc)))).toEqual(doc)
    expect(pageDocSchema.safeParse({ ...doc, contract: 'night-owls' }).success).toBe(false)
    const { phases: _phases, ...withoutPhases } = doc
    void _phases
    expect(pageDocSchema.safeParse(withoutPhases).success).toBe(false)
  })

  it('reads a link or a page key that fails its check as none, so the page leaves it off (final fix wave M5)', () => {
    const parsed = pageDocSchema.parse({
      ...doc,
      media: {
        banner: 'https://evil.example/banner.png',
        avatar: `${COLLECTION}/${'0'.repeat(64)}.svg`,
        aboutBanner: key(5, 'jpg'),
      },
      socials: {
        website: 'javascript:alert(1)',
        x: 'http://x.com/owls',
        discord: 'https://evil.example/owls',
        telegram: 'https://t.me/owls',
      },
    })
    expect(parsed.media).toEqual({ banner: null, avatar: null, aboutBanner: key(5, 'jpg') })
    expect(parsed.socials).toEqual({ website: null, x: null, discord: null, telegram: 'https://t.me/owls' })
  })

  it('builds the page: the chain, the checksummed contract, URLs for the keys, the links that are set and the rows', () => {
    const page = pageStaticOf(doc, urls)
    expect(page).toMatchObject({
      slug: 'night-owls',
      chain: { id: 31337, name: 'Anvil', nativeSymbol: 'ETH' },
      contract: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      bannerUrl: media(key(4)),
      avatarUrl: null,
      aboutBannerUrl: media(key(5, 'jpg')),
      socials: { website: 'https://example.com', discord: 'https://discord.gg/owls' },
      featuredTokenIds: [5, 10],
      placeholders: ['ipfs://bafybeiplaceholder/metadata.json'],
      gateway: 'https://ipfs.io/ipfs',
    })
    expect(Object.keys(page!.socials)).toEqual(['website', 'discord'])
    expect(page!.phases).toEqual([
      { onchain_id: 1, name: 'Holders', description: 'For holders.', visible: true, position: 0 },
      { onchain_id: 0, name: 'Public', description: '', visible: true, position: 1 },
    ])
  })

  it('answers null for a chain this build does not list', () => {
    expect(pageStaticOf({ ...doc, chainId: 999 }, urls)).toBeNull()
  })
})
