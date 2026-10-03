# Cobweb design language

**Gallery at night.** The chrome is quiet warm graphite; the artwork carries the colour. Dark only. Poppins for words, Geist Mono for numbers that are data. One yellow accent, used with confidence in three places and nowhere else.

Read this, then read the components in `packages/ui/src/components`. Tokens live in `packages/ui/src/styles/globals.css`. If something you need is missing, add it to `packages/ui` rather than styling around it in a screen.

## Surfaces

Each step up is one level closer to the viewer. All are the same warm gray family; never introduce a cool or green gray.

| Token / class | Value | Use it for |
| --- | --- | --- |
| `bg-sidebar` | `#161614` | The sidebar and the darkest panels (sign-in art wall). |
| `bg-background` | `#1a1a18` | The page. |
| `bg-card` (= `bg-surface-1`) | `#222220` | Cards, panels, dialogs, sheets. |
| `bg-surface-2` | `#2a2a28` | Raised things on a card: secondary buttons, hover on surface-1, menus, popovers, toasts, active tab. |
| `bg-surface-3` | `#343431` | Highest: pressed, chips and icon tiles inside raised layers, menu item hover. |
| `bg-well` | `#141413` | Recessed: inside of inputs, selects, switches (off), progress tracks, empty image frames. |

Elevation (shadows are tinted to the base, never pure black, never a glow):

| Class | For |
| --- | --- |
| `shadow-raised` | Cards, panels, secondary buttons. Includes the 1px inner top light. |
| `shadow-lifted` | Hovered cards, tooltips, floating art tiles. |
| `shadow-overlay` | Dialogs, menus, popovers, toasts. |
| `shadow-inset` | Wells (fields, tracks). |
| `shadow-button` | The primary button only. |

Lines: `border` (default `--border`, 8% foreground) for dividers and card edges; `border-border-strong` (15%) for edges that must read (overlays, chips, frames); `border-input` (30%, 3:1) for the edges of form controls.

## Text

| Class | Use |
| --- | --- |
| `text-foreground` | Body and headings. `#f5f4ef`. |
| `text-muted-foreground` | Secondary text, labels, descriptions, placeholders. Passes 4.5:1 up to surface-3. |
| `text-faint` / `bg-faint` | Non-text only: resting icons, separator dots, big decorative numerals. Never for words you need to read. |

## Type scale

Poppins (`font-sans`, the default). Root size steps 12/14/16px at 0/640/1024px, so every rem scales.

| Class | Size / weight | Use |
| --- | --- | --- |
| `text-display` | 2.25rem, 600, -0.03em | The page h1 (PageHeader), empty-state headline. One per screen. |
| `text-title` | 1.5rem, 600, -0.02em | Dialog titles, small-screen headings. |
| `text-heading` | 1.0625rem, 600 | Card and panel titles, section h2. |
| `text-base` / `text-[0.9375rem]` | 400 | Lead paragraphs under a display title. `leading-relaxed`. |
| `text-sm` | 400 or 500 | Default UI text, buttons, form labels. |
| `text-[0.8125rem]` | 400 | Meta lines, descriptions inside cards. |
| `text-xs` | 500 | Badges, stat labels, table headers. |

Numbers that are data (prices, supply, counts, token ids, addresses, symbols, countdowns, block numbers) use **`numeric`**: Geist Mono, tabular figures, slashed zero. `font-mono` is the bare family if you need it without the figure settings. Do not use mono as decoration for labels or headings.

Countdown: `<span className="numeric text-[2.5rem] leading-none">02:14:09</span>`, or `<Stat size="lg" accent label="Ends in" value="02:14:09" />` while the phase is live. Tabular figures keep it from jittering.

## Radius rule

| Radius | Class | For |
| --- | --- | --- |
| 4px | `rounded-xs` | Checkbox. |
| 6px | `rounded-sm` | Items inside a menu, xs buttons, tooltip. |
| 10px | `rounded-md` | **Controls**: buttons, inputs, selects, toggles, tab lists, wallet pill. |
| 12px | `rounded-lg` | **Floating menus**: dropdowns, popovers, selects' lists, toasts, small step tiles. |
| 16px | `rounded-xl` | **Cards and panels**: cards, panels, dialogs, choice cards, image frames, alerts. |
| full | `rounded-full` | **Chips and dots**: badges, status badges, avatars, progress bars, switch. |

