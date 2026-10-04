'use client'

import { MusicIcon } from 'lucide-react'
import { useState } from 'react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@cobweb/ui/components/accordion'
import { Badge } from '@cobweb/ui/components/badge'
import { Panel } from '@cobweb/ui/components/panel'
import { Switch } from '@cobweb/ui/components/switch'
import {
  // Seam: replaced by the mint page section tables in Phase 6.
  DEMO_MINT_PAGE_SECTIONS,
  type GeneratedToken,
  type MintPageSections as Sections,
  type TeamMember,
} from '@/lib/demo'
import { ImageSlot } from './mint-page-fields'
import { Carousel, FilePick, ItemList, LIMITS, MB, Text } from './mint-page-section-parts'

type Section = keyof Sections

/**
 * Team, Roadmap, FAQ, music and carousel: the mint page sections that return in Phase 6. The
 * form works on sample data so the fields and limits can be reviewed now; nothing is saved and the
 * public page does not show them yet.
 * Seam: Phase 6 stores each section (and its on/off switch) with the mint page settings and uploads
 * files to storage on save.
 */
export function MintPageSections({ candidates }: { candidates: GeneratedToken[] }) {
  const [value, setValue] = useState<Sections>(DEMO_MINT_PAGE_SECTIONS)
  const set = <K extends Section>(key: K, next: Partial<Sections[K]>) =>
    setValue((current) => ({ ...current, [key]: { ...current[key], ...next } }))
  const toggle = (key: Section) => (
    <Switch
      checked={value[key].enabled}
      onCheckedChange={(enabled) => set(key, { enabled })}
      aria-label={`Show ${key} on the mint page`}
    />
  )

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          More sections <Badge variant="outline">Phase 6</Badge>
        </span>
      }
      description="Team, roadmap, FAQ, music and a carousel, as on the old mint pages. Preview only: these are not saved and not shown on the page until Phase 6."
      bodyClassName="p-0"
    >
      <Accordion type="multiple" className="px-5 lg:px-6">
        <Block id="team" title="Team" count={value.team.members.length} toggle={toggle('team')}>
          <ItemList
            items={value.team.members}
            onChange={(members) => set('team', { members })}
            addLabel="Add a member"
            create={(): TeamMember => ({
              id: `team-${Date.now()}`,
              name: '',
              role: '',
              bio: '',
              imageUrl: '',
            })}
            render={(member, update) => (
              <div className="grid gap-4">
                <ImageSlot
                  label="Photo"
                  hint="Square. PNG, JPG or GIF, up to 20 MB."
                  value={member.imageUrl}
                  onChange={(imageUrl) => update({ imageUrl })}
                  seed={member.id}
                  shape="square"
                  maxBytes={LIMITS.mb * MB}
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

        <Block id="music" title="Music" count={value.music.fileName ? 1 : 0} toggle={toggle('music')}>
          <FilePick
            label={value.music.fileName ?? 'No track'}
            accept="audio/mpeg,.mp3"
            hint="One MP3, up to 20 MB. It plays with the collection's avatar as its cover."
            check={(file) =>
              file.type === 'audio/mpeg' || /\.mp3$/i.test(file.name) ? null : 'Use an MP3 file.'
            }
            onFile={(file, url) => set('music', { fileName: file.name, url })}
            onRemove={value.music.fileName ? () => set('music', { fileName: null, url: null }) : undefined}
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
            candidates={candidates}
            onChange={(items) => set('carousel', { items })}
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
