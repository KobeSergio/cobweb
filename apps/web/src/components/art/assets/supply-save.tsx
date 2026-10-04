'use client'

import { CheckIcon, CircleAlertIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { Button } from '@cobweb/ui/components/button'
import { Spinner } from '@cobweb/ui/components/spinner'
import { setCollectionSupply } from '@/app/actions/collection-supply'

const n = (value: number) => value.toLocaleString('en-US')

/**
 * Saves the supply the uploads add up to (1/1s: files times editions; single asset: the quantity)
 * through `setCollectionSupply`. Shows what is saved and whether it still matches.
 */
export function SupplySave({
  collectionId,
  saved: initialSaved,
  supply,
  blocked,
  readOnly,
}: {
  collectionId: string
  /** `collections.max_supply` as loaded. */
  saved: number | null
  /** What the uploads add up to now. */
  supply: number
  /** Why it cannot be saved yet (uploads still running, nothing uploaded), or null. */
  blocked: string | null
  readOnly: boolean
}) {
  const [saved, setSaved] = useState(initialSaved)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const matches = saved === supply

  const save = () =>
    startTransition(async () => {
      setError(null)
      const result = await setCollectionSupply(collectionId, supply)
      if (result.ok) setSaved(result.supply)
      else setError(result.error)
    })

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p aria-live="polite" className="text-muted-foreground flex items-center gap-2 text-sm">
        {saved === null ? (
          'No supply saved yet.'
        ) : matches ? (
          <>
            <CheckIcon aria-hidden="true" className="text-success size-4 shrink-0" />
            <span>
              Supply saved: <span className="numeric text-foreground">{n(saved)}</span>
            </span>
          </>
        ) : (
          <span>
            Saved supply <span className="numeric text-foreground">{n(saved)}</span>, your art makes{' '}
            <span className="numeric text-foreground">{n(supply)}</span>.
          </span>
        )}
      </p>
      {!readOnly && (
        <div className="flex flex-col items-end gap-1.5">
          <Button
            variant="secondary"
            onClick={save}
            disabled={pending || matches || supply < 1 || blocked !== null}
          >
            {pending && <Spinner />}
            Save supply of <span className="numeric">{n(supply)}</span>
          </Button>
          {(error || (blocked && !matches)) && (
            <p
              role={error ? 'alert' : undefined}
              className={
                error
                  ? 'text-destructive-foreground flex items-center gap-1.5 text-xs'
                  : 'text-muted-foreground text-xs'
              }
            >
              {error && <CircleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />}
              {error ?? blocked}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
