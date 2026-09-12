/**
 * Lander: the three things a person needs before they can send anything.
 *
 * An account (Circle, via Google), the extension (which holds the encryption
 * key), and a name (which publishes that key so others can find it). Each step
 * unlocks the next, and the page reflects whatever is already done.
 */

import { Gateway } from '../../shared/client.js'
import { extensionPresent, getIdentity, bridgeSigner } from '../../shared/bridge.js'
import { initSignIn, signInWithGoogle, currentWallet } from './signup.js'

const el = (id) => document.getElementById(id)
const gateway = new Gateway(location.origin)

let identity = null
let wallet = null
let name = null

function mark(step, state) {
  el(step).className = state // 'todo' | 'done' | 'blocked'
}

function status(node, message, kind = '') {
  el(node).textContent = message
  el(node).className = `status ${kind}`.trim()
}

// ---- step 1: account ----

function renderAccount() {
  if (!wallet) return mark('s-account', 'todo')
  el('wallet').textContent = wallet.address
  el('wallet').hidden = false
  el('signin').hidden = true
  el('account-hint').textContent = 'Your wallet. It owns your name and signs for the files you receive.'
  mark('s-account', 'done')
}

// ---- step 2: extension ----

function renderExtension() {
  if (!identity) return mark('s-extension', 'todo')
  el('enc-key').textContent = identity.publicKey
  el('enc-key').hidden = false
  el('extension-install').hidden = true
  el('extension-hint').textContent = 'Installed. This is the key that will decrypt files sent to you.'
  mark('s-extension', 'done')
}

// ---- step 3: name ----

function renderName() {
  if (name) {
    el('your-name').textContent = name.name
    el('your-name').hidden = false
    el('claim-form').hidden = true
    el('name-actions').hidden = false
    return mark('s-name', 'done')
  }

  // A name binds the wallet to the encryption key, so it needs both.
  const ready = Boolean(identity && wallet)
  el('claim-form').hidden = false
  if (!ready) {
    status('name-status', identity ? 'Sign in first.' : 'Install the extension first.')
  } else {
    status('name-status', '')
  }
  mark('s-name', ready ? 'todo' : 'blocked')
}

async function refreshName() {
  name = identity ? await gateway.reverseName(identity.publicKey) : null
  renderName()
}

el('label').addEventListener('input', () => {
  const label = el('label').value.trim().toLowerCase()
  el('claim').disabled = !(identity && wallet && /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(label))
})

el('claim').addEventListener('click', async () => {
  el('claim').disabled = true
  status('name-status', 'Claiming…')
  try {
    // Signed by the extension key, recorded against the Circle wallet: one
    // record tying the person, their wallet, and the key files are sent to.
    const signer = await bridgeSigner()
    signer.address = wallet.address
    name = await gateway.registerName(signer, el('label').value.trim().toLowerCase())
    status('name-status', '')
    renderName()
  } catch (err) {
    status('name-status', err.message, 'error')
    el('claim').disabled = false
  }
})

el('copy-name').addEventListener('click', () => {
  navigator.clipboard.writeText(name.name)
  el('copy-name').textContent = 'Copied'
  setTimeout(() => (el('copy-name').textContent = 'Copy name'), 1200)
})

// ---- sign-in ----

el('signin').addEventListener('click', async () => {
  console.log('[pinesign] sign-in clicked')
  el('signin').disabled = true
  status('signin-status', 'Starting…')
  try {
    await signInWithGoogle((m) => {
      console.log('[pinesign]', m)
      status('signin-status', m)
    })
  } catch (err) {
    console.error('[pinesign] sign-in failed', err)
    status('signin-status', err.message, 'error')
    el('signin').disabled = false
  }
})

// ---- boot ----

async function boot() {
  // The sign-in button is live the moment the SDK is ready, so nothing here may
  // wait on anything it does not need. Extension discovery in particular is
  // allowed to be slow, and must not hold up Circle.
  el('signin').disabled = true

  const circleReady = initSignIn({
    onStep: (m) => status('signin-status', m),
    onWallet: (w) => {
      wallet = w
      status('signin-status', '')
      renderAccount()
      renderName()
    },
    onError: (err) => status('signin-status', err.message, 'error'),
  })

  const [health, hasExtension, circle] = await Promise.all([
    gateway.health().catch(() => null),
    extensionPresent(),
    circleReady,
  ])

  if (health?.parentName) el('suffix').textContent = `.${health.parentName}`

  if (hasExtension) identity = await getIdentity()
  renderExtension()

  if (!circle.configured) {
    el('account-hint').textContent = 'This server has no Circle credentials configured.'
    mark('s-account', 'blocked')
  } else {
    el('signin').disabled = false
    wallet = circle.wallet ?? currentWallet()
    renderAccount()
  }

  await refreshName()
}

/**
 * A failure in here used to leave the page looking merely inert, which is worse
 * than an error message: nothing to act on. Surface it instead.
 */
boot().catch((err) => {
  console.error('[pinesign] boot failed', err)
  status('signin-status', `Could not start: ${err.message}`, 'error')
})
