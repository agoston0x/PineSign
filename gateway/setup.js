/**
 * First-run setup.
 *
 * A fresh server knows nothing: which name it issues subnames under, which key
 * pays for them, where the receipt contract lives. The admin supplies the first,
 * the server generates the second, and the third follows once there is gas.
 *
 * The deployer key is generated here and never leaves the box. It is written to
 * .storage/, which is not in the repository — if it were, every clone of this
 * project would share a wallet.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { privateKeyToAccount } from 'viem/accounts'
import * as chain from './chain.js'

const FILE = path.resolve('.storage/config.json')

/** Printed once at boot. Without it, nobody passing by can configure the server. */
export const SETUP_TOKEN = process.env.SETUP_TOKEN ?? randomBytes(16).toString('hex')

let config = null

async function load() {
  if (config) return config
  try {
    config = JSON.parse(await readFile(FILE, 'utf8'))
  } catch {
    config = {
      parentName: null,
      deployer: null,
      receiptsAddress: null,
      deployTx: null,
      nameRegistered: false,
    }
  }
  return config
}

async function persist() {
  await mkdir(path.dirname(FILE), { recursive: true })
  await writeFile(FILE, JSON.stringify(config, null, 2), { mode: 0o600 })
}

export async function get() {
  return load()
}

export async function parentName() {
  return (await load()).parentName
}

export async function receiptsAddress() {
  return (await load()).receiptsAddress
}

/**
 * Where setup has got to. The page renders this and nothing else, so the server
 * stays the single source of truth about its own state.
 */
export async function status() {
  const c = await load()
  const step = !c.parentName ? 'name' : !c.deployer ? 'keys' : !c.receiptsAddress ? 'fund' : 'ready'

  const out = {
    step,
    parentName: c.parentName,
    deployer: c.deployer?.address ?? null,
    receiptsAddress: c.receiptsAddress,
    deployTx: c.deployTx,
    rpcUrl: chain.RPC_URL,
    balance: null,
    cost: null,
    fundedEnough: false,
  }

  // The balance and the budget are shown from the moment a key exists, so an
  // admin can see what they are funding before they send anything.
  if (c.deployer) {
    const label = c.parentName?.replace(/\.eth$/, '') ?? null
    const [balance, budget] = await Promise.all([
      chain.balanceOf(c.deployer.address).catch(() => null),
      chain.budget(label).catch(() => null),
    ])
    out.balance = balance
    out.budget = budget

    if (!c.receiptsAddress && balance && budget) {
      // Enough for the deployment, with room left over to sponsor users.
      const needed = BigInt(budget.deploy.wei) * 2n
      out.fundedEnough = BigInt(balance.wei) > needed
    }
  }

  if (c.parentName && !c.nameRegistered) {
    const label = c.parentName.replace(/\.eth$/, '')
    out.nameAvailable = await chain.ensAvailable(label).catch(() => null)
  }
  out.nameRegistered = Boolean(c.nameRegistered)

  return out
}

export async function chooseName(name) {
  const clean = String(name ?? '').trim().toLowerCase()
  if (!/^[a-z0-9-]+\.eth$/.test(clean)) throw new Error('expected a name like pinesign.eth')

  const c = await load()
  if (c.parentName) throw new Error('this server already has a name')

  c.parentName = clean
  await persist()
  return status()
}

/**
 * Generate the deployer. It pays for the contract and, afterwards, for every
 * subname the server issues on a user's behalf — which is what lets users never
 * hold gas.
 */
export async function generateDeployer() {
  const c = await load()
  if (c.deployer) throw new Error('a deployer key already exists')

  const privateKey = `0x${randomBytes(32).toString('hex')}`
  const account = privateKeyToAccount(privateKey)
  c.deployer = { address: account.address, privateKey }
  await persist()
  return status()
}

/**
 * Buy the name this server issues subnames under.
 *
 * Slow on purpose — the registrar enforces a wait between committing and
 * revealing — so the request is held open for the better part of two minutes.
 */
export async function registerName() {
  const c = await load()
  if (!c.parentName) throw new Error('choose a name first')
  if (!c.deployer) throw new Error('generate a deployer key first')
  if (c.nameRegistered) throw new Error('already registered')

  const label = c.parentName.replace(/\.eth$/, '')
  const result = await chain.registerEnsName(c.deployer.privateKey, label)

  c.nameRegistered = true
  c.nameRegistration = result
  await persist()
  return status()
}

export async function deploy() {
  const c = await load()
  if (!c.deployer) throw new Error('generate a deployer key first')
  if (c.receiptsAddress) throw new Error('already deployed')

  const result = await chain.deployReceipts(c.deployer.privateKey)
  c.receiptsAddress = result.address
  c.deployTx = result.txHash
  await persist()
  return status()
}

/** Setup is only reachable by someone holding the token from the server console. */
export function requireSetupToken(req, res, next) {
  const supplied = req.get('x-setup-token') ?? req.query.token
  if (supplied !== SETUP_TOKEN) return res.status(401).json({ error: 'bad or missing setup token' })
  next()
}
