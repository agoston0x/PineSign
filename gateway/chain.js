/**
 * Chain access.
 *
 * Everything the gateway needs from Ethereum: whether a name is free, whether
 * the deployer has been funded, and how to put the receipt contract on chain.
 */

import { createPublicClient, createWalletClient, http, keccak256, toHex, stringToBytes, formatEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const RPC_URL = process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'

/** The ENS registry sits at the same address on every chain it is deployed to. */
const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e'

/** Sepolia's .eth registrar. Verified on chain: it prices and registers names. */
export const ETH_CONTROLLER = process.env.ENS_CONTROLLER ?? '0xFED6a969AaA60E4961FCD3EBF1A2e8913ac65B72'

const CONTROLLER_ABI = [
  {
    name: 'rentPrice', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'name', type: 'string' }, { name: 'duration', type: 'uint256' }],
    outputs: [{
      name: 'price', type: 'tuple',
      components: [{ name: 'base', type: 'uint256' }, { name: 'premium', type: 'uint256' }],
    }],
  },
  {
    name: 'available', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'name', type: 'string' }], outputs: [{ name: '', type: 'bool' }],
  },
]

export const YEAR = 31536000n

/** Sepolia's public resolver — where a freshly registered name points. */
export const PUBLIC_RESOLVER = process.env.ENS_RESOLVER ?? '0x8FADE66B79cC9f707aB26799354482EB93a5B7dD'

/**
 * Registration is commit-then-reveal: publish a hash, wait out the minimum age,
 * then register with the same secret. The wait exists to stop anyone watching
 * the mempool from front-running the name.
 *
 * The signature here was verified against the deployed contract rather than
 * taken from documentation — controller versions differ in this exact shape.
 */
const REGISTER_INPUTS = [
  { name: 'name', type: 'string' },
  { name: 'owner', type: 'address' },
  { name: 'duration', type: 'uint256' },
  { name: 'secret', type: 'bytes32' },
  { name: 'resolver', type: 'address' },
  { name: 'data', type: 'bytes[]' },
  { name: 'reverseRecord', type: 'bool' },
  { name: 'ownerControlledFuses', type: 'uint16' },
]

const REGISTRAR_ABI = [
  { name: 'makeCommitment', type: 'function', stateMutability: 'pure', inputs: REGISTER_INPUTS, outputs: [{ name: '', type: 'bytes32' }] },
  { name: 'commit', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'commitment', type: 'bytes32' }], outputs: [] },
  { name: 'register', type: 'function', stateMutability: 'payable', inputs: REGISTER_INPUTS, outputs: [] },
  { name: 'minCommitmentAge', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
]

/**
 * Gas each recurring operation costs, measured from the contract test suite and
 * the ENS resolver calls. Approximate by nature — they exist so an admin can
 * see what funding the server actually commits them to, not to be exact.
 */
const GAS = {
  subnameMint: 75000n,   // setSubnodeRecord
  subnameRecord: 50000n, // setText, publishing the encryption key
  send: 95000n,
  claim: 60000n,
}
const REGISTRY_ABI = [
  {
    name: 'owner',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
]

export const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) })

/** ENS namehash: fold the labels in from the right, hashing as you go. */
export function namehash(name) {
  let node = '0x' + '00'.repeat(32)
  if (!name) return node
  for (const label of name.split('.').reverse()) {
    node = keccak256(`${node}${keccak256(stringToBytes(label)).slice(2)}`)
  }
  return node
}

/**
 * A name is available if nobody owns it. Deliberately a registry lookup rather
 * than a registrar call, so it answers for any name, not just second-level ones.
 */
export async function nameStatus(name) {
  const owner = await publicClient.readContract({
    address: ENS_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: 'owner',
    args: [namehash(name)],
  })
  const taken = owner !== '0x0000000000000000000000000000000000000000'
  return { name, owner, available: !taken }
}

/** What a name costs to register, straight from the registrar. */
export async function ensPrice(label, years = 1) {
  const price = await publicClient.readContract({
    address: ETH_CONTROLLER,
    abi: CONTROLLER_ABI,
    functionName: 'rentPrice',
    args: [label, YEAR * BigInt(years)],
  })
  const wei = price.base + price.premium
  return { wei: wei.toString(), eth: formatEther(wei), years }
}

export async function ensAvailable(label) {
  return publicClient.readContract({
    address: ETH_CONTROLLER,
    abi: CONTROLLER_ABI,
    functionName: 'available',
    args: [label],
  })
}

