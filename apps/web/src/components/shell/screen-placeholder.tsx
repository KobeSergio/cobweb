import { ConstructionIcon } from 'lucide-react'

/**
 * Stand-in body for a screen that has not been built yet. It names the screen, says what goes
 * there, and lists the data the page already passes in, so the wiring can be checked.
 * Screen components replace their use of this as they are built.
 */
export function ScreenPlaceholder({
  screen,
  builds,
  data,
}: {
  screen: string
  builds: string
  data: { label: string; value: React.ReactNode }[]
}) {
  return (
    <section
      aria-label={`${screen} (placeholder)`}
      className="bg-card flex flex-1 flex-col gap-5 rounded-lg border border-dashed p-6"
    >
      <div className="flex items-start gap-3">
        <ConstructionIcon aria-hidden="true" className="text-primary mt-0.5 size-5 shrink-0" />
        <div className="space-y-1">
          <h3 className="text-base font-medium">{screen}: placeholder</h3>
          <p className="text-muted-foreground text-sm text-pretty">{builds}</p>
        </div>
      </div>
      <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-6 gap-y-2 text-sm">
        {data.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
