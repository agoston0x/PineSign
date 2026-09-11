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
