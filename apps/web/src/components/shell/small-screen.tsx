import { MonitorIcon } from 'lucide-react'
import { Logo } from '@/components/shell/logo'

/**
 * Shown in place of the dashboard on phone-sized screens. Building a collection involves layer
 * uploads and wide editing tools, so the creator side is desktop only. The public mint page works
 * on any screen.
 */
export function SmallScreen() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-8 p-8 text-center sm:hidden">
      <Logo />
      <span className="flex size-14 items-center justify-center rounded-xl border border-border-strong bg-surface-2 shadow-lifted">
        <MonitorIcon aria-hidden="true" className="size-6 text-muted-foreground" />
      </span>
      <div className="space-y-3">
        <h1 className="text-title">Open Cobweb on a larger screen</h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          Creating and managing a collection needs a tablet or desktop. Your collections will be here when you
          switch.
        </p>
      </div>
    </div>
  )
}
