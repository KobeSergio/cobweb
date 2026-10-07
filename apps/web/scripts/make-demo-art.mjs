// Draws the "Night Owls" sample art used in sample-data mode.
//
//   node apps/web/scripts/make-demo-art.mjs
//
// Writes, under apps/web/public/demo/:
//   layers/<layer>/<trait>.svg   one transparent, square layer per trait (1000 x 1000), designed to stack
//   tokens/1.svg ... 24.svg      composites of the first tokens, with the same DNA the app lists
//   banner.svg, avatar.svg       for the mint page
//   placeholder.svg              the pre-reveal placeholder of the Lock and upload sample
//
// The layer and token definitions come from src/lib/demo/art.ts (loaded with node's type stripping),
// so the pictures always match the sample data. No dependencies.

/* global console */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerHooks } from 'node:module'

// The engine's source imports its own files without extensions (as TypeScript and the bundlers
// expect), which node's loader does not resolve. This hook adds ".ts" when a relative import fails.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier))
        return nextResolve(`${specifier}.ts`, context)
      throw error
    }
  },
})

const { DEMO_COLLECTIONS, DEMO_LAYERS, DEMO_PREVIEW_COUNT, DEMO_RULES, DEMO_SEED, slugify } =
  await import('../src/lib/demo/art.ts')
const { generateProject } = await import('../../../packages/dna/src/index.ts')

// The first collection's layers carry the drawings; the other collections reuse its images by name,
// and the previewed tokens (1 to 24) all belong to it.
const ART_LAYERS = DEMO_LAYERS.filter((layer) => layer.collectionId === DEMO_COLLECTIONS[0].id)

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'demo')
const SIZE = 1000

// ---------------------------------------------------------------------------------------------
// Palette. Muted, warm, and calm next to a dark warm-gray UI with a yellow accent.
// ---------------------------------------------------------------------------------------------

const INK = '#211c1a' // outlines, pupils
const CREAM = '#f6f1e6' // eye whites, highlights
const GOLD = '#e7b43c'
const GOLD_DEEP = '#b9862a'
const RED = '#c4513f'
const TEAL = '#2f6b6a'
const LEAF = '#7aa65a'

const BACKGROUNDS = {
  dusk: { base: '#3e4a66', glow: '#4b5876' },
  moss: { base: '#56603f', glow: '#636d4b' },
  clay: { base: '#b0644a', glow: '#bd7258' },
  slate: { base: '#59646b', glow: '#667178' },
  plum: { base: '#5b3e58', glow: '#694a66' },
  ink: { base: '#1d2430', glow: '#27303d' },
  sand: { base: '#d8c6a0', glow: '#e2d2b0' },
}

const BODIES = {
  barn: { base: '#c79a6c', shade: '#a77b50', disc: '#ead5b6' },
  tawny: { base: '#8c5c3d', shade: '#6f4630', disc: '#c99a72' },
  ash: { base: '#8f8b85', shade: '#716d68', disc: '#c9c4bb' },
  snowy: { base: '#e6e0d3', shade: '#c4bba9', disc: '#f8f5ee' },
  ember: { base: '#c8643f', shade: '#a24c2e', disc: '#eba783' },
  midnight: { base: '#333a52', shade: '#252a3d', disc: '#55607f' },
  golden: { base: '#e2b143', shade: '#bd8b28', disc: '#f6dc96' },
}

// ---------------------------------------------------------------------------------------------
// Geometry. Every trait is drawn against the same skeleton, so any combination lines up.
// ---------------------------------------------------------------------------------------------

const EYE_L = [382, 452]
const EYE_R = [618, 452]
const EYE_R_WHITE = 98
const BEAK_Y = 560

// An egg with two ear tufts: narrow at the crown, widest at the shoulders, cut by the bottom edge.
const BODY_PATH = [
  'M 138 1010',
  'C 132 840 150 660 205 530',
  'C 232 465 240 380 238 300',
  'L 240 196 Q 242 150 280 172 L 352 222',
  'C 420 232 462 256 500 256 C 538 256 580 232 648 222',
  'L 720 172 Q 758 150 760 196 L 762 300',
  'C 760 380 768 465 795 530',
  'C 850 660 868 840 862 1010 Z',
].join(' ')

const svg = (inner, { width = SIZE, height = SIZE, viewBox = `0 0 ${SIZE} ${SIZE}` } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}">${inner}</svg>\n`