Nested corners: an element inside a padded container uses the next radius down.

## Spacing rhythm

4px base. Inside a control: 8 to 14px. Inside a card: 20 to 24px (`p-5`, `p-6`). Between cards in a grid: 20px (`gap-5`). Between page sections: 32 to 40px (`space-y-8`, `space-y-10`). Page gutter: `px-8`, top `pt-10`, bottom `pb-16`. More space above a heading than below it. The dashboard content max width is `max-w-[90rem]`; reading pages use `max-w-4xl`.

## The accent

`#fadc69`, `bg-primary` with `text-primary-foreground` (dark text, always). Hover `bg-primary-hover`, pressed `bg-primary-pressed`. Soft fill `bg-primary-soft` with edge `border-primary-line`.

Use it for exactly three things:

1. **The primary action.** One `Button` (default variant) per view.
2. **Live or active state.** The active sidebar item, the current step, a checked switch / checkbox / radio / choice card, the `live` status badge, the focus ring, the line-tab underline.
3. **Progress.** `Progress`, the stage segments on a collection card, minted of supply.

Never for: icons at rest, headings, links in body copy (use underline on foreground), decoration, borders of ordinary cards, illustrations.

## Status colours

Use `StatusBadge`, which picks the look for you:

| `status` | Look | Meaning |
| --- | --- | --- |
| `draft` | Neutral chip, gray dot | Not started or not published. |
| `scheduled` | Outlined, hollow dot | Starts at a known time. |
| `live` | Yellow soft chip, pulsing dot | Happening now. **Only when the contract's `mintGroupActive` says so.** |
| `closed` | Outlined, dim square dot | Ended before selling out. |
| `soldout` | Green soft chip | Every token minted. |
| `done` | Green soft chip with tick | A finished task or stage. |
| `pending` | Orange soft chip | Working in the background (rendering, confirming). |
| `error` | Red soft chip | Failed, needs attention. |

Semantic tokens if you need them elsewhere: `success` / `success-foreground` / `success-soft`, `warning` / ..., `destructive` / ... The plain hue is for fills and dots; the `-foreground` variant is for text; `-soft` is the background behind that text.

## Imagery

Collections are shown by their artwork wherever it exists. Use `Artwork` for every art slot: with `src` it fills the frame; without one (or on load error) it shows an empty, softly lit frame with a cobweb drawn from `seed`. Pass a stable seed (the collection id). Give it a radius and aspect via `className`. Overlays (badges) go in as children. Never use a plain letter tile as a stand-in for art.

Sample art (sample-data mode, `NEXT_PUBLIC_DEMO_DATA=1`): `/demo/tokens/1.svg` to `/demo/tokens/24.svg`, `/demo/banner.svg`, `/demo/avatar.svg`.

## Motion

Small and motivated: a state changed, an action landed, a list arrived. Animate `transform` and `opacity` only. House curve `ease-out-expo` (`cubic-bezier(0.16, 1, 0.3, 1)`). Durations: 150ms hover and press, 300ms state change, 500ms entry. Reduced motion is respected globally for CSS; Motion components check `useReducedMotion`.

Components: `Stagger` + `StaggerItem` for a grid or list arriving (once per screen), `RiseIn` for one panel. Presets in `@cobweb/ui/lib/motion` (`EASE_OUT`, `DURATION`, `transition`, `riseIn`, `stagger`).

```tsx
'use client'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { transition } from '@cobweb/ui/lib/motion'

function SavedNote({ saved }: { saved: boolean }) {
  const reduce = useReducedMotion()
  return (
    <AnimatePresence>
      {saved && (
        <motion.p
          initial={reduce ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={transition.base}
          className="text-sm text-success-foreground"
        >
          Saved
        </motion.p>
      )}
    </AnimatePresence>
  )
}
```

For drag and reorder (layers, phases) use `@dnd-kit/core` + `@dnd-kit/sortable` with `transition.spring` for the settle.

## Components

All from `@cobweb/ui/components/<name>`. Utilities: `cn` from `@cobweb/ui/lib/utils`, motion presets from `@cobweb/ui/lib/motion`.

Cobweb pieces (new):

