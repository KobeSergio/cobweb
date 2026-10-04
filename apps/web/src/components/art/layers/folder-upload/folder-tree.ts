/**
 * Reading a generative project from a folder, as the legacy app did (`validateStructure`): every
 * image sits at `collection/layer/trait.png` or `project/collection/layer/trait.png`. A project
 * can hold several collections (for example male and female), each with its own layers.
 */

/** A file with its path inside the dropped or chosen folder, e.g. `Male/Eyes/starry.png`. */
export type PathedFile = { path: string; file: File }

export type DetectedTrait = {
  key: string
  /** The trait name, from the file name (`traitNameFromFile`). */
  name: string
  file: File
  path: string
  /** Set when an earlier image in the same layer already has this name; the image is left out. */
  clash?: string
}
export type DetectedLayer = { name: string; folder: string; traits: DetectedTrait[] }
export type DetectedCollection = { name: string; folder: string; layers: DetectedLayer[] }

export type DetectedProject = {
  /** The top folder when the layout is `project/collection/layer/trait.png`. */
  projectName: string | null
  collections: DetectedCollection[]
  /** Problems with the layout itself. Any of these stops the upload. */
  structureErrors: string[]
  /** System files skipped without comment (`.DS_Store`, `Thumbs.db`, `__MACOSX`). */
  skipped: number
}

const JUNK = /^(\.|__MACOSX$|Thumbs\.db$|desktop\.ini$)/i
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** `01_Background` and `1 - Background` read as `Background`: the number only sets the order. */
export function cleanFolderName(folder: string): string {
  const cleaned = folder.replace(/^\d+\s*[-_.)\s]\s*/, '').trim()
  return cleaned || folder
}

/**
 * A trait's name from its file name, as collectors will read it in the metadata. The legacy upload
 * used the file name without its extension, as written; so does this, except that an ordering
 * number in front (`01_Red.png`, `2 - Red.png`, `3.Red.png`) is dropped and runs of spaces close
 * up. Case, inner underscores and hyphens stay. A name that is only a number (`7.png`) stays `7`.
 */
export function traitNameFromFile(fileName: string): string {
  const base = fileName
    .replace(/\.[^./]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  const cleaned = base.replace(/^\d+\s*[-_.)]\s*/, '').trim()
  return cleaned || base || fileName
}

/** Names that read the same ignoring case, by their lower-case form, with every folder or file that has it. */
function clashes<T>(items: T[], nameOf: (item: T) => string): Map<string, T[]> {
  const seen = new Map<string, T[]>()
  for (const item of items) {
    const key = nameOf(item).toLowerCase()
    seen.set(key, [...(seen.get(key) ?? []), item])
  }
  return new Map([...seen].filter(([, list]) => list.length > 1))
}

function cleanPath(path: string): string[] {
  return path.replace(/^\/+/, '').split('/').filter(Boolean)
}

function listExamples(paths: string[], limit = 3): string {
  const shown = paths.slice(0, limit).join(', ')
  return paths.length > limit ? `${shown} and ${(paths.length - limit).toLocaleString('en-US')} more` : shown
}

/**
 * Groups files into collections and layers. The collections come from the folder structure:
 *   - `project/collection/layer/trait.png`: one collection per folder inside the project folder;
 *   - `collection/layer/trait.png`: one collection per top folder (choosing one folder gives one
 *     collection named after it);
 *   - `layer/trait.png` (layer folders dropped on their own): one collection named `fallbackName`,
 *     the project's name.
 * Layers and traits are ordered by folder and file name with numbers read as numbers, so `2_Body`
 * comes before `10_Hat`; the first layer is the bottom.
 */