// ---------------------------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------------------------

function background(key) {
  const { base, glow } = BACKGROUNDS[key]
  return `<rect width="1000" height="1000" fill="${base}"/><circle cx="500" cy="470" r="400" fill="${glow}"/>`
}

function body(key) {
  const { base, shade, disc } = BODIES[key]
  return [
    `<defs><clipPath id="owl-body-clip"><path d="${BODY_PATH}"/></clipPath></defs>`,
    `<path d="${BODY_PATH}" fill="${base}"/>`,
    // Inner ear tufts.
    `<path d="M 260 204 L 258 266 L 322 236 Z M 740 204 L 742 266 L 678 236 Z" fill="${shade}" stroke="${shade}" stroke-width="16" stroke-linejoin="round"/>`,
    // Folded wings, following the body's edge.
    `<g clip-path="url(#owl-body-clip)" fill="${shade}">`,
    '<path d="M 90 560 C 250 590 322 790 300 1010 L 90 1010 Z"/>',
    '<path d="M 910 560 C 750 590 678 790 700 1010 L 910 1010 Z"/>',
    '</g>',
    // Facial disc.
    `<circle cx="${EYE_L[0]}" cy="${EYE_L[1]}" r="140" fill="${disc}"/>`,
    `<circle cx="${EYE_R[0]}" cy="${EYE_R[1]}" r="140" fill="${disc}"/>`,
    key === 'golden'
      ? `<path d="M 500 248 l 14 30 l 32 4 l -24 22 l 7 32 l -29 -16 l -29 16 l 7 -32 l -24 -22 l 32 -4 z" fill="${CREAM}" opacity="0.85"/>`
      : '',
  ].join('')
}

const BELLY = '<ellipse cx="500" cy="880" rx="232" ry="236" fill="#ffffff" fill-opacity="0.2"/>'
const MARK =
  'fill="none" stroke="#000000" stroke-opacity="0.2" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"'

function belly(key) {
  const marks = []
  if (key === 'speckled') {
    const rows = [
      [720, [430, 500, 570]],
      [790, [395, 465, 535, 605]],
      [860, [360, 430, 500, 570, 640]],
      [930, [395, 465, 535, 605]],
    ]
    for (const [y, xs] of rows)
      for (const x of xs)
        marks.push(`<path d="M ${x - 14} ${y - 8} L ${x} ${y + 8} L ${x + 14} ${y - 8}" ${MARK}/>`)
  }
  if (key === 'chevron') {
    for (const y of [720, 800, 880, 960]) {
      const w = y < 760 ? 120 : 175
      marks.push(`<path d="M ${500 - w} ${y - 30} L 500 ${y + 22} L ${500 + w} ${y - 30}" ${MARK}/>`)
    }
  }
  if (key === 'scalloped') {
    const rows = [
      [730, [440, 560]],
      [800, [380, 500, 620]],
      [870, [320, 440, 560, 680]],
      [940, [380, 500, 620]],
    ]
    for (const [y, xs] of rows)
      for (const x of xs) marks.push(`<path d="M ${x - 50} ${y} A 50 44 0 0 0 ${x + 50} ${y}" ${MARK}/>`)
  }
  if (key === 'heart') {
    marks.push(
      '<path d="M 500 930 C 420 870 380 830 380 785 C 380 750 408 728 440 728 C 466 728 488 742 500 766 C 512 742 534 728 560 728 C 592 728 620 750 620 785 C 620 830 580 870 500 930 Z" fill="' +
        RED +
        '" fill-opacity="0.85"/>',
    )
  }
  return BELLY + marks.join('')
}

function eyeWhite([cx, cy], r = EYE_R_WHITE) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${CREAM}"/>`
}

function iris([cx, cy], color, { dx = 0, dy = 0, r = 64 } = {}) {
  const x = cx + dx
  const y = cy + dy
  return [
    `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`,
    `<circle cx="${x}" cy="${y}" r="${Math.round(r * 0.56)}" fill="${INK}"/>`,
    `<circle cx="${x + Math.round(r * 0.34)}" cy="${y - Math.round(r * 0.38)}" r="${Math.round(r * 0.2)}" fill="${CREAM}"/>`,
  ].join('')
}

const AMBER = '#eda93a'

