'use client'

import { ArrowUpRightIcon, CheckIcon, EyeIcon } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { Button } from '@cobweb/ui/components/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import { Panel } from '@cobweb/ui/components/panel'
import { Spinner } from '@cobweb/ui/components/spinner'
import { Switch } from '@cobweb/ui/components/switch'
import { Textarea } from '@cobweb/ui/components/textarea'
import { presignMintPageMedia, saveMintPage } from '@/app/actions/mint-page'
import { sha256Hex } from '@/components/art/uploads/hash'
import { MintPageAddressField } from '@/components/collections/mint-page-address-field'
import { sampleTokenArt } from '@/components/mint/sample-source'
import { useTokenArt } from '@/components/mint/use-token-art'
import type { Tables } from '@/lib/database.types'
import type { Socials } from '@/lib/demo'
import type { MintPageSettingsView } from '@/lib/mint/settings-core'
import { tokenArtOf } from '@/lib/mint/token-art'
import { CopyButton } from './bits'
import { saveOffChain } from './manage-sim'
import {
  draftInvalid,
  draftOf,
  pickedUrls,
  SOCIAL_FIELDS,
  socialError,
  type MintPageDraft,
} from './mint-page-draft'
import { ImageSlot, MAX_FEATURED, PICKER_TOKENS, TokenPicker } from './mint-page-fields'
import { MintPagePreview, type PreviewData } from './mint-page-preview'
import { runSave, type SaveSteps } from './mint-page-save'
import { MintPageSections } from './mint-page-sections'

export type MintPageScreenProps = {
  collection: Tables<'collections'>
  /** The row with its media, sections and the art the tab features from (the sample's in sample mode). */
  view: MintPageSettingsView
  /** What the miniature draws besides the draft. */
  preview: PreviewData
  /** The IPFS gateway token thumbnails are read through. */
  gateway: string
  /** Sample mode: files stay browser URLs and Save waits instead of writing. */
  sample: boolean
}

const noopSubscribe = () => () => {}

/** A save's steps on live data: the browser's hash, the signing and saving actions, and a PUT bound to the file's type. */
function liveSteps(collectionId: string): SaveSteps {
  return {
    hash: (file) => sha256Hex(file),
    presign: (asks) => presignMintPageMedia(collectionId, asks),
    put: async (url, file) =>
      (await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })).ok,
    save: (input) => saveMintPage(collectionId, input),
  }
}

/**
 * Manage drop, mint page (docs/specs/2026-10-16-mint-page-live-data.md, section 7.9): the link, the public switch,
 * the description, the banner, avatar and About banner, the links, featured tokens and the sections, in one draft
 * that Save uploads and writes, its fields disabled until the save answers, beside a miniature of the page. Preview
 * opens the owner's view of the page.
 */
