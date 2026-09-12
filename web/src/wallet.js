/**
 * Browser wallet, for funding the server.
 *
 * Plain EIP-1193 — no library. MetaMask, Phantom and the rest all inject the
 * same interface, so asking for it directly works everywhere and adds nothing
 * to the bundle.
 *
 * This is the one place a person's own wallet is used. It sends Sepolia ETH to
 * the server's address and does nothing else; the server never sees a key and
 * the site never asks for a signature.
 */

const SEPOLIA = '0xaa36a7' // 11155111
const GNOSIS = '0x64' // 100

const CHAINS = {
  [SEPOLIA]: {
    chainId: SEPOLIA,
    chainName: 'Sepolia',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
    blockExplorerUrls: ['https://sepolia.etherscan.io'],
  },
  [GNOSIS]: {
    chainId: GNOSIS,
    chainName: 'Gnosis',
    nativeCurrency: { name: 'xDAI', symbol: 'xDAI', decimals: 18 },
    rpcUrls: ['https://rpc.gnosischain.com'],
    blockExplorerUrls: ['https://gnosisscan.io'],
  },
}

function provider() {
  const injected = window.ethereum
  if (!injected) throw new Error('No browser wallet found. Install MetaMask or Phantom.')
  return injected
}

export function walletPresent() {
  return Boolean(window.ethereum)
}

/** The wallet's name, for a button that says what it will open. */
export function walletName() {
  const p = window.ethereum
  if (!p) return null
  if (p.isMetaMask) return 'MetaMask'
  if (p.isPhantom) return 'Phantom'
  if (p.isRabby) return 'Rabby'
  return 'your wallet'
}

export async function connect() {
  const p = provider()
  const accounts = await p.request({ method: 'eth_requestAccounts' })
  if (!accounts?.length) throw new Error('No account was shared')
  await ensureSepolia()
  return accounts[0]
}

/**
 * Put the wallet on the right chain before asking for value.
 *
 * Two chains are in play here and they hold different money: the server runs on
 * Sepolia, the Bee node on Gnosis. Sending to the right address on the wrong
 * chain is a mistake with no undo, so the switch is never left to the user.
 */
async function ensureChain(chainId) {
  const p = provider()
  if ((await p.request({ method: 'eth_chainId' })) === chainId) return

  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] })
  } catch (err) {
    // 4902: the wallet has never heard of this chain.
    if (err.code !== 4902) throw err
    await p.request({ method: 'wallet_addEthereumChain', params: [CHAINS[chainId]] })
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] })
  }
}

const ensureSepolia = () => ensureChain(SEPOLIA)

export async function currentAccount() {
  if (!walletPresent()) return null
  const accounts = await provider().request({ method: 'eth_accounts' })
  return accounts?.[0] ?? null
}

/** Send value to the server's wallet on Sepolia. Returns the transaction hash. */
export async function send({ to, wei }) {
  const from = (await currentAccount()) ?? (await connect())
  await ensureSepolia()

  return provider().request({
    method: 'eth_sendTransaction',
    params: [{ from, to, value: `0x${BigInt(wei).toString(16)}` }],
  })
}

const pad = (hex) => hex.replace(/^0x/, '').padStart(64, '0')

/** Send native xDAI on Gnosis — what the Bee node needs for gas. */
export async function sendXdai({ to, wei }) {
  const from = (await currentAccount()) ?? (await connect())
  await ensureChain(GNOSIS)

  return provider().request({
    method: 'eth_sendTransaction',
    params: [{ from, to, value: `0x${BigInt(wei).toString(16)}` }],
  })
}

/**
 * Send an ERC-20 on Gnosis — BZZ, for postage and retrieval.
 *
 * The transfer call is encoded by hand rather than pulling a library into this
 * bundle: it is a selector and two padded words.
 */
export async function sendToken({ token, to, amount }) {
  const from = (await currentAccount()) ?? (await connect())
  await ensureChain(GNOSIS)

  const data = `0xa9059cbb${pad(to)}${pad(BigInt(amount).toString(16))}`
  return provider().request({
    method: 'eth_sendTransaction',
    params: [{ from, to: token, data }],
  })
}

export function onAccountsChanged(handler) {
  window.ethereum?.on?.('accountsChanged', handler)
}

/** Sign a plain message — used to prove control of the admin wallet. */
export async function signMessage(message) {
  const from = (await currentAccount()) ?? (await connect())
  const signature = await provider().request({
    method: 'personal_sign',
    params: [message, from],
  })
  return { address: from, signature }
}