function eyes(key) {
  const both = (draw) => draw(EYE_L, 'l') + draw(EYE_R, 'r')
  switch (key) {
    case 'wide':
      return both((c) => eyeWhite(c) + iris(c, AMBER))
    case 'jade':
      return both((c) => eyeWhite(c) + iris(c, '#5aae86'))
    case 'glance':
      return both((c) => eyeWhite(c) + iris(c, AMBER, { dx: 30, dy: -6 }))
    case 'sleepy':
      // Upper lid down to the middle: the lower half of the eye shows below a firm lid line.
      return (
        '<defs><clipPath id="eyes-sleepy-clip"><rect x="0" y="462" width="1000" height="200"/></clipPath></defs>' +
        `<g clip-path="url(#eyes-sleepy-clip)">${both((c) => eyeWhite(c) + iris(c, AMBER, { dy: 18 }))}</g>` +
        both(
          ([cx]) =>
            `<path d="M ${cx - 100} 462 L ${cx + 100} 462" stroke="${INK}" stroke-width="22" stroke-linecap="round"/>`,
        )
      )
    case 'squint':
      return (
        '<defs><clipPath id="eyes-squint-clip"><rect x="0" y="420" width="1000" height="64"/></clipPath></defs>' +
        `<g clip-path="url(#eyes-squint-clip)">${both((c) => eyeWhite(c) + iris(c, AMBER))}</g>` +
        both(
          ([cx]) =>
            `<path d="M ${cx - 96} 420 L ${cx + 96} 420 M ${cx - 96} 484 L ${cx + 96} 484" stroke="${INK}" stroke-width="20" stroke-linecap="round"/>`,
        )
      )
    case 'wink':
      return (
        eyeWhite(EYE_L) +
        iris(EYE_L, AMBER) +
        `<path d="M ${EYE_R[0] - 72} ${EYE_R[1] + 14} Q ${EYE_R[0]} ${EYE_R[1] - 52} ${EYE_R[0] + 72} ${EYE_R[1] + 14}" fill="none" stroke="${INK}" stroke-width="24" stroke-linecap="round"/>`
      )
    case 'hypno':
      return both(
        ([cx, cy]) =>
          eyeWhite([cx, cy]) +
          [74, 50, 26]
            .map(
              (r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${INK}" stroke-width="13"/>`,
            )
            .join('') +
          `<circle cx="${cx}" cy="${cy}" r="7" fill="${INK}"/>`,
      )
    case 'starry':
      return both(([cx, cy]) => {
        const star = starPath(cx, cy, 40, 17, 5)
        return (
          eyeWhite([cx, cy]) +
          `<circle cx="${cx}" cy="${cy}" r="66" fill="#2c3672"/>` +
          `<path d="${star}" fill="${GOLD}"/>` +
          `<circle cx="${cx + 30}" cy="${cy - 34}" r="9" fill="${CREAM}"/>`
        )
      })
  }
  throw new Error(`No drawing for eyes ${key}`)
}

function starPath(cx, cy, outer, inner, points) {
  const parts = []
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner
    const a = (Math.PI / points) * i - Math.PI / 2
    parts.push(`${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`)
  }
  return `M ${parts.join(' L ')} Z`
}

function beakShape(color, { w = 50, h = 92, y = BEAK_Y - 34 } = {}) {
  return `<path d="M ${500 - w} ${y} L ${500 + w} ${y} L 500 ${y + h} Z" fill="${color}" stroke="${color}" stroke-width="26" stroke-linejoin="round"/>`
}

function beak(key) {
  switch (key) {
    case 'classic':
      return (
        beakShape(AMBER) +
        `<path d="M 500 ${BEAK_Y - 30} L 500 ${BEAK_Y + 40}" stroke="#c98a26" stroke-width="10" stroke-linecap="round"/>`
      )
    case 'ivory':
      return (
        beakShape('#ece2cc') +
        `<path d="M 500 ${BEAK_Y - 30} L 500 ${BEAK_Y + 40}" stroke="#cfc2a6" stroke-width="10" stroke-linecap="round"/>`
      )
    case 'tiny':
      return beakShape(AMBER, { w: 30, h: 58, y: BEAK_Y - 22 })
    case 'charcoal':
      return (
        beakShape('#3b3532') +
        `<path d="M 482 ${BEAK_Y - 26} L 494 ${BEAK_Y + 20}" stroke="#6a625c" stroke-width="10" stroke-linecap="round"/>`
      )
    case 'rose':
      return (
        beakShape('#d48b78') +
        `<path d="M 500 ${BEAK_Y - 30} L 500 ${BEAK_Y + 40}" stroke="#b5705f" stroke-width="10" stroke-linecap="round"/>`
      )
  }
  throw new Error(`No drawing for beak ${key}`)
}

