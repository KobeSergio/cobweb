/** SHA-256 of a blob as 64 lowercase hex characters, the content hash behind every storage key. */
export async function sha256Hex(
  blob: Blob,
  subtle: SubtleCrypto = globalThis.crypto.subtle,
): Promise<string> {
  const digest = await subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
