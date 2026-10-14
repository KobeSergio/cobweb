'use server'

import { revalidatePath } from 'next/cache'
import { txHash as txHashSchema } from '@/lib/art/lock-schemas'
import type { ActionResult } from '@/lib/art/result'
import { parse } from '@/lib/art/schemas'
import { deployFormShape } from '@/lib/deploy/deploy-args'
import { confirmDeployCore, deployViewCore, prepareCore, readDeployment } from '@/lib/deploy/deploy-core'
import type { DeployForm, DeployRecord, DeployView, Prepared } from '@/lib/deploy/deploy-types'
import { deployWrite } from '@/lib/deploy/deploy-write'

/**
 * Builds and encodes the constructor from the collection, the finished render and the form, and
 * predicts the address (docs/specs/2026-10-14-deploy.md, section 6.3). Nothing is written. The core
 * validates the form again against the supply; the shape is checked here so a malformed payload is
 * refused before the owner read.
 */
export async function prepareDeploy(collectionId: string, form: DeployForm): Promise<ActionResult<Prepared>> {
  const input = parse(deployFormShape, form)
  if (!input.ok) return input
  return deployWrite(collectionId, (ctx) => prepareCore(ctx, form))
}

/** Checks a deployment against its receipt's CollectionDeployed log and the prediction, then records the contract. */
export async function confirmDeploy(
  collectionId: string,
  txHash: string,
  form: DeployForm,
): Promise<ActionResult<DeployRecord>> {
  const hash = parse(txHashSchema, txHash)
  if (!hash.ok) return hash
  const input = parse(deployFormShape, form)
  if (!input.ok) return input
  const result = await deployWrite(collectionId, (ctx) => confirmDeployCore(ctx, hash.data, form))
  // The collection is deployed: the stepper, Manage drop and every page under the collection change.
  if (result.ok) revalidatePath('/collections/[id]', 'layout')
  return result
}

/** The deployment record, or null before deploy. */
export async function getDeployment(collectionId: string): Promise<ActionResult<DeployRecord | null>> {
  return deployWrite(collectionId, async (ctx) => ({
    data: await readDeployment(ctx.supabase, ctx.collection.id),
  }))
}

/** What the deploy page shows: the finished jobs, the paid chain, its fee snapshot and the record. */
export async function getDeployView(collectionId: string): Promise<ActionResult<DeployView>> {
  return deployWrite(collectionId, (ctx) => deployViewCore(ctx))
}