function headwear(key) {
  switch (key) {
    case 'beanie':
      return [
        `<path d="M 318 300 C 318 160 400 112 500 112 C 600 112 682 160 682 300 Z" fill="${RED}"/>`,
        `<path d="M 400 290 L 400 150 M 450 292 L 450 120 M 500 292 L 500 114 M 550 292 L 550 120 M 600 290 L 600 150" stroke="#000000" stroke-opacity="0.14" stroke-width="10" stroke-linecap="round"/>`,
        `<rect x="296" y="268" width="408" height="72" rx="30" fill="#a8402f"/>`,
        `<circle cx="500" cy="96" r="44" fill="${CREAM}"/>`,
      ].join('')
    case 'crown':
      return [
        `<path d="M 372 300 L 360 160 L 432 222 L 500 132 L 568 222 L 640 160 L 628 300 Z" fill="${GOLD}" stroke="${GOLD}" stroke-width="20" stroke-linejoin="round"/>`,
        `<rect x="362" y="270" width="276" height="44" rx="12" fill="${GOLD_DEEP}"/>`,
        `<circle cx="500" cy="292" r="15" fill="${RED}"/><circle cx="420" cy="292" r="11" fill="${TEAL}"/><circle cx="580" cy="292" r="11" fill="${TEAL}"/>`,
        `<circle cx="360" cy="152" r="16" fill="${GOLD}"/><circle cx="500" cy="124" r="16" fill="${GOLD}"/><circle cx="640" cy="152" r="16" fill="${GOLD}"/>`,
      ].join('')
    case 'wizard-hat':
      return [
        `<path d="M 340 280 C 400 210 440 120 470 30 C 490 -10 560 0 590 40 C 560 50 540 80 548 120 C 560 180 600 230 660 280 Z" fill="#3c3f86"/>`,
        `<ellipse cx="500" cy="286" rx="230" ry="48" fill="#30336f"/>`,
        `<path d="${starPath(470, 190, 30, 12, 5)}" fill="${GOLD}"/>`,
        `<path d="${starPath(548, 112, 18, 7, 5)}" fill="${GOLD}"/>`,
        `<circle cx="410" cy="242" r="8" fill="${GOLD}"/><circle cx="590" cy="226" r="7" fill="${GOLD}"/>`,
      ].join('')
    case 'sprout':
      return [
        `<path d="M 500 250 C 500 210 494 180 500 140" fill="none" stroke="#5c8a43" stroke-width="16" stroke-linecap="round"/>`,
        `<path d="M 500 160 C 470 110 410 104 382 124 C 400 168 462 182 500 160 Z" fill="${LEAF}"/>`,
        `<path d="M 500 150 C 520 92 584 76 618 96 C 604 146 540 168 500 150 Z" fill="#8fbb6c"/>`,
      ].join('')
    case 'headphones':
      return [
        `<path d="M 196 470 C 196 210 330 120 500 120 C 670 120 804 210 804 470" fill="none" stroke="#2f2b29" stroke-width="40" stroke-linecap="round"/>`,
        `<rect x="138" y="390" width="104" height="190" rx="44" fill="#2f2b29"/>`,
        `<rect x="758" y="390" width="104" height="190" rx="44" fill="#2f2b29"/>`,
        `<rect x="160" y="414" width="60" height="142" rx="28" fill="${RED}"/>`,
        `<rect x="780" y="414" width="60" height="142" rx="28" fill="${RED}"/>`,
      ].join('')
    case 'halo':
      return `<ellipse cx="500" cy="118" rx="168" ry="42" fill="none" stroke="${GOLD}" stroke-width="26"/><ellipse cx="500" cy="118" rx="168" ry="42" fill="none" stroke="#fff3c4" stroke-opacity="0.6" stroke-width="6"/>`
  }
  throw new Error(`No drawing for headwear ${key}`)
}