export function detectProject(files: PathedFile[], fallbackName = 'Collection'): DetectedProject {
  let skipped = 0
  const kept: { parts: string[]; entry: PathedFile }[] = []
  for (const entry of files) {
    const parts = cleanPath(entry.path)
    if (parts.length === 0 || parts.some((part) => JUNK.test(part))) {
      skipped++
      continue
    }
    kept.push({ parts, entry })
  }

  const structureErrors: string[] = []
  if (kept.length === 0) {
    structureErrors.push('This folder has no images in it.')
    return { projectName: null, collections: [], structureErrors, skipped }
  }

  const depths = new Set(kept.map((item) => item.parts.length))
  const wrong = kept.filter((item) => item.parts.length < 2 || item.parts.length > 4)
  if (wrong.length > 0) {
    structureErrors.push(
      `Some files are not inside a layer folder: ${listExamples(wrong.map((item) => item.parts.join('/')))}.`,
    )
  } else if (depths.size > 1) {
    structureErrors.push(
      'Some images are one folder deeper than others. Keep every image at the same depth: collection/layer/trait.png, or project/collection/layer/trait.png.',
    )
  }
  if (structureErrors.length > 0) return { projectName: null, collections: [], structureErrors, skipped }

  const nested = depths.has(4)
  const roots = new Set(kept.map((item) => item.parts[0]!))
  if (nested && roots.size > 1) {
    structureErrors.push(
      `Choose one project folder at a time. Found ${listExamples([...roots])} side by side, each with collections inside.`,
    )
    return { projectName: null, collections: [], structureErrors, skipped }
  }

  const loose = depths.has(2)
  const byCollection = new Map<string, Map<string, PathedFile[]>>()
  for (const { parts, entry } of kept) {
    const [collection, layer] = nested
      ? [parts[1]!, parts[2]!]
      : loose
        ? [fallbackName, parts[0]!]
        : [parts[0]!, parts[1]!]
    const layers = byCollection.get(collection) ?? new Map<string, PathedFile[]>()
    layers.set(layer, [...(layers.get(layer) ?? []), entry])
    byCollection.set(collection, layers)
  }

  const collections = [...byCollection.entries()]
    .sort(([a], [b]) => collator.compare(a, b))
    .map(([folder, layers]): DetectedCollection => ({
      folder,
      name: cleanFolderName(folder),
      layers: [...layers.entries()]
        .sort(([a], [b]) => collator.compare(a, b))
        .map(([layerFolder, entries]) => ({
          folder: layerFolder,
          name: cleanFolderName(layerFolder),
          traits: markClashes(
            entries
              .sort((a, b) => collator.compare(a.file.name, b.file.name))
              .map((entry) => ({
                key: entry.path,
                name: traitNameFromFile(entry.file.name),
                file: entry.file,
                path: entry.path,
              })),
          ),
        })),
    }))

  // Two folders that read as one name (`01_Eyes` and `Eyes`) would give two layers, or two
  // collections, of the same name; the legacy tool refused duplicate layer names.
  for (const [, same] of clashes(collections, (c) => c.name))
    structureErrors.push(
      `${listExamples(same.map((c) => c.folder))} would all be the collection ${same[0]!.name}. Rename the folders so each name is used once.`,
    )
  for (const collection of collections)
    for (const [, same] of clashes(collection.layers, (l) => l.name))
      structureErrors.push(
        `${listExamples(same.map((l) => l.folder))} in ${collection.name} would all be the layer ${same[0]!.name}. Rename the folders so each layer name is used once.`,
      )
  if (structureErrors.length > 0) return { projectName: null, collections: [], structureErrors, skipped }

  return { projectName: nested ? [...roots][0]! : null, collections, structureErrors, skipped }
}

/**
 * Marks every image after the first that gives the same trait name in a layer, ignoring case
 * (`Red.png` and `01_red.png`). Two traits of one name would be one attribute in the metadata, so
 * the legacy tool refused duplicate trait names; the later images are left out with a reason.
 */
function markClashes(traits: DetectedTrait[]): DetectedTrait[] {
  const first = new Map<string, DetectedTrait>()
  return traits.map((trait) => {
    const key = trait.name.toLowerCase()
    const earlier = first.get(key)
    if (!earlier) {
      first.set(key, trait)
      return trait
    }
    return { ...trait, clash: `Also named ${earlier.name}, like ${earlier.file.name}. Rename one of them.` }
  })
}

export function countTraits(project: Pick<DetectedProject, 'collections'>): number {
  return project.collections.reduce(
    (sum, collection) => sum + collection.layers.reduce((n, layer) => n + layer.traits.length, 0),
    0,
  )
}

// ---------------------------------------------------------------------------------------------
// Reading folders from a drop or a folder picker
// ---------------------------------------------------------------------------------------------

/** Files chosen with `<input webkitdirectory>` carry their path in `webkitRelativePath`. */
export function fromPicker(list: FileList | null): PathedFile[] {
  return Array.from(list ?? []).map((file) => ({ file, path: file.webkitRelativePath || file.name }))
}

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject))
}

async function walk(entry: FileSystemEntry, out: PathedFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    )
    out.push({ file, path: entry.fullPath })
    return
  }
  if (!entry.isDirectory) return
  const reader = (entry as FileSystemDirectoryEntry).createReader()
  // readEntries returns at most 100 entries per call; keep reading until it returns none.
  for (;;) {
    const batch = await readEntries(reader)
    if (batch.length === 0) break
    for (const child of batch) await walk(child, out)
  }
}

/**
 * Every file in what was dropped, with its path. Folders are read recursively; a browser without
 * folder drops gives just the loose files, which `detectProject` then reports as out of place.
 */
export async function fromDrop(data: DataTransfer): Promise<PathedFile[]> {
  const entries = Array.from(data.items)
    .map((item) => (item.kind === 'file' ? item.webkitGetAsEntry?.() : null))
    .filter((entry): entry is FileSystemEntry => !!entry)
  if (entries.length === 0) return Array.from(data.files).map((file) => ({ file, path: file.name }))
  const out: PathedFile[] = []
  for (const entry of entries) await walk(entry, out)
  return out
}
