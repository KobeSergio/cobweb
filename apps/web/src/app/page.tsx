import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { redirect } from 'next/navigation'
import { Artwork } from '@cobweb/ui/components/artwork'
import { RiseIn } from '@cobweb/ui/components/motion'
import { cn } from '@cobweb/ui/lib/utils'
import { SignInButton } from '@/components/auth/sign-in-button'
import { Logo } from '@/components/shell/logo'
import { getSessionUser } from '@/lib/auth'
import { STEPS } from '@/lib/steps'

/** Sample token previews, if the sample art set is present. The wall falls back to empty frames. */
function sampleArt(): string[] {
  try {
    return readdirSync(join(process.cwd(), 'public/demo/tokens'))
      .filter((file) => file.endsWith('.svg') || file.endsWith('.png'))
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
      .slice(0, 12)
      .map((file) => `/demo/tokens/${file}`)
  } catch {
    return []
  }
}

/**
 * The sign-in screen. The legacy split: the invitation on the left, a panel on the right. The
 * right panel hangs sample artwork as a gallery wall and lists the four build stages of a launch,
 * closing on managing the drop.
 */
export default async function SignInPage() {
  if (await getSessionUser()) redirect('/collections')

  const art = sampleArt()
  // Four columns of three. Without art, the same wall of empty frames.
  const columns = Array.from({ length: 4 }, (_, column) =>
    Array.from({ length: 3 }, (_, row) => ({
      key: `${column}-${row}`,
      src: art[column * 3 + row] ?? null,
    })),
  )

  return (
    <main className="flex min-h-svh flex-col lg:flex-row">
      <section className="flex flex-col justify-between gap-12 p-8 sm:p-12 lg:w-[44%] lg:shrink-0 lg:p-14">
        <Logo className="text-2xl" markClassName="size-8" />

        <RiseIn className="max-w-md">
          <h1 className="text-display text-[2.75rem] leading-[1.05]">
            Launch an NFT collection without writing code
          </h1>
          <p className="mt-5 text-base leading-relaxed text-muted-foreground">
            Build the art, deploy the contract and run the mint, all from one place.
          </p>
          <div className="mt-10 max-w-xs">
            <SignInButton />
          </div>
          <p className="mt-4 max-w-xs text-[0.8125rem] leading-relaxed text-muted-foreground">
            Signing in asks your wallet to sign a message. It is free and sends no transaction.
          </p>
        </RiseIn>

        <p className="text-xs text-muted-foreground">
          Launch on Ethereum, Arbitrum, Base, Berachain, Monad and Robinhood Chain.
        </p>
      </section>

      <section
        aria-labelledby="flow-heading"
        className="relative isolate flex min-h-[40rem] flex-1 flex-col justify-end overflow-hidden border-t bg-sidebar lg:border-t-0 lg:border-l"
      >
        {/* The wall. Alternate columns hang lower, like a salon hang. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 -top-10 grid grid-cols-4 gap-4 px-8 [mask-image:linear-gradient(to_bottom,black_35%,transparent_88%)]"
        >
          {columns.map((column, index) => (
            <div key={index} className={cn('flex flex-col gap-4', index % 2 === 1 && 'mt-16')}>
              {column.map((tile) => (
                <Artwork
                  key={tile.key}
                  src={tile.src}
                  alt=""
                  seed={`signin-${tile.key}`}
                  className="rounded-xl border border-border-strong shadow-lifted"
                />
              ))}
            </div>
          ))}
        </div>

        <RiseIn delay={0.15} className="relative z-10 m-8 lg:m-12">
          <div className="max-w-xl rounded-xl border border-border-strong bg-card/90 p-7 shadow-overlay backdrop-blur-xl">
            <h2 id="flow-heading" className="text-heading">
              From idea to live mint
            </h2>
            <ol className="mt-5 space-y-0">
              {STEPS.map((step, index) => (
                <li key={step.slug} className="relative flex gap-4 pb-5 last:pb-0">
                  {index < STEPS.length - 1 && (
                    <span
                      aria-hidden="true"
                      className="absolute top-8 bottom-1 left-3.5 w-px bg-border-strong"
                    />
                  )}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'numeric flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                      index === 0
                        ? 'bg-primary text-primary-foreground shadow-button'
                        : 'bg-surface-3 text-muted-foreground ring-1 ring-border-strong ring-inset',
                    )}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <h3 className="text-sm font-semibold">{step.name}</h3>
                    <p className="mt-0.5 text-[0.8125rem] leading-snug text-muted-foreground">
                      {step.summary}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-5 border-t pt-4 text-[0.8125rem] leading-snug text-muted-foreground">
              Then manage your drop: phases, whitelists, the mint page, reveal and airdrops.
            </p>
          </div>
        </RiseIn>
      </section>
    </main>
  )
}
