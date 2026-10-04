import { describe, expect, it } from 'vitest'
import { detectProject, traitNameFromFile, type PathedFile } from './folder-tree'

const file = (path: string): PathedFile => ({ path, file: new File(['x'], path.split('/').pop()!) })

describe('trait names from file names (legacy: the file name without its extension)', () => {
  it('keeps the name as written, dropping only the extension and an ordering number', () => {
    expect(traitNameFromFile('Wizard_hat.png')).toBe('Wizard_hat')
    expect(traitNameFromFile('01_Red Eyes.png')).toBe('Red Eyes')
    expect(traitNameFromFile('2 - Gold.png')).toBe('Gold')
    expect(traitNameFromFile('3.Blue.png')).toBe('Blue')
    expect(traitNameFromFile('3D Glasses.png')).toBe('3D Glasses')
    expect(traitNameFromFile('7.png')).toBe('7')
    expect(traitNameFromFile('Big   Hat .png')).toBe('Big Hat')
  })
})

describe('folder layout', () => {
  it('orders layers and traits by their numbers, read as numbers; the first layer is the bottom', () => {
    const project = detectProject([
      file('Owls/10_Hat/2_Crown.png'),
      file('Owls/2_Body/b.png'),
      file('Owls/1_Background/10_Sand.png'),
      file('Owls/1_Background/9_Dusk.png'),
      file('Owls/10_Hat/1_Beanie.png'),
    ])
    expect(project.structureErrors).toEqual([])
    const [owls] = project.collections
    expect(owls!.layers.map((l) => l.name)).toEqual(['Background', 'Body', 'Hat'])
    expect(owls!.layers[0]!.traits.map((t) => t.name)).toEqual(['Dusk', 'Sand'])
  })

  it('leaves out an image whose trait name repeats one in the same layer, ignoring case', () => {
    const project = detectProject([file('Owls/Eyes/Red.png'), file('Owls/Eyes/01_red.png')])
    const traits = project.collections[0]!.layers[0]!.traits
    expect(traits.filter((t) => t.clash)).toHaveLength(1)
  })

  it('refuses two folders that would be one layer', () => {
    const project = detectProject([file('Owls/01_Eyes/a.png'), file('Owls/Eyes/b.png')])
    expect(project.structureErrors[0]).toMatch(/would all be the layer Eyes/)
  })

  it('finds collections in project/collection/layer/trait.png', () => {
    const project = detectProject([file('Night/Male/Eyes/a.png'), file('Night/Female/Eyes/a.png')])
    expect(project.projectName).toBe('Night')
    expect(project.collections.map((c) => c.name)).toEqual(['Female', 'Male'])
  })
})
