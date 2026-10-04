'use client'

import { ArrowLeftIcon, ArrowRightIcon, CopyIcon, ImageIcon, LayersIcon, PlusIcon } from 'lucide-react'
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
import { Field, FieldError, FieldGroup, FieldLabel } from '@cobweb/ui/components/field'
import { Input } from '@cobweb/ui/components/input'
import { Spinner } from '@cobweb/ui/components/spinner'
import { createCollection, type CreateCollectionState } from '@/app/actions/collections'
import { PROJECT_TYPES, type ProjectType } from '@/lib/collections'

const INITIAL_STATE: CreateCollectionState = {}

const TYPE_ICONS: Record<ProjectType, React.ReactNode> = {
  generative: <LayersIcon />,
  one_of_one: <ImageIcon />,
  single_asset: <CopyIcon />,
}

/** What happens right after creation, for each type, shown under the name step. */
const NEXT_UP: Record<ProjectType, string> = {
  generative: 'Next you upload a folder of trait layers.',
  one_of_one: 'Next you upload your finished artworks.',
  single_asset: 'Next you upload the one file and set how many tokens share it.',
}

/**
 * The first step of the flow, as in the legacy app: step 1 picks the type, step 2 names it. No
 * supply (set later from the art) and no mint page link (reserved at Deploy).
 */
export function CreateCollectionDialog({ variant = 'default' }: { variant?: 'default' | 'empty' }) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(createCollection, INITIAL_STATE)

  const [step, setStep] = useState<1 | 2>(1)
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [projectType, setProjectType] = useState<ProjectType>('generative')

  const errors = state.fieldErrors ?? {}
  const type = PROJECT_TYPES.find((entry) => entry.value === projectType)

  const changeOpen = (next: boolean) => {
    setOpen(next)
    if (!next) setStep(1)
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button size={variant === 'empty' ? 'lg' : 'default'}>
          <PlusIcon />
          New collection
        </Button>
      </DialogTrigger>
      <DialogContent className="gap-7 sm:max-w-2xl">
        <DialogHeader>
          <p className="text-muted-foreground text-xs font-medium">
            Step <span className="numeric">{step}</span> of <span className="numeric">2</span>
          </p>
          <DialogTitle>{step === 1 ? 'What kind of collection?' : 'Name your collection'}</DialogTitle>
          <DialogDescription>
            {step === 1
              ? 'The type decides how you make the art. It cannot change later.'
              : 'You can change the name and symbol until you deploy.'}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="flex flex-col gap-7">
            <Field data-invalid={!!errors.projectType}>
              <FieldLabel id="collection-type-label" className="sr-only">
                Type
              </FieldLabel>
              <ChoiceCards
                value={projectType}
                onValueChange={(value) => setProjectType(value as ProjectType)}
                aria-labelledby="collection-type-label"
                className="gap-3"
              >
                {PROJECT_TYPES.map((entry) => (
                  <ChoiceCard
                    key={entry.value}
                    value={entry.value}
                    title={entry.name}
                    description={entry.description}
                    icon={TYPE_ICONS[entry.value]}
                  />
                ))}
              </ChoiceCards>
              <FieldError>{errors.projectType}</FieldError>
            </Field>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => changeOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => setStep(2)}>
                Continue
                <ArrowRightIcon />
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form action={formAction} className="flex flex-col gap-7">
            <input type="hidden" name="projectType" value={projectType} />
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
                    autoFocus
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
                    onChange={(event) =>
                      setSymbol(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                    }
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
              <p className="bg-surface-2 text-muted-foreground flex items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-[0.8125rem]">
                <span className="text-foreground [&_svg]:size-4" aria-hidden="true">
                  {TYPE_ICONS[projectType]}
                </span>
                <span>
                  <span className="text-foreground font-medium">{type?.name}</span>. {NEXT_UP[projectType]}
                </span>
              </p>
            </FieldGroup>

            {(state.formError || errors.projectType) && (
              <p
                role="alert"
                className="bg-destructive-soft text-destructive-foreground rounded-md px-3.5 py-2.5 text-sm"
              >
                {state.formError ?? errors.projectType}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setStep(1)} disabled={pending}>
                <ArrowLeftIcon />
                Back
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Spinner />}
                Create collection
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