export function MintPageScreen({ collection, view, preview, gateway, sample }: MintPageScreenProps) {
  const id = useId()
  // The link is set here when the collection has none, or changed after a warning.
  const [slug, setSlug] = useState(collection.slug)
  const [changing, setChanging] = useState(false)
  const mintPageHref = slug ? `/${slug}` : null
  const initial = useMemo(() => draftOf(view), [view])
  const [saved, setSaved] = useState<MintPageDraft>(initial)
  const [draft, setDraft] = useState<MintPageDraft>(initial)
  const [saving, setSaving] = useState(false)
  const origin = useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => '',
  )
  const publicUrl = `${origin}${mintPageHref ?? ''}`
  // Shown as cobweb.app/<link>, as on Deploy and the Overview; copy and open use the real origin.
  const displayUrl = `cobweb.app/${slug ?? 'your-link'}`

  // A picked file's object URL lives while the draft or the saved draft shows it; the rest go when the tab closes.
  const objectUrls = useRef(new Set<string>())
  useEffect(() => {
    const shown = new Set([...pickedUrls(draft), ...pickedUrls(saved)])
    for (const url of shown) objectUrls.current.add(url)
    for (const url of objectUrls.current) {
      if (shown.has(url)) continue
      URL.revokeObjectURL(url)
      objectUrls.current.delete(url)
    }
  }, [draft, saved])
  useEffect(() => {
    const urls = objectUrls.current
    return () => {
      for (const url of urls) URL.revokeObjectURL(url)
      urls.clear()
    }
  }, [])

  const { realBaseUri, supply, projectType } = view.art
  const artSource = useMemo(
    () => ({
      tokenArt: sample
        ? sampleTokenArt
        : (base: string, tokenId: number) => tokenArtOf(base, tokenId, gateway),
    }),
    [sample, gateway],
  )
  const pickerIds = useMemo(
    () => Array.from({ length: Math.min(PICKER_TOKENS, supply) }, (_, index) => index + 1),
    [supply],
  )
  const tokenSlides = draft.sections.carousel.items.flatMap((item) =>
    item.kind === 'token' ? [item.tokenId] : [],
  )
  const artIds = [...new Set([...pickerIds, ...draft.featuredTokenIds, ...tokenSlides])]
  // A single asset features no tokens, so the tab reads no token's metadata.
  const art = useTokenArt(artSource, realBaseUri, realBaseUri && projectType !== 'single_asset' ? artIds : [])

  const errors = Object.fromEntries(
    SOCIAL_FIELDS.map((social) => [social.key, socialError(draft.socials[social.key], social.key)]),
  ) as Record<keyof Socials, string | null>
  const invalid = draftInvalid(draft)
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const set = <K extends keyof MintPageDraft>(key: K, value: MintPageDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))
  const setMedia = (slot: keyof MintPageDraft['media'], value: MintPageDraft['media'][typeof slot]) =>
    setDraft((current) => ({ ...current, media: { ...current.media, [slot]: value } }))

  /** Uploads the picked files, then writes the whole draft (runSave); sample mode waits and writes nothing. */
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (invalid || !dirty || saving) return
    const sent = draft
    setSaving(true)
    try {
      if (sample) await saveOffChain()
      const outcome = await runSave(sent, liveSteps(collection.id), { sample })
      if (!outcome.ok) {
        toast.error(outcome.error)
        return
      }
      setSaved(outcome.draft)
      // The fieldset keeps the draft as sent while the save runs; one changed anyway keeps its changes, unsaved.
      setDraft((current) => (current === sent ? outcome.draft : current))
      toast.success('Mint page saved')
    } catch {
      toast.error('The mint page could not be saved. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={save}
      aria-busy={saving}
      className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]"
    >
      {/* Nothing in the draft can change while a save runs: the fieldset disables every control inside it. */}
      <fieldset disabled={saving} className="contents">
        <div className="grid gap-6">
          <Panel title="Mint page link" bodyClassName="grid gap-4 p-5 lg:p-6">
            {mintPageHref && !changing ? (
              <div className="bg-well shadow-inset flex min-w-0 flex-wrap items-center gap-2 rounded-md border py-1.5 pr-1.5 pl-3">
                <span className="numeric min-w-0 flex-1 truncate text-sm">{displayUrl}</span>
                <CopyButton value={publicUrl} label="Copy link" size="icon-sm" />
                <Button variant="ghost" size="sm" asChild>
                  <a href={`${mintPageHref}/preview`} target="_blank" rel="noreferrer">
                    <EyeIcon aria-hidden="true" />
                    Preview
                  </a>
                </Button>
                {saved.published && (
                  <Button variant="ghost" size="sm" asChild>
                    <a href={mintPageHref} target="_blank" rel="noreferrer">
                      Open mint page
                      <ArrowUpRightIcon aria-hidden="true" />
                    </a>
                  </Button>
                )}
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
                      ? 'Anyone with the link can see it and mint. Saved with the page.'
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
                  characters. Shown in About on the page.
                </FieldDescription>
              </Field>
              <ImageSlot
                label="Banner"
                hint="3 to 1, such as 1500 by 500. PNG, JPG, WebP or GIF, up to 5 MB."
                value={draft.media.banner}
                onChange={(value) => setMedia('banner', value)}
                seed={`${collection.id}-banner`}
                slot="banner"
                shape="banner"
              />
              <ImageSlot
                label="Avatar"
                hint="Square, at least 400 by 400. PNG, JPG, WebP or GIF, up to 2 MB."
                value={draft.media.avatar}
                onChange={(value) => setMedia('avatar', value)}
                seed={`${collection.id}-avatar`}
                slot="avatar"
                shape="square"
              />
              <ImageSlot
                label="About banner"
                hint="Shown above About; the banner stands in without one. 3 to 1, up to 5 MB."
                value={draft.media.about}
                onChange={(value) => setMedia('about', value)}
                seed={`${collection.id}-about`}
                slot="about"
                shape="banner"
              />
            </FieldGroup>
          </Panel>

          <Panel
            title="Links"
            description="Each link you add shows as a button in About."
            bodyClassName="grid gap-5 p-5 lg:p-6"
          >
            {SOCIAL_FIELDS.map((social) => (
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
            description="Shown in the art stage and in From the collection once the collection is revealed."
            bodyClassName="p-5 lg:p-6"
          >
            <TokenPicker
              art={art}
              ids={pickerIds}
              value={draft.featuredTokenIds}
              onChange={(ids) => set('featuredTokenIds', ids)}
              max={MAX_FEATURED}
              realBaseUri={realBaseUri}
              supply={supply}
              projectType={projectType}
            />
          </Panel>

          <MintPageSections
            value={draft.sections}
            onChange={(sections) => set('sections', sections)}
            art={art}
            ids={pickerIds}
            realBaseUri={realBaseUri}
            supply={supply}
            projectType={projectType}
          />
        </div>
      </fieldset>

      <aside aria-label="Preview" className="grid gap-4 lg:sticky lg:top-6">
        <MintPagePreview
          data={preview}
          url={displayUrl}
          overrides={{
            description: draft.description,
            bannerUrl: draft.media.banner?.url ?? null,
            avatarUrl: draft.media.avatar?.url ?? null,
            socials: Object.fromEntries(
              Object.entries(draft.socials).filter(([key, value]) => value && !errors[key as keyof Socials]),
            ),
            featured: draft.featuredTokenIds.map((tokenId) => ({ id: tokenId, art: art.get(tokenId) })),
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
