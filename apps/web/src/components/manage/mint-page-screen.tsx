'use client'

import { ArrowUpRightIcon, CheckIcon } from 'lucide-react'
import { useId, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { Button } from '@cobweb/ui/components/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import { Panel } from '@cobweb/ui/components/panel'
import { Spinner } from '@cobweb/ui/components/spinner'
import { Switch } from '@cobweb/ui/components/switch'
import { Textarea } from '@cobweb/ui/components/textarea'
import { MintPageAddressField } from '@/components/collections/mint-page-address-field'
import type { Tables } from '@/lib/database.types'
import type { GeneratedToken, MintPageData, MintPageSettings, Socials } from '@/lib/demo'
import { CopyButton } from './bits'
import { FeaturedPicker, ImageSlot } from './mint-page-fields'
import { MintPagePreview } from './mint-page-preview'
import { saveOffChain } from './simulate'

export type MintPageScreenProps = {
  collection: Tables<'collections'>
  settings: MintPageSettings
  /** Tokens with a preview image, to choose featured tokens from. */
  featuredCandidates: GeneratedToken[]
  /** What the public page would render now, for a live preview. */
  preview: MintPageData
}

type Draft = Pick<
  MintPageSettings,
  'description' | 'bannerUrl' | 'avatarUrl' | 'socials' | 'featuredTokenIds' | 'published'
>

const SOCIALS: { key: keyof Socials; label: string; placeholder: string; hosts: string[] }[] = [
  { key: 'website', label: 'Website', placeholder: 'https://', hosts: [] },
  { key: 'x', label: 'X', placeholder: 'https://x.com/yourname', hosts: ['x.com', 'twitter.com'] },
  {
    key: 'discord',
    label: 'Discord invite',
    placeholder: 'https://discord.gg/invite',
    hosts: ['discord.gg', 'discord.com'],
  },
]

/** Why a social link is not usable, or null. Empty is fine: the icon is left off the page. */
function socialError(value: string | undefined, hosts: string[]): string | null {
  if (!value?.trim()) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:') return 'Use a link that starts with https://.'
    const host = url.hostname.replace(/^www\./, '')
    if (hosts.length > 0 && !hosts.includes(host)) return `Use a ${hosts[0]} link.`
    return null
  } catch {
    return 'Enter a full link, starting with https://.'
  }
}

const noopSubscribe = () => () => {}

