'use client'

import { CopyIcon, FileJsonIcon, ImageIcon, LayersIcon, PlusIcon } from 'lucide-react'
import { useActionState, useState } from 'react'
import { Button } from '@cobweb/ui/components/button'
import { ChoiceCard, ChoiceCards } from '@cobweb/ui/components/choice-cards'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@cobweb/ui/components/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import { Spinner } from '@cobweb/ui/components/spinner'
import { createCollection, type CreateCollectionState } from '@/app/actions/collections'
import { MAX_SUPPLY, PROJECT_TYPES, SINGLE_ASSET_MAX_SUPPLY, type ProjectType } from '@/lib/collections'

const INITIAL_STATE: CreateCollectionState = {}

const TYPE_ICONS: Record<ProjectType, React.ReactNode> = {
  generative: <LayersIcon />,
  one_of_one: <ImageIcon />,
  metadata: <FileJsonIcon />,
  single_asset: <CopyIcon />,
}

/** The first step of the flow: name the collection and choose what kind it is. */
export function CreateCollectionDialog({ variant = 'default' }: { variant?: 'default' | 'empty' }) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(createCollection, INITIAL_STATE)

  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [projectType, setProjectType] = useState<ProjectType>('generative')
  const [maxSupply, setMaxSupply] = useState('')

  const errors = state.fieldErrors ?? {}
  const supplyLimit = projectType === 'single_asset' ? SINGLE_ASSET_MAX_SUPPLY : MAX_SUPPLY

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size={variant === 'empty' ? 'lg' : 'default'}>
          <PlusIcon />
          New collection
        </Button>
      </DialogTrigger>
      <DialogContent className="gap-7 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New collection</DialogTitle>
          <DialogDescription>
            You can change the name and symbol until you deploy, and the supply until the art is locked. You
            reserve the mint page address when you deploy.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-7">
          <FieldGroup className="gap-6">
            <div className="grid grid-cols-[1fr_9rem] gap-4">
              <Field data-invalid={!!errors.name}>
                <FieldLabel htmlFor="collection-name">Name</FieldLabel>
                <Input
                  id="collection-name"
                  name="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={64}
                  autoComplete="off"
                  aria-invalid={!!errors.name}
                  aria-describedby={errors.name ? 'collection-name-error' : undefined}
                  required
                />
                <FieldError id="collection-name-error">{errors.name}</FieldError>
              </Field>
              <Field data-invalid={!!errors.symbol}>
                <FieldLabel htmlFor="collection-symbol">Symbol</FieldLabel>
                <Input
                  id="collection-symbol"
                  name="symbol"
                  value={symbol}
                  onChange={(event) => setSymbol(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  maxLength={12}
                  autoComplete="off"
                  className="numeric tracking-wide"
                  aria-invalid={!!errors.symbol}
                  aria-describedby={errors.symbol ? 'collection-symbol-error' : undefined}
                  required
                />
                <FieldError id="collection-symbol-error">{errors.symbol}</FieldError>
              </Field>
            </div>

            <Field data-invalid={!!errors.projectType}>
              <FieldLabel id="collection-type-label">Type</FieldLabel>
              <ChoiceCards
                name="projectType"
                value={projectType}
                onValueChange={(value) => setProjectType(value as ProjectType)}
                aria-labelledby="collection-type-label"
                className="grid-cols-2 gap-3"
              >
                {PROJECT_TYPES.map((type) => (
                  <ChoiceCard
                    key={type.value}
                    value={type.value}
                    title={type.name}
                    description={type.description}
                    icon={TYPE_ICONS[type.value]}
                  />
                ))}
              </ChoiceCards>
              <FieldError>{errors.projectType}</FieldError>
            </Field>

            <div className="w-44">
              <Field data-invalid={!!errors.maxSupply}>
                <FieldLabel htmlFor="collection-supply">Supply</FieldLabel>
                <Input
                  id="collection-supply"
                  name="maxSupply"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={supplyLimit}
                  value={maxSupply}
                  onChange={(event) => setMaxSupply(event.target.value)}
                  aria-invalid={!!errors.maxSupply}
                  aria-describedby={errors.maxSupply ? 'collection-supply-error' : 'collection-supply-help'}
                  required
                />
                {errors.maxSupply ? (
                  <FieldError id="collection-supply-error">{errors.maxSupply}</FieldError>
                ) : (
                  <FieldDescription id="collection-supply-help">
                    Up to {supplyLimit.toLocaleString('en-US')}.
                  </FieldDescription>
                )}
              </Field>
            </div>
          </FieldGroup>

          {state.formError && (
            <p
              role="alert"
              className="rounded-md bg-destructive-soft px-3.5 py-2.5 text-sm text-destructive-foreground"
            >
              {state.formError}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Create collection
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
