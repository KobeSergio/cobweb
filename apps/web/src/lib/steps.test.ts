import { describe, expect, it } from 'vitest'
import { frozenDetailFields, stageAccess } from './steps'

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

describe('stageAccess for Deploy (docs/specs/2026-10-14-deploy.md, section 9)', () => {
  it('opens once the render landed, and stays open once deployed', () => {
    expect(stageAccess('rendered', 'deploy', { demo: false })).toBe('open')
    expect(stageAccess('deployed', 'deploy', { demo: false })).toBe('open')
  })

  it('opens for deferred art once the placeholder job is done, with the collection still a draft', () => {
    expect(stageAccess('draft', 'deploy', { demo: false, artDeferred: true, placeholderReady: true })).toBe(
      'open',
    )
    expect(stageAccess('draft', 'deploy', { demo: false, artDeferred: true, placeholderReady: false })).toBe(
      'locked',
    )
    expect(stageAccess('draft', 'deploy', { demo: false, artDeferred: true })).toBe('locked')
    // The readiness means nothing without deferred art: a plain draft has nothing to deploy.
    expect(stageAccess('draft', 'deploy', { demo: false, placeholderReady: true })).toBe('locked')
    expect(
      stageAccess('rendering', 'deploy', { demo: false, artDeferred: true, placeholderReady: false }),
    ).toBe('locked')
  })

  it('does not open Manage drop before deploy, placeholder or not', () => {
    expect(stageAccess('draft', 'manage', { demo: false, artDeferred: true, placeholderReady: true })).toBe(
      'locked',
    )
  })
})

describe('frozenDetailFields (docs/specs/2026-10-14-deploy.md, section 9)', () => {
  const LOCKED_AT = '2026-10-14T10:00:00Z'

  it('freezes only the type on a draft that is not locked', () => {
    expect([...frozenDetailFields({ status: 'draft', art_locked_at: null })]).toEqual(['projectType'])
  })

  it('freezes the supply after draft, and the name, symbol and description while the art is locked', () => {
    const locked = frozenDetailFields({ status: 'art_locked', art_locked_at: LOCKED_AT })
    expect([...locked].sort()).toEqual(['description', 'maxSupply', 'name', 'projectType', 'symbol'])
    expect(frozenDetailFields({ status: 'rendered', art_locked_at: LOCKED_AT }).has('description')).toBe(true)
  })

  it('keeps the name and symbol frozen once deployed, even when the placeholder alone was locked', () => {
    const deployedDeferred = frozenDetailFields({ status: 'deployed', art_locked_at: null })
    expect([...deployedDeferred].sort()).toEqual(['maxSupply', 'name', 'projectType', 'symbol'])
    expect(frozenDetailFields({ status: 'deployed', art_locked_at: LOCKED_AT }).has('description')).toBe(true)
  })

  it('frees the three again after an unlock', () => {
    const unlocked = frozenDetailFields({ status: 'draft', art_locked_at: null })
    expect(unlocked.has('name')).toBe(false)
    expect(unlocked.has('description')).toBe(false)
  })
})
