import { describe, expect, it } from 'vitest'
import { getMintPageData } from '@/lib/demo'
import { deriveAction, derivePhases } from './model'

describe('deriveAction', () => {
  it('stays blocked when the countdown has passed but the chain has not reported the phase live', () => {
    const data = getMintPageData('night-owls', 'upcoming', { connected: true })
    const group = data.groups.find((g) => g.scheduledStart > 0)!
    const chainNow = group.scheduledStart + 5 // past the start, but every group.active is still false
    const phase = derivePhases(data, data.wallet, chainNow).find((p) => p.group.id === group.id)!
    expect(phase.status).toBe('starting')
    const action = deriveAction({
      data,
      phase,
      connected: true,
      wrongChain: false,
      quantity: 1,
      vault: null,
      soldOut: false,
    })
    expect(action.kind).toBe('blocked')
    expect(action.label).toBe('Starting, waiting for the chain')
  })
})