| Import | What |
| --- | --- |
| `page-header` | `PageHeader` `{ title, description?, actions? }`. The page h1, a line of description, actions on the right. |
| `panel` | `Panel` `{ title?, description?, action?, bodyClassName? }`. A page section on surface-1. |
| `stat` | `Stat` `{ label, value, suffix?, hint?, size?: 'sm' \| 'default' \| 'lg', accent? }` inside `StatGroup` (a `<dl>`). Mono tabular value. |
| `status-badge` | `StatusBadge` `{ status, children? }`. See Status colours. |
| `artwork` | `Artwork` `{ src?, alt, seed, label?, className?, imageClassName?, children? }`; `CornerWeb` `{ seed }` for decorative empty frames. |
| `motion` | `Stagger`, `StaggerItem`, `RiseIn`. |
| `step` | `Step` `{ state: 'done' \| 'current' \| 'next' \| 'pending', completed?, index? }`, `StepSeparator` `{ done? }`. |
| `choice-cards` | `ChoiceCards` (radio group), `ChoiceCard` `{ value, title, description?, icon? }`. |

shadcn components (restyled): `accordion`, `alert` (variants `default`, `accent`, `success`, `warning`, `destructive`), `alert-dialog`, `avatar`, `badge` (`default`, `secondary`, `outline`, `ghost`, `accent`, `success`, `warning`, `destructive`, `link`), `breadcrumb`, `button` (`default` = primary, `secondary`, `outline`, `ghost`, `destructive`, `link`; sizes `xs`, `sm`, `default`, `lg`, `icon`, `icon-xs`, `icon-sm`, `icon-lg`), `calendar`, `card`, `checkbox`, `collapsible`, `command`, `dialog`, `drawer`, `dropdown-menu`, `empty`, `field`, `hover-card`, `input`, `input-group`, `label`, `pagination`, `popover`, `progress` (sizes `sm`, `default`, `lg`), `radio-group`, `scroll-area`, `select`, `separator`, `sheet`, `sidebar`, `skeleton`, `slider`, `sonner`, `spinner`, `switch`, `table`, `tabs` (`TabsList variant="default"` segmented, `"line"` underlined), `textarea`, `toggle`, `toggle-group`, `tooltip`.

Notes:
- `DialogFooter` is a sticky bar flush with the dialog's bottom edge; it assumes the default `p-7` padding of `DialogContent`. Dialogs cap at the viewport height and scroll inside.
- `Input type="number"` sets `numeric` for you. For addresses, symbols and amounts in a text input, add `className="numeric"`.
- `Skeleton` takes the radius of what it stands in for (`rounded-xl` for a card).
- Toasts are for transient confirmations. Errors that block a form go inline under the field (`FieldError`).

## Do

- One primary button per view. Secondary actions are `secondary`, `outline` or `ghost`.
- Show the art. If a screen is about a collection or token, it has an `Artwork` on it.
- Put every number that is data in `numeric`.
- Use `Card` for things the creator acts on and `Panel` for page sections. Inside a card, step up a surface or use a divider; never a card in a card.
- Label above input, help text below it, error replacing the help text.
- Give every interactive element a hover, pressed, focus-visible and disabled state. The kit's components already do.

## Do not

- No hex values, `rgb()` or Tailwind palette colours (`bg-zinc-800`, `text-yellow-300`) in components. Only tokens.
- No pure black shadows, no outer glows, no gradient text, no glass as decoration.
- No yellow outside the three uses above. No second accent hue.
- No eyebrow labels (small uppercase tracking text) above headings.
- No letter tiles in place of artwork. No emoji. One icon family: lucide.
- No `animate-*` on layout properties (width, height, top). No looping animation except the live dot and loading states.
- Do not show "live" from the clock or from an event; only from the chain read.

## Copy

- Product name is Cobweb. Never "Kingdomly" or "realm" in visible copy.
- Plain, professional, second person. Sentence case for everything, including buttons and titles.
- No em dashes or en dashes in visible copy; use a comma, a full stop or "to" (e.g. "1 to 24").
- Buttons name their action: "Create collection", "Deploy contract", not "Submit" or "OK". Primary CTAs are 1 to 3 words.
- Errors say what went wrong and how to recover: "Enter a name." "The signature request was cancelled. Try again."
- Numbers: thousands separators (`toLocaleString('en-US')`), units after the value ("0.025 ETH", "777 tokens").
