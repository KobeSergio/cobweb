import { describe, expect, it } from 'vitest'
import type { MintPageSettingsView } from '@/lib/mint/settings-core'
import {
  draftInvalid,
  draftOf,
  inputOf,
  mediaAskOf,
  pickedFiles,
  socialError,
  type DraftFile,
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
    })
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
})

describe('socialError', () => {
  it('takes an empty link, https on the named hosts with a path, and refuses the rest', () => {
    expect(socialError('', ['x.com'])).toBeNull()
    expect(socialError('https://x.com/owls', ['x.com', 'twitter.com'])).toBeNull()
    expect(socialError('https://www.twitter.com/owls', ['x.com', 'twitter.com'])).toBeNull()
    expect(socialError('http://x.com/owls', ['x.com'])).toBe('Use a link that starts with https://.')
    expect(socialError('https://example.com/owls', ['x.com'])).toBe('Use a x.com link.')
    expect(socialError('https://x.com/', ['x.com'])).toBe('Use a x.com link with its path.')
    expect(socialError(`https://example.com/${'a'.repeat(190)}`, [])).toBe(
      'Use a link of at most 200 characters.',
    )
    expect(socialError('owls', [])).toBe('Enter a full link, starting with https://.')
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
})
