'use client'

import { Button } from '@cobweb/ui/components/button'
import { Input } from '@cobweb/ui/components/input'
import { Label } from '@cobweb/ui/components/label'
import { Textarea } from '@cobweb/ui/components/textarea'
import { tokenNameProblem } from '../state/generation'
import type { Generator } from './use-generator'

/**
 * The token name and description, as the legacy auto-populate asked for them. Every token is
 * named "<token name> #<id>"; the description goes into every token's metadata (one token's can
 * be changed in its detail panel). They start as the project's name and description.
 */
export function TokenNaming({ generator, readOnly }: { generator: Generator; readOnly: boolean }) {
  const { tokenName, tokenDescription, tokens } = generator
  const nameError = tokenNameProblem(tokenName)
  const sample = `${tokenName.trim() || 'Token'} #1`
  const differing = (tokens ?? []).filter(
    (token) => (token.description ?? tokenDescription).trim() !== tokenDescription.trim(),
  ).length

  if (readOnly)
    return (
      <dl className="grid gap-3 text-sm sm:grid-cols-[14rem_minmax(0,1fr)]">
        <div>
          <dt className="text-muted-foreground text-xs">Token name</dt>
          <dd className="font-medium">{sample}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground text-xs">Description</dt>
          <dd className="line-clamp-2">{tokenDescription}</dd>
        </div>
      </dl>
    )

  return (
    <div className="grid gap-4 sm:grid-cols-[14rem_minmax(0,1fr)]">
      <div className="space-y-1.5">
        <Label htmlFor="token-name">Token name</Label>
        <Input
          id="token-name"
          value={tokenName}
          onChange={(event) => generator.setTokenName(event.target.value)}
          aria-invalid={!!nameError}
          aria-describedby="token-name-help"
          className="h-9"
        />
        <p
          id="token-name-help"
          className={nameError ? 'text-destructive-foreground text-xs' : 'text-muted-foreground text-xs'}
        >
          {nameError ?? (
            <>
              Tokens read <span className="text-foreground">{sample}</span>, and so on.
            </>
          )}
        </p>
      </div>
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor="token-description">Token description</Label>
        <Textarea
          id="token-description"
          rows={2}
          value={tokenDescription}
          onChange={(event) => generator.setTokenDescription(event.target.value)}
          aria-describedby="token-description-help"
          className="min-h-9"
          maxLength={500}
        />
        <p id="token-description-help" className="text-muted-foreground text-xs">
          Optional. In every token’s metadata; you can change one token’s description in its detail panel.{' '}
          <span className="numeric">{tokenDescription.length}/500</span>
        </p>
        {differing > 0 && (
          <Button variant="link" size="sm" className="h-auto p-0" onClick={generator.describeAll}>
            Use it for the {differing.toLocaleString('en-US')} generated{' '}
            {differing === 1 ? 'token that has' : 'tokens that have'} another description
          </Button>
        )}
      </div>
    </div>
  )
}
