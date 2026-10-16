'use client'

import { MusicIcon } from 'lucide-react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@cobweb/ui/components/accordion'
import { Panel } from '@cobweb/ui/components/panel'
import { Switch } from '@cobweb/ui/components/switch'
import type { TokenArt } from '@/lib/mint/token-art'
import { LIMITS, type DraftMember, type DraftSections } from './mint-page-draft'
import { ImageSlot } from './mint-page-fields'
import { Carousel, FilePick, ItemList, Text } from './mint-page-section-parts'

type Section = keyof DraftSections

/**
 * Team, Roadmap, FAQ, music and a carousel (docs/specs/2026-10-16-mint-page-live-data.md, section 4.1): the mint
 * page's own sections, each with its switch, saved with the rest of the draft. Files stay in the browser until
 * Save, which uploads them first.
 */
export function MintPageSections({
  value,
  onChange,
  art,
  ids,
  realBaseUri,
  supply,
  projectType,
}: {
  value: DraftSections
  onChange: (value: DraftSections) => void
  art: Map<number, TokenArt | null | undefined>
  ids: number[]
  realBaseUri: string | null
  supply: number
  projectType: 'generative' | 'one_of_one' | 'single_asset'
}) {
  const set = <K extends Section>(key: K, next: Partial<DraftSections[K]>) =>
    onChange({ ...value, [key]: { ...value[key], ...next } })
  const toggle = (key: Section) => (
    <Switch
      checked={value[key].enabled}
      onCheckedChange={(enabled) => set(key, { enabled })}
      aria-label={`Show ${key} on the mint page`}
    />
  )

  return (
    <Panel
      title="More sections"
      description="Team, roadmap, FAQ, music and a carousel. Each shows on the page when its switch is on and it has content."
      bodyClassName="p-0"
    >
      <Accordion type="multiple" className="px-5 lg:px-6">
        <Block id="team" title="Team" count={value.team.members.length} toggle={toggle('team')}>
          <ItemList
            items={value.team.members}
            onChange={(members) => set('team', { members })}
            addLabel="Add a member"
            max={LIMITS.members}
            noun="members"
            create={(): DraftMember => ({
              id: `team-${Date.now()}`,
              name: '',
              role: '',
              bio: '',
              image: null,
            })}
            render={(member, update) => (
              <div className="grid gap-4">
                <ImageSlot
                  label="Photo"
                  hint="Square. PNG, JPG, WebP or GIF, up to 2 MB."
                  value={member.image}
                  onChange={(image) => update({ image })}
                  seed={member.id}
                  slot="team"
                  shape="square"
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Text
                    label="Name"
                    value={member.name}
                    max={LIMITS.name}
                    required
                    onChange={(name) => update({ name })}
                  />
                  <Text
                    label="Role"
                    value={member.role}
                    max={LIMITS.role}
                    required
                    onChange={(role) => update({ role })}
                  />
                </div>
                <Text
                  label="About"
                  value={member.bio}
                  max={LIMITS.text}
                  multiline
                  onChange={(bio) => update({ bio })}
                />
                <div className="grid gap-4 sm:grid-cols-3">
                  <Text
                    label="X"
                    value={member.x ?? ''}
                    max={LIMITS.handle}
                    url
                    onChange={(x) => update({ x })}
                  />
                  <Text
                    label="Discord"
                    value={member.discord ?? ''}
                    max={LIMITS.handle}
                    url
                    onChange={(discord) => update({ discord })}
                  />
                  <Text
                    label="Telegram"
                    value={member.telegram ?? ''}
                    max={LIMITS.handle}
                    url
                    onChange={(telegram) => update({ telegram })}
                  />
                </div>
              </div>
            )}
          />
        </Block>

        <Block id="roadmap" title="Roadmap" count={value.roadmap.items.length} toggle={toggle('roadmap')}>
          <ItemList
            items={value.roadmap.items}
            onChange={(items) => set('roadmap', { items })}
            addLabel="Add a milestone"
            max={LIMITS.milestones}
            noun="milestones"
            create={() => ({ id: `road-${Date.now()}`, date: '', title: '', description: '' })}
            render={(item, update) => (
              <div className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
                  <Text
                    label="When"
                    value={item.date}
                    max={LIMITS.date}
                    required
                    placeholder="Q1 2027"
                    onChange={(date) => update({ date })}
                  />
                  <Text
                    label="Title"
                    value={item.title}
                    max={LIMITS.title}
                    required
                    onChange={(title) => update({ title })}
                  />
                </div>
                <Text
                  label="Description"
                  value={item.description}
                  max={LIMITS.text}
                  multiline
                  onChange={(description) => update({ description })}
                />
              </div>
            )}
          />
        </Block>

        <Block id="faq" title="FAQ" count={value.faq.items.length} toggle={toggle('faq')}>
          <ItemList
            items={value.faq.items}
            onChange={(items) => set('faq', { items })}
            addLabel="Add a question"
            max={LIMITS.questions}
            noun="questions"
            create={() => ({ id: `faq-${Date.now()}`, question: '', answer: '' })}
            render={(item, update) => (
              <div className="grid gap-4">
                <Text
                  label="Question"
                  value={item.question}
                  max={LIMITS.question}
                  required
                  onChange={(question) => update({ question })}
                />
                <Text
                  label="Answer"
                  value={item.answer}
                  max={LIMITS.text}
                  required
                  multiline
                  onChange={(answer) => update({ answer })}
                />
              </div>
            )}
          />
        </Block>

        <Block id="music" title="Music" count={value.music.track ? 1 : 0} toggle={toggle('music')}>
          <FilePick
            label={value.music.track ? (value.music.fileName ?? 'Track') : 'No track'}
            slot="music"
            hint="One MP3, up to 20 MB. It plays with the collection's avatar as its cover."
            onFile={(track, file) =>
              set('music', { track, fileName: file.name.slice(0, 100) || 'track.mp3' })
            }
            onRemove={value.music.track ? () => set('music', { track: null, fileName: null }) : undefined}
            icon={<MusicIcon aria-hidden="true" />}
          />
        </Block>

        <Block
          id="carousel"
          title="Carousel"
          count={value.carousel.items.length}
          toggle={toggle('carousel')}
          last
        >
          <Carousel
            items={value.carousel.items}
            onChange={(items) => set('carousel', { items })}
            art={art}
            ids={ids}
            realBaseUri={realBaseUri}
            supply={supply}
            projectType={projectType}
          />
        </Block>
      </Accordion>
    </Panel>
  )
}

function Block({
  id,
  title,
  count,
  toggle,
  last,
  children,
}: {
  id: string
  title: string
  count: number
  toggle: React.ReactNode
  last?: boolean
  children: React.ReactNode
}) {
  return (
    <AccordionItem value={id} className={last ? 'border-b-0' : undefined}>
      <div className="flex items-center gap-3">
        <AccordionTrigger className="flex-1">
          <span>
            {title} <span className="numeric text-muted-foreground font-normal">({count})</span>
          </span>
        </AccordionTrigger>
        {toggle}
      </div>
      <AccordionContent className="grid gap-4 pb-6">{children}</AccordionContent>
    </AccordionItem>
  )
}
