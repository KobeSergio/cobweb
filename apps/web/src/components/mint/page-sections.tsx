import { AtSignIcon, MessageCircleIcon, SendIcon } from 'lucide-react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@cobweb/ui/components/accordion'
import { Artwork } from '@cobweb/ui/components/artwork'
import { Button } from '@cobweb/ui/components/button'
import type { MintPageStatic, PageMember } from '@/lib/mint/page-doc'

/**
 * The page's own sections (docs/specs/2026-10-16-mint-page-live-data.md, section 7.8), after About and Details,
 * in this order and each only when it is on and has content: Roadmap, Team and FAQ. Text is plain and keeps its
 * line breaks; links are https and open in a new tab.
 */
export function PageSections({ page }: { page: MintPageStatic }) {
  const { roadmap, team, faq } = page.sections
  if (!roadmap && !team && !faq) return null
  return (
    <div className="mx-auto mt-20 grid max-w-[90rem] gap-20 px-4 sm:px-8 lg:mt-28">
      {roadmap && <Roadmap items={roadmap} />}
      {team && <Team members={team} name={page.name} />}
      {faq && <Faq items={faq} />}
    </div>
  )
}

function Roadmap({ items }: { items: NonNullable<MintPageStatic['sections']['roadmap']> }) {
  return (
    <section aria-labelledby="roadmap-title">
      <h2 id="roadmap-title" className="text-title">
        Roadmap
      </h2>
      <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li key={item.id} className="rounded-xl border bg-card p-5 shadow-raised">
            <p className="numeric text-[0.8125rem] text-muted-foreground">{item.date}</p>
            <p className="mt-1 text-base font-semibold">{item.title}</p>
            {item.description && (
              <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-foreground/85">
                {item.description}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

const MEMBER_LINKS = [
  { key: 'x', label: 'X', Icon: AtSignIcon },
  { key: 'discord', label: 'Discord', Icon: MessageCircleIcon },
  { key: 'telegram', label: 'Telegram', Icon: SendIcon },
] as const

function Team({ members, name }: { members: PageMember[]; name: string }) {
  return (
    <section aria-labelledby="team-title">
      <h2 id="team-title" className="text-title">
        Team
      </h2>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {members.map((member) => (
          <li key={member.id} className="rounded-xl border bg-card p-5 shadow-raised">
            <Artwork
              src={member.imageUrl}
              alt={member.name}
              seed={`${name}-${member.id}`}
              className="size-20 rounded-xl border"
            />
            <p className="mt-4 text-base font-semibold">{member.name}</p>
            <p className="text-[0.8125rem] text-muted-foreground">{member.role}</p>
            {member.bio && (
              <p className="mt-3 text-sm leading-relaxed whitespace-pre-line text-foreground/85">
                {member.bio}
              </p>
            )}
            <div className="mt-3 flex gap-1">
              {MEMBER_LINKS.filter(({ key }) => member[key]?.startsWith('https://')).map(
                ({ key, label, Icon }) => (
                  <Button key={key} asChild variant="ghost" size="icon-sm">
                    <a
                      href={member[key]}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`${member.name} on ${label}`}
                    >
                      <Icon />
                    </a>
                  </Button>
                ),
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Faq({ items }: { items: NonNullable<MintPageStatic['sections']['faq']> }) {
  return (
    <section aria-labelledby="faq-title" className="max-w-3xl">
      <h2 id="faq-title" className="text-title">
        Questions
      </h2>
      <Accordion type="single" collapsible className="mt-4">
        {items.map((item) => (
          <AccordionItem key={item.id} value={item.id}>
            <AccordionTrigger>{item.question}</AccordionTrigger>
            <AccordionContent className="text-sm leading-relaxed whitespace-pre-line text-foreground/85">
              {item.answer}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  )
}