/** Manage drop, mint page: description, banner, avatar, socials, featured tokens, preview and the link to share. */
export function MintPageScreen({ collection, settings, featuredCandidates, preview }: MintPageScreenProps) {
  const id = useId()
  // The link is set here when the collection has none, or changed after a warning.
  const [slug, setSlug] = useState(collection.slug)
  const [changing, setChanging] = useState(false)
  const mintPageHref = slug ? `/${slug}` : null
  const initial: Draft = {
    description: settings.description,
    bannerUrl: settings.bannerUrl,
    avatarUrl: settings.avatarUrl,
    socials: settings.socials,
    featuredTokenIds: settings.featuredTokenIds,
    published: settings.published,
  }
  const [saved, setSaved] = useState<Draft>(initial)
  const [draft, setDraft] = useState<Draft>(initial)
  const [saving, setSaving] = useState(false)
  const origin = useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => '',
  )
  const publicUrl = `${origin}${mintPageHref ?? ''}`
  // Shown as cobweb.app/<link>, as on Deploy and the Overview; copy and open use the real origin.
  const displayUrl = `cobweb.app/${slug ?? 'your-link'}`

  const errors = Object.fromEntries(
    SOCIALS.map((social) => [social.key, socialError(draft.socials[social.key], social.hosts)]),
  ) as Record<keyof Socials, string | null>
  const invalid = Object.values(errors).some(Boolean) || draft.description.length > 2000
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (invalid || !dirty) return
    setSaving(true)
    try {
      await saveOffChain()
      setSaved(draft)
      toast.success('Mint page saved')
    } catch {
      toast.error('The mint page could not be saved. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  const featured = draft.featuredTokenIds
    .map((tokenId) => featuredCandidates.find((token) => token.id === tokenId))
    .filter((token): token is GeneratedToken => !!token)
    .map((token) => ({ id: token.id, name: token.name, imageUrl: token.previewUrl ?? '' }))

  return (
    <form onSubmit={save} className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
      <div className="grid gap-6">
        <Panel title="Mint page link" bodyClassName="grid gap-4 p-5 lg:p-6">
          {mintPageHref && !changing ? (
            <div className="bg-well shadow-inset flex min-w-0 items-center gap-2 rounded-md border py-1.5 pr-1.5 pl-3">
              <span className="numeric min-w-0 flex-1 truncate text-sm">{displayUrl}</span>
              <CopyButton value={publicUrl} label="Copy link" size="icon-sm" />
              <Button variant="ghost" size="sm" asChild>
                <a href={mintPageHref} target="_blank" rel="noreferrer">
                  Open mint page
                  <ArrowUpRightIcon aria-hidden="true" />
                </a>
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setChanging(true)}>
                Change link
              </Button>
            </div>
          ) : (
            <MintPageAddressField
              key={slug ?? 'none'}
              collection={{ ...collection, slug }}
              changing={changing}
              onCancel={() => setChanging(false)}
              onSaved={(value) => {
                setSlug(value.slug)
                setChanging(false)
              }}
            />
          )}
          <Field orientation="horizontal" data-disabled={!mintPageHref}>
            <Switch
              id={`${id}-published`}
              checked={!!mintPageHref && draft.published}
              onCheckedChange={(value) => set('published', value)}
              disabled={!mintPageHref}
              aria-describedby={`${id}-published-help`}
            />
            <div className="grid gap-0.5">
              <FieldLabel htmlFor={`${id}-published`}>Page is public</FieldLabel>
              <FieldDescription id={`${id}-published-help`}>
                {!mintPageHref
                  ? 'Set a link first. The page can go public once it has one.'
                  : draft.published
                    ? 'Anyone with the link can see it and mint.'
                    : 'Hidden. Visitors see that the page is not available.'}
              </FieldDescription>
            </div>
          </Field>
        </Panel>

        <Panel title="About" bodyClassName="p-5 lg:p-6">
          <FieldGroup className="gap-6">
            <Field data-invalid={draft.description.length > 2000}>
              <FieldLabel htmlFor={`${id}-description`}>Description</FieldLabel>
              <Textarea
                id={`${id}-description`}
                value={draft.description}
                onChange={(event) => set('description', event.target.value)}
                rows={5}
                aria-describedby={`${id}-description-help`}
              />
              <FieldDescription id={`${id}-description-help`}>
                <span className="numeric">{draft.description.length.toLocaleString('en-US')}</span> of 2,000
                characters. The first lines show above the mint button.
              </FieldDescription>
            </Field>
            <ImageSlot
              label="Banner"
              hint="3 to 1, such as 1500 by 500. Up to 5 MB."
              value={draft.bannerUrl}
              onChange={(url) => set('bannerUrl', url)}
              seed={`${collection.id}-banner`}
              shape="banner"
              maxBytes={5 * 1_048_576}
            />
            <ImageSlot
              label="Avatar"
              hint="Square, at least 400 by 400. Up to 2 MB."
              value={draft.avatarUrl}
              onChange={(url) => set('avatarUrl', url)}
              seed={`${collection.id}-avatar`}
              shape="square"
              maxBytes={2 * 1_048_576}
            />
          </FieldGroup>
        </Panel>

        <Panel
          title="Links"
          description="Each link you add shows as an icon on the page."
          bodyClassName="grid gap-5 p-5 lg:p-6"
        >
          {SOCIALS.map((social) => (
            <Field key={social.key} data-invalid={!!errors[social.key]}>
              <FieldLabel htmlFor={`${id}-${social.key}`}>{social.label}</FieldLabel>
              <Input
                id={`${id}-${social.key}`}
                type="url"
                inputMode="url"
                value={draft.socials[social.key] ?? ''}
                placeholder={social.placeholder}
                onChange={(event) => set('socials', { ...draft.socials, [social.key]: event.target.value })}
                aria-invalid={!!errors[social.key]}
                aria-describedby={errors[social.key] ? `${id}-${social.key}-error` : undefined}
                autoComplete="off"
              />
              {errors[social.key] && (
                <FieldError id={`${id}-${social.key}-error`}>{errors[social.key]}</FieldError>
              )}
            </Field>
          ))}
        </Panel>

        <Panel
          title="Featured tokens"
          description="A strip of tokens under the mint panel."
          bodyClassName="p-5 lg:p-6"
        >
          <FeaturedPicker
            candidates={featuredCandidates}
            value={draft.featuredTokenIds}
            onChange={(ids) => set('featuredTokenIds', ids)}
          />
        </Panel>
      </div>

      <aside aria-label="Preview" className="grid gap-4 lg:sticky lg:top-6">
        <MintPagePreview
          data={preview}
          url={displayUrl}
          overrides={{
            description: draft.description,
            bannerUrl: draft.bannerUrl,
            avatarUrl: draft.avatarUrl,
            socials: Object.fromEntries(
              Object.entries(draft.socials).filter(([key, value]) => value && !errors[key as keyof Socials]),
            ),
            featured,
          }}
        />
        <div className="bg-card shadow-raised flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3">
          <p className="text-muted-foreground flex items-center gap-1.5 text-sm" aria-live="polite">
            {saving ? (
              'Saving'
            ) : dirty ? (
              <>
                <span aria-hidden="true" className="bg-warning size-1.5 rounded-full" />
                Unsaved changes
              </>
            ) : (
              <>
                <CheckIcon aria-hidden="true" className="text-success-foreground size-4" />
                Saved
              </>
            )}
          </p>
          <div className="flex gap-2">
            {dirty && !saving && (
              <Button type="button" variant="ghost" onClick={() => setDraft(saved)}>
                Discard
              </Button>
            )}
            <Button type="submit" disabled={!dirty || invalid || saving}>
              {saving && <Spinner />}
              Save changes
            </Button>
          </div>
        </div>
        {invalid && (
          <p className="text-destructive-foreground text-sm">Fix the highlighted fields to save.</p>
        )}
      </aside>
    </form>
  )
}
