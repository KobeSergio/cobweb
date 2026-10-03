/* global window, console, fetch, btoa, CustomEvent, localStorage */
// EIP-1193 provider for local development. Proxies account and signing requests to the dev
// wallet signer (signer.mjs) on 127.0.0.1:8787, sets window.ethereum and announces itself over
// EIP-6963 so RainbowKit lists it as an installed wallet.
//
// Use as a Playwright init script:  await page.addInitScript({ path: '.../inject.js' })
;(() => {
  if (window.__cobwebDevWallet) return
  const SIGNER = 'http://127.0.0.1:8787'
  const listeners = {}
  let chainId = '0x1'
  let address = null
  // Like a real wallet, stay connected across reloads once the site has been allowed in.
  const CONNECTED_KEY = 'cobweb-dev-wallet-connected'
  const remembered = () => {
    try {
      return localStorage.getItem(CONNECTED_KEY) === '1'
    } catch {
      return false
    }
  }
  const remember = (value) => {
    try {
      if (value) localStorage.setItem(CONNECTED_KEY, '1')
      else localStorage.removeItem(CONNECTED_KEY)
    } catch {
      // Storage blocked: the connection lasts for this page only.
    }
  }

  function emit(event, value) {
    for (const handler of listeners[event] ?? []) {
      try {
        handler(value)
      } catch (error) {
        console.error(error)
      }
    }
  }

  function rpcError(code, message) {
    const error = new Error(message)
    error.code = code
    return error
  }

  async function getAddress() {
    if (address) return address
    const response = await fetch(`${SIGNER}/address`)
    if (!response.ok) throw rpcError(4100, 'Dev wallet signer is not running')
    address = (await response.json()).address
    return address
  }

  async function sign(message, from) {
    const response = await fetch(`${SIGNER}/sign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, address: from }),
    })
    const body = await response.json()
    if (!response.ok) throw rpcError(4001, body.error ?? 'Signing failed')
    return body.signature
  }

  const provider = {
    isCobwebDevWallet: true,
    async request({ method, params = [] }) {
      switch (method) {
        case 'eth_requestAccounts': {
          const account = await getAddress()
          remember(true)
          emit('connect', { chainId })
          emit('accountsChanged', [account])
          return [account]
        }
        case 'eth_accounts':
          if (address) return [address]
          return remembered() ? [await getAddress()] : []
        case 'eth_chainId':
          return chainId
        case 'net_version':
          return String(parseInt(chainId, 16))
        case 'personal_sign': {
          // personal_sign is (message, address); some callers swap them.
          const [first, second] = params
          const looksLikeAddress = (value) => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
          const [message, from] = looksLikeAddress(first) && !looksLikeAddress(second) ? [second, first] : [first, second]
          return sign(message, from)
        }
        case 'wallet_switchEthereumChain':
        case 'wallet_addEthereumChain': {
          const next = params[0]?.chainId
          if (next && next !== chainId) {
            chainId = next
            emit('chainChanged', chainId)
          }
          return null
        }
        case 'wallet_requestPermissions':
        case 'wallet_getPermissions':
          return [{ parentCapability: 'eth_accounts' }]
        case 'wallet_revokePermissions':
          address = null
          remember(false)
          emit('accountsChanged', [])
          return null
        default:
          throw rpcError(4200, `Dev wallet does not support ${method}`)
      }
    },
    on(event, handler) {
      ;(listeners[event] ??= []).push(handler)
      return provider
    },
    removeListener(event, handler) {
      listeners[event] = (listeners[event] ?? []).filter((candidate) => candidate !== handler)
      return provider
    },
  }

  const info = {
    uuid: '6f1c3c1e-2b8f-4b5c-9a43-000000000001',
    name: 'Dev Wallet',
    rdns: 'app.cobweb.devwallet',
    icon:
      'data:image/svg+xml;base64,' +
      btoa(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#222220"/><circle cx="16" cy="16" r="7" fill="#fadc69"/></svg>',
      ),
  }

  function announce() {
    window.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }),
    )
  }

  window.__cobwebDevWallet = provider
  window.ethereum = provider
  window.addEventListener('eip6963:requestProvider', announce)
  announce()
})()
