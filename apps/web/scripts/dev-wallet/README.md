# Dev wallet

Signs in to the local app from a headless browser, without a browser extension. Development only.

- `signer.mjs` holds a throwaway private key in memory and signs `personal_sign` requests. It listens on `127.0.0.1:8787` and answers only pages on `localhost:3000`. It never prints the key.
- `inject.js` is an EIP-1193 provider that forwards account and signing requests to the signer. It sets `window.ethereum` and announces itself over EIP-6963, so RainbowKit lists it as "Dev Wallet".

## Use

```sh
# 1. The signer (prints only the address)
node apps/web/scripts/dev-wallet/signer.mjs
# Same wallet every run, so the same collections:
DEV_WALLET_KEY=0x... node apps/web/scripts/dev-wallet/signer.mjs

# 2. The app, against local Supabase
supabase start && pnpm --filter @cobweb/web dev
```

3. In Playwright, add the provider before the page loads:

```js
await page.addInitScript({ path: '/absolute/path/to/apps/web/scripts/dev-wallet/inject.js' })
await page.goto('http://localhost:3000')
// Connect wallet -> Dev Wallet -> Sign in as 0x...
```

With the Playwright MCP tools, run that through `browser_run_code_unsafe`. If the file path is not readable from the browser process, pass the script text instead: `page.addInitScript({ content })`.

Supported methods: `eth_requestAccounts`, `eth_accounts`, `eth_chainId`, `net_version`, `personal_sign`, `wallet_switchEthereumChain`, `wallet_addEthereumChain`, `wallet_getPermissions`, `wallet_requestPermissions`, `wallet_revokePermissions`. Anything else (transactions included) is refused with code 4200.
