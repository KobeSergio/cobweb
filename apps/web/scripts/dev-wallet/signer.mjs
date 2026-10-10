/* global process, console, fetch, URL */
// Local signing server for the dev wallet. Holds a throwaway private key in memory, signs
// personal_sign requests for the page at localhost:3000, and on the local Anvil chain (31337) only,
// sends transactions and forwards reads. Development only.
//
//   node apps/web/scripts/dev-wallet/signer.mjs
//
// A fresh key is generated on every start. To keep the same wallet (and so the same collections)
// across runs, set DEV_WALLET_KEY to a 0x-prefixed private key. The key is never printed.
// RPC_URL_31337 overrides the Anvil URL (default http://127.0.0.1:8545); it must be local.

import { createServer } from 'node:http'
import { createWalletClient, http, isAddress, isHex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { anvil } from 'viem/chains'

const HOST = '127.0.0.1'
const PORT = Number(process.env.DEV_WALLET_PORT ?? 8787)
const ALLOWED_ORIGINS = new Set(['http://localhost:3000', 'http://127.0.0.1:3000'])
const ANVIL = 31337
const ANVIL_RPC = process.env.RPC_URL_31337 ?? 'http://127.0.0.1:8545'
if (!['127.0.0.1', 'localhost'].includes(new URL(ANVIL_RPC).hostname)) {
  console.error(`Refusing to run: RPC_URL_31337 is "${ANVIL_RPC}", not a local Anvil.`)
  process.exit(2)
}
// Reads a wallet client may ask its provider for while it prepares and sends a transaction.
const READS = new Set([
  'eth_blockNumber',
  'eth_call',
  'eth_chainId',
  'eth_estimateGas',
  'eth_feeHistory',
  'eth_gasPrice',
  'eth_getBalance',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getTransactionByHash',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_maxPriorityFeePerGas',
])
const ONLY_ANVIL = 'The dev wallet sends and reads on Anvil (31337) only.'

const account = privateKeyToAccount(process.env.DEV_WALLET_KEY ?? generatePrivateKey())
const wallet = createWalletClient({ account, chain: anvil, transport: http(ANVIL_RPC) })

function send(res, origin, status, body) {
  const headers = { 'content-type': 'application/json' }
  if (ALLOWED_ORIGINS.has(origin)) {
    headers['access-control-allow-origin'] = origin
    headers['access-control-allow-methods'] = 'GET, POST, OPTIONS'
    headers['access-control-allow-headers'] = 'content-type'
    headers['vary'] = 'origin'
  }
  res.writeHead(status, headers)
  res.end(body === undefined ? '' : JSON.stringify(body))
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 256_000) reject(new Error('Body too large'))
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin ?? ''
  // Browsers send an Origin; refuse other web pages. Tools without an Origin (curl) may read the address.
  if (origin && !ALLOWED_ORIGINS.has(origin)) return send(res, origin, 403, { error: 'Origin not allowed' })
  if (req.method === 'OPTIONS') return send(res, origin, 204)

  if (req.method === 'GET' && req.url === '/address') {
    return send(res, origin, 200, { address: account.address })
  }

  if (req.method === 'POST' && req.url === '/sign') {
    try {
      const { message, address } = await readJson(req)
      if (typeof message !== 'string') return send(res, origin, 400, { error: 'message must be a string' })
      if (address && address.toLowerCase() !== account.address.toLowerCase()) {
        return send(res, origin, 400, { error: 'Unknown address' })
      }
      // personal_sign sends the message hex-encoded; plain strings are signed as they are.
      const signature = await account.signMessage({ message: isHex(message) ? { raw: message } : message })
      return send(res, origin, 200, { signature })
    } catch {
      return send(res, origin, 400, { error: 'Could not sign' })
    }
  }

  if (req.method === 'POST' && req.url === '/send') {
    try {
      const { chainId, tx } = await readJson(req)
      if (chainId !== ANVIL) return send(res, origin, 400, { error: ONLY_ANVIL })
      if (!tx || !isAddress(tx.to ?? '')) return send(res, origin, 400, { error: 'tx.to must be an address' })
      if (tx.from && tx.from.toLowerCase() !== account.address.toLowerCase()) {
        return send(res, origin, 400, { error: 'Unknown address' })
      }
      const hash = await wallet.sendTransaction({
        to: tx.to,
        data: tx.data,
        value: tx.value ? BigInt(tx.value) : undefined,
        gas: tx.gas ? BigInt(tx.gas) : undefined,
      })
      return send(res, origin, 200, { hash })
    } catch (error) {
      return send(res, origin, 400, { error: error?.shortMessage ?? 'Could not send' })
    }
  }

  if (req.method === 'POST' && req.url === '/rpc') {
    try {
      const { chainId, method, params } = await readJson(req)
      if (chainId !== ANVIL) return send(res, origin, 400, { error: ONLY_ANVIL })
      if (!READS.has(method)) return send(res, origin, 400, { error: `Not forwarded: ${method}` })
      const upstream = await fetch(ANVIL_RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? [] }),
      })
      const body = await upstream.json()
      if (body.error) return send(res, origin, 400, { error: body.error.message ?? 'RPC error' })
      return send(res, origin, 200, { result: body.result })
    } catch {
      return send(res, origin, 400, { error: 'Anvil did not answer' })
    }
  }

  send(res, origin, 404, { error: 'Not found' })
})

server.listen(PORT, HOST, () => {
  console.log(`Dev wallet signer on http://${HOST}:${PORT} for ${account.address}`)
})
