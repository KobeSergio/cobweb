/* global process, console */
// Local signing server for the dev wallet. Holds a throwaway private key in memory and signs
// personal_sign requests for the page at localhost:3000. Development only.
//
//   node apps/web/scripts/dev-wallet/signer.mjs
//
// A fresh key is generated on every start. To keep the same wallet (and so the same collections)
// across runs, set DEV_WALLET_KEY to a 0x-prefixed private key. The key is never printed.

import { createServer } from 'node:http'
import { isHex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const HOST = '127.0.0.1'
const PORT = Number(process.env.DEV_WALLET_PORT ?? 8787)
const ALLOWED_ORIGINS = new Set(['http://localhost:3000', 'http://127.0.0.1:3000'])

const account = privateKeyToAccount(process.env.DEV_WALLET_KEY ?? generatePrivateKey())

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
      if (raw.length > 64_000) reject(new Error('Body too large'))
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

  send(res, origin, 404, { error: 'Not found' })
})

server.listen(PORT, HOST, () => {
  console.log(`Dev wallet signer on http://${HOST}:${PORT} for ${account.address}`)
})
