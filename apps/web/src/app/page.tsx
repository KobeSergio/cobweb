import { redirect } from 'next/navigation'
import { SignInButton } from '@/components/auth/sign-in-button'
import { Logo } from '@/components/shell/logo'
import { getSessionUser } from '@/lib/auth'
import { STEPS } from '@/lib/steps'

/**
 * The sign-in screen. Same split as the legacy creator sign-in: the card on the left, a panel on
 * the right. The right panel now shows what the creator is about to do instead of other
 * projects' artwork.
 */
export default async function SignInPage() {
  if (await getSessionUser()) redirect('/collections')

  return (
    <main className="flex min-h-svh flex-col lg:flex-row">
      <section className="flex flex-1 items-center justify-center p-6 lg:p-12">
        <div className="bg-card flex w-full max-w-[31.25rem] flex-col items-center gap-8 rounded-2xl border px-6 py-12 text-center sm:px-10 lg:py-16">
          <Logo className="text-2xl" markClassName="size-8" />
          <div className="space-y-3">
            <h1 className="text-2xl font-semibold text-balance">Launch your NFT collection</h1>
            <p className="text-muted-foreground text-base text-pretty">
              Create the art, deploy the contract and run the mint from one place. No code.
            </p>
          </div>
          <div className="w-full max-w-xs">
            <SignInButton />
          </div>
          <p className="text-muted-foreground text-sm text-pretty">
            Signing in asks your wallet to sign a message. It is free and sends no transaction.
          </p>
        </div>
      </section>

      <section
        aria-labelledby="flow-heading"
        className="bg-sidebar flex flex-1 items-center justify-center border-t p-6 lg:border-t-0 lg:border-l lg:p-12"
      >
        <div className="w-full max-w-md">
          <h2 id="flow-heading" className="text-muted-foreground text-sm font-medium">
            From idea to live mint
          </h2>
          <ol className="mt-6">
            {STEPS.map((step, index) => (
              <li key={step.slug} className="relative flex gap-4 pb-6 last:pb-0">
                {index < STEPS.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="bg-border absolute top-7 bottom-0 left-[0.6875rem] w-px"
                  />
                )}
                <span
                  aria-hidden="true"
                  className="border-border-strong text-muted-foreground mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums"
                >
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-base font-medium">{step.name}</h3>
                  <p className="text-muted-foreground mt-1 text-sm text-pretty">{step.summary}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </main>
  )
}
