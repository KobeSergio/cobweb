// Starts a local Anvil chain on 127.0.0.1:8545 if none is running, deploys the Cobweb factory to it
// (contracts/script/DeployLocal.s.sol), funds the dev wallet signer when it is running, and prints
// the two lines for apps/web/.env.local. Development only. Uses Anvil's first account unlocked, so
// no private key is passed or printed.
//
//   pnpm --filter @cobweb/web chain:local

import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTestClient, getAddress, http, isAddress, parseEther, publicActions } from 'viem'
import { anvil } from 'viem/chains'

const RPC = 'http://127.0.0.1:8545'
/** Anvil's first default account (a public address; the chain unlocks it). */
const FIRST_ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const SIGNER = 'http://127.0.0.1:8787/address'

const contracts = resolve(dirname(fileURLToPath(import.meta.url)), '../../../contracts')
const client = createTestClient({ chain: anvil, mode: 'anvil', transport: http(RPC) }).extend(publicActions)

async function running(): Promise<boolean> {
  try {
    return (await client.getChainId()) === 31337
  } catch {
    return false
  }
}

if (await running()) {
  console.log('Anvil is already running on 127.0.0.1:8545.')
} else {
  const child = spawn('anvil', ['--port', '8545', '--chain-id', '31337', '--silent'], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  for (let attempt = 0; attempt < 50 && !(await running()); attempt++)
    await new Promise((done) => setTimeout(done, 200))
  if (!(await running())) {
    console.error('Anvil did not start on port 8545. Install Foundry (foundryup) and try again.')
    process.exit(1)
  }
  console.log('Started Anvil on 127.0.0.1:8545.')
}

execFileSync(
  'forge',
  [
    'script',
    'script/DeployLocal.s.sol',
    '--rpc-url',
    RPC,
    '--broadcast',
    '--unlocked',
    '--sender',
    FIRST_ACCOUNT,
  ],
  { cwd: contracts, stdio: ['ignore', 'ignore', 'inherit'] },
)

type Broadcast = {
  transactions: { transactionType: string; contractName: string | null; contractAddress: string | null }[]
}
const broadcast = JSON.parse(
  readFileSync(resolve(contracts, 'broadcast/DeployLocal.s.sol/31337/run-latest.json'), 'utf8'),
) as Broadcast
const factory = broadcast.transactions.find(
  (tx) => tx.transactionType === 'CREATE' && tx.contractName === 'CobwebFactory',
)?.contractAddress
if (!factory || !isAddress(factory, { strict: false })) {
  console.error('The deploy ran but the factory address was not in the broadcast file.')
  process.exit(1)
}

try {
  const response = await fetch(SIGNER)
  const { address } = (await response.json()) as { address: string }
  await client.setBalance({ address: getAddress(address), value: parseEther('100') })
  console.log(`Funded the dev wallet ${address} with 100 ETH.`)
} catch {
  console.log('The dev wallet signer is not running. Start it, then run chain:local again to fund it.')
}

console.log('\nAdd these lines to apps/web/.env.local, then restart the dev server:\n')
console.log(`RPC_URL_31337=${RPC}`)
console.log(`FACTORY_ADDRESS_31337=${getAddress(factory)}`)
