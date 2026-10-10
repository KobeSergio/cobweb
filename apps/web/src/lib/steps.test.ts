import { describe, expect, it } from 'vitest'
import { stageAccess } from './steps'

describe('stageAccess for Lock and upload', () => {
  it('opens on a draft, where the review step locks the art', () => {
    expect(stageAccess('draft', 'upload', { demo: false })).toBe('open')
    expect(stageAccess('draft', 'upload', { demo: false, artDeferred: true })).toBe('open')
  })

  it('stays open once the art is locked, while Deploy waits for the render', () => {
    expect(stageAccess('art_locked', 'upload', { demo: false })).toBe('open')
    expect(stageAccess('art_locked', 'deploy', { demo: false })).toBe('locked')
    expect(stageAccess('draft', 'deploy', { demo: false })).toBe('locked')
  })
})