function accessory(key) {
  switch (key) {
    case 'scarf':
      return [
        `<path d="M 214 668 C 380 728 620 728 786 668 L 800 750 C 620 812 380 812 200 750 Z" fill="${RED}"/>`,
        `<path d="M 300 712 L 290 784 M 400 730 L 394 804 M 500 736 L 500 810 M 600 730 L 606 804 M 700 712 L 710 784" stroke="${CREAM}" stroke-opacity="0.55" stroke-width="18"/>`,
        `<path d="M 640 760 L 720 760 L 742 960 L 652 960 Z" fill="#ad4434"/>`,
        `<path d="M 652 960 L 662 990 M 682 960 L 690 992 M 712 960 L 718 990 M 738 960 L 744 986" stroke="#ad4434" stroke-width="12" stroke-linecap="round"/>`,
      ].join('')
    case 'bow-tie':
      return [
        `<path d="M 500 712 L 400 660 L 400 770 Z M 500 712 L 600 660 L 600 770 Z" fill="${TEAL}" stroke="${TEAL}" stroke-width="28" stroke-linejoin="round"/>`,
        `<rect x="472" y="684" width="56" height="58" rx="18" fill="#245553"/>`,
      ].join('')
    case 'pendant':
      return [
        `<path d="M 320 640 C 380 730 440 770 500 776 C 560 770 620 730 680 640" fill="none" stroke="${GOLD}" stroke-width="10" stroke-linecap="round"/>`,
        `<path d="M 500 772 L 540 820 L 500 878 L 460 820 Z" fill="#5aae86" stroke="${GOLD}" stroke-width="12" stroke-linejoin="round"/>`,
        `<path d="M 486 806 L 500 790 L 512 806" fill="none" stroke="${CREAM}" stroke-opacity="0.7" stroke-width="8" stroke-linecap="round"/>`,
      ].join('')
    case 'monocle':
      return [
        `<circle cx="${EYE_R[0]}" cy="${EYE_R[1]}" r="112" fill="#ffffff" fill-opacity="0.08" stroke="${GOLD}" stroke-width="16"/>`,
        `<path d="M 712 510 C 770 600 760 700 800 790" fill="none" stroke="${GOLD}" stroke-width="7" stroke-linecap="round" stroke-dasharray="2 16"/>`,
      ].join('')
    case 'lantern':
      return [
        `<circle cx="770" cy="820" r="150" fill="${GOLD}" fill-opacity="0.16"/>`,
        `<path d="M 730 700 C 730 660 810 660 810 700" fill="none" stroke="#2f2b29" stroke-width="12" stroke-linecap="round"/>`,
        `<rect x="712" y="700" width="116" height="30" rx="10" fill="#2f2b29"/>`,
        `<rect x="722" y="730" width="96" height="140" rx="14" fill="#fbe08a"/>`,
        `<path d="M 770 730 L 770 870 M 722 800 L 818 800" stroke="#2f2b29" stroke-opacity="0.25" stroke-width="8"/>`,
        `<path d="M 770 812 C 752 790 762 770 770 756 C 778 770 788 790 770 812 Z" fill="#f08a2a"/>`,
        `<rect x="712" y="866" width="116" height="30" rx="10" fill="#2f2b29"/>`,
      ].join('')
    case 'book':
      return [
        `<path d="M 330 820 L 500 850 L 670 820 L 670 1000 L 500 1020 L 330 1000 Z" fill="${TEAL}"/>`,
        `<path d="M 346 812 L 496 840 L 496 1000 L 346 976 Z M 654 812 L 504 840 L 504 1000 L 654 976 Z" fill="${CREAM}"/>`,
        `<path d="M 372 860 L 470 876 M 372 892 L 470 908 M 372 924 L 448 936 M 530 876 L 628 860 M 530 908 L 628 892 M 530 936 L 610 924" stroke="#000000" stroke-opacity="0.18" stroke-width="8" stroke-linecap="round"/>`,
      ].join('')
  }
  throw new Error(`No drawing for accessory ${key}`)
}

const DRAW = { background, body, belly, eyes, beak, headwear, accessory }

/** The inner markup for one trait, or '' for a blank. */
function traitMarkup(traitId) {
  for (const layer of ART_LAYERS) {
    const trait = layer.traits.find((t) => t.id === traitId)
    if (!trait) continue
    if (trait.blank) return ''
    return `<g data-trait="${traitId}">${DRAW[layer.id](slugify(trait.name))}</g>`
  }
  throw new Error(`Unknown trait ${traitId}`)
}

