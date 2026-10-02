import { MonitorIcon } from 'lucide-react'
import { Logo } from '@/components/shell/logo'

/**
 * Shown in place of the dashboard on phone-sized screens. Building a collection involves layer
 * uploads and wide editing tools, so the creator side is desktop only. The public mint page works
 * on any screen.
 */
export function SmallScreen() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-8 text-center sm:hidden">
      <Logo />
      <MonitorIcon aria-hidden="true" className="text-muted-foreground size-10" />
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Open Cobweb on a larger screen</h1>
        <p className="text-muted-foreground text-base">
          Creating and managing a collection needs a tablet or desktop. Your collections will be here when you
          switch.
        </p>
      </div>
    </div>
  )
}
