'use client'

import { createContext, useContext } from 'react'

/**
 * Whether the collection's art is deferred ("Finish the art later", decision D25), for the Deploy
 * screens deep in the flow. Set by `DeployScreen`.
 */
const ArtDeferredContext = createContext(false)

export function ArtDeferredProvider({ value, children }: { value: boolean; children: React.ReactNode }) {
  return <ArtDeferredContext.Provider value={value}>{children}</ArtDeferredContext.Provider>
}

export function useArtDeferred(): boolean {
  return useContext(ArtDeferredContext)
}