// ---------------------------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------------------------

rmSync(OUT, { recursive: true, force: true })

let layerFiles = 0
for (const layer of ART_LAYERS) {
  for (const trait of layer.traits) {
    if (trait.blank) continue
    const file = join(OUT, 'layers', layer.id, `${slugify(trait.name)}.svg`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, svg(traitMarkup(trait.id)))
    layerFiles++
  }
}

const tokens = generateProject(
  { layers: DEMO_LAYERS, rules: DEMO_RULES, collections: DEMO_COLLECTIONS },
  DEMO_SEED,
).tokens
mkdirSync(join(OUT, 'tokens'), { recursive: true })
for (const token of tokens.slice(0, DEMO_PREVIEW_COUNT)) {
  writeFileSync(join(OUT, 'tokens', `${token.id}.svg`), svg(token.dna.map(traitMarkup).join('')))
}

// The owl without its background, for the banner and avatar.
const owl = (dna) => dna.slice(1).map(traitMarkup).join('')

// Banner: a row of owls rising from the bottom edge under a moon. 1500 x 500. `x` is each owl's centre.
const bannerOwls = [
  {
    x: 210,
    s: 0.4,
    dna: ['body-ash', 'belly-scalloped', 'eyes-sleepy', 'beak-tiny', 'headwear-beanie', 'accessory-none'],
  },
  {
    x: 485,
    s: 0.46,
    dna: ['body-barn', 'belly-speckled', 'eyes-wide', 'beak-classic', 'headwear-none', 'accessory-scarf'],
  },
  {
    x: 750,
    s: 0.5,
    dna: ['body-golden', 'belly-plain', 'eyes-jade', 'beak-ivory', 'headwear-crown', 'accessory-pendant'],
  },
  {
    x: 1015,
    s: 0.46,
    dna: [
      'body-midnight',
      'belly-chevron',
      'eyes-starry',
      'beak-classic',
      'headwear-wizard-hat',
      'accessory-none',
    ],
  },
  {
    x: 1290,
    s: 0.4,
    dna: ['body-ember', 'belly-heart', 'eyes-glance', 'beak-rose', 'headwear-sprout', 'accessory-bow-tie'],
  },
]
const banner = svg(
  [
    '<rect width="1500" height="500" fill="#2a2433"/>',
    '<circle cx="1420" cy="78" r="130" fill="#332c3d"/>',
    '<circle cx="1420" cy="78" r="40" fill="#f2e3b3"/>',
    ...[
      [140, 70, 4],
      [330, 140, 3],
      [520, 50, 5],
      [760, 110, 3],
      [960, 40, 4],
      [1080, 230, 3],
      [1430, 300, 4],
      [60, 250, 3],
    ].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#f6f1e6" fill-opacity="0.6"/>`),
    ...bannerOwls.map(
      ({ x, s, dna }) =>
        `<g transform="translate(${x - 500 * s} ${500 - 1000 * s}) scale(${s})">${owl(['background-dusk', ...dna])}</g>`,
    ),
  ].join(''),
  { width: 1500, height: 500, viewBox: '0 0 1500 500' },
)
writeFileSync(join(OUT, 'banner.svg'), banner)

const avatar = svg(
  [
    'background-dusk',
    'body-golden',
    'belly-plain',
    'eyes-wide',
    'beak-classic',
    'headwear-crown',
    'accessory-none',
  ]
    .map(traitMarkup)
    .join(''),
  { width: 400, height: 400 },
)
writeFileSync(join(OUT, 'avatar.svg'), avatar)

// Placeholder: what every token shows before the reveal (decision D25). An owl's silhouette in the
// dark with a question mark, so it reads as "not revealed yet".
const placeholder = svg(
  [
    traitMarkup('background-ink'),
    `<path d="${BODY_PATH}" fill="${INK}" fill-opacity="0.85"/>`,
    `<text x="500" y="700" text-anchor="middle" font-family="Georgia, serif" font-size="340" fill="${CREAM}" fill-opacity="0.75">?</text>`,
  ].join(''),
  { width: 400, height: 400 },
)
writeFileSync(join(OUT, 'placeholder.svg'), placeholder)

console.log(
  `Wrote ${layerFiles} layers, ${DEMO_PREVIEW_COUNT} token previews, banner, avatar and placeholder to ${OUT}`,
)