/**
 * What running this server costs, at the current gas price. Quoted per unit and
 * for a sample scale, so funding is a decision rather than a guess.
 */
export async function budget(label) {
  const gasPrice = await publicClient.getGasPrice()
  const at = (gas) => ({ wei: (gas * gasPrice).toString(), eth: formatEther(gas * gasPrice) })

  const perUser = GAS.subnameMint + GAS.subnameRecord
  const perTransfer = GAS.send + GAS.claim
  const deployGas = 610000n

  const registration = label ? await ensPrice(label).catch(() => null) : null

  const total =
    (registration ? BigInt(registration.wei) : 0n) +
    deployGas * gasPrice +
    perUser * 100n * gasPrice +
    perTransfer * 100n * gasPrice

  return {
    gasPriceGwei: (Number(gasPrice) / 1e9).toFixed(2),
    registration,
    deploy: at(deployGas),
    perUser: at(perUser),
    perTransfer: at(perTransfer),
    hundredUsers: at(perUser * 100n),
    hundredTransfers: at(perTransfer * 100n),
    suggested: formatEther(total),
  }
}

/**
 * Buy the server's own name.
 *
 * Two transactions with a mandated wait between them, so this is slow by
 * design — the caller is expected to be a long-running request or a job, not a
 * page waiting on a spinner.
 */
export async function registerEnsName(privateKey, label, years = 1) {
  const account = privateKeyToAccount(privateKey)
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) })

  if (!(await ensAvailable(label))) throw new Error(`${label}.eth is no longer available`)

  const duration = YEAR * BigInt(years)
  const secret = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`
  const args = [label, account.address, duration, secret, PUBLIC_RESOLVER, [], false, 0]

  const commitment = await publicClient.readContract({
    address: ETH_CONTROLLER, abi: REGISTRAR_ABI, functionName: 'makeCommitment', args,
  })

  const commitHash = await wallet.writeContract({
    address: ETH_CONTROLLER, abi: REGISTRAR_ABI, functionName: 'commit', args: [commitment],
  })
  await publicClient.waitForTransactionReceipt({ hash: commitHash })

  // The registrar refuses a reveal that comes too soon; a little margin on top
  // of the stated minimum costs nothing and avoids a wasted registration fee.
  const minAge = await publicClient
    .readContract({ address: ETH_CONTROLLER, abi: REGISTRAR_ABI, functionName: 'minCommitmentAge' })
    .catch(() => 60n)
  await new Promise((r) => setTimeout(r, (Number(minAge) + 5) * 1000))

  const price = await ensPrice(label, years)
  const registerHash = await wallet.writeContract({
    address: ETH_CONTROLLER, abi: REGISTRAR_ABI, functionName: 'register', args,
    // A few percent over, because the price can move between quote and reveal.
    value: (BigInt(price.wei) * 105n) / 100n,
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash: registerHash })
  if (receipt.status !== 'success') throw new Error('the registration transaction reverted')

  return {
    name: `${label}.eth`,
    owner: account.address,
    commitTx: commitHash,
    registerTx: registerHash,
    paid: formatEther((BigInt(price.wei) * 105n) / 100n),
  }
}

export async function balanceOf(address) {
  const wei = await publicClient.getBalance({ address })
  return { wei: wei.toString(), eth: formatEther(wei) }
}

export async function loadArtifact() {
  const file = path.join(__dirname, '..', 'contracts', 'artifacts', 'PineSignReceipts.json')
  return JSON.parse(await readFile(file, 'utf8'))
}

/** Deploy the receipt contract and wait for it to be mined. */
export async function deployReceipts(privateKey) {
  const artifact = await loadArtifact()
  const account = privateKeyToAccount(privateKey)
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) })

  const hash = await wallet.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error('the deployment transaction reverted')

  return { address: receipt.contractAddress, txHash: hash, blockNumber: Number(receipt.blockNumber) }
}

export async function estimateDeployCost() {
  const artifact = await loadArtifact()
  const gas = await publicClient.estimateGas({
    account: '0x0000000000000000000000000000000000000001',
    data: artifact.bytecode,
  })
  const price = await publicClient.getGasPrice()
  const wei = gas * price
  // Deployment is one transaction, but the deployer also sponsors subname
  // mints, so the suggested float is deliberately larger than the bare cost.
  return { gas: gas.toString(), wei: wei.toString(), eth: formatEther(wei), suggested: formatEther(wei * 20n) }
}

export { toHex }
