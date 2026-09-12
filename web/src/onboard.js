/**
 * The sign-up modal.
 *
 * Three things, in order: an account, the extension, a name. Each step reveals
 * itself only once the one before it is satisfied, so the modal never asks for
 * something that cannot yet be given.
 */

import { Gateway } from '../../shared/client.js'
import { extensionPresent, getIdentity, bridgeSigner } from '../../shared/bridge.js'
import { initSignIn, signInWithGoogle, currentWallet, sessionToken } from './signup.js'
import { renderAccountChip } from './session.js'

const el = (id) => document.getElementById(id)
const gateway = new Gateway(location.origin)

let identity = null
let wallet = null
let name = null
let ready = false
let signInAvailable = false

function status(node, message, kind = '') {
  const n = el(node)
  n.textContent = message
  n.className = `status ${kind}`.trim()
}

function mark(step, state) {
  el(step).className = state
}

export function openModal() {
  el('onboard').hidden = false
  document.body.style.overflow = 'hidden'
  if (!ready) boot()
}

export function closeModal() {
  el('onboard').hidden = true
  document.body.style.overflow = ''
}

// ---- steps ----

function renderAccount() {
  if (!wallet) return mark('s-account', 'todo')
  el('wallet').textContent = wallet.address
  el('wallet').hidden = false
  el('signin').hidden = true
  el('account-hint').textContent = 'Your wallet. It will own your name and sign for what you receive.'
  mark('s-account', 'done')
  renderAccountChip(openModal)
}

function renderExtension() {
  if (!identity) return mark('s-extension', 'todo')
  el('enc-key').textContent = identity.publicKey
  el('enc-key').hidden = false
  el('extension-install').hidden = true
  el('extension-hint').textContent = 'Installed. This key decrypts files sent to you.'
  mark('s-extension', 'done')
}

function renderName() {
  if (name) {
    el('your-name').textContent = name.name
    el('your-name').hidden = false
    el('claim-form').hidden = true
    el('done-note').hidden = false
    return mark('s-name', 'done')
  }

  const can = Boolean(identity && wallet)
  el('claim-form').hidden = false
  mark('s-name', can ? 'todo' : 'blocked')
  if (!can) {
    status('name-status', wallet ? 'Install the extension first.' : 'Sign in first.')
  } else {
    status('name-status', '')
  }
}

// ---- availability ----

let checkTimer = null
let checked = null

el('label').addEventListener('input', () => {
  checked = null
  el('claim').disabled = true
  el('label-check').textContent = ''
  el('label-check').className = 'resolved'

  const label = el('label').value.trim().toLowerCase()
  if (label.length < 3) return

  clearTimeout(checkTimer)
  el('label-check').textContent = 'checking…'
  checkTimer = setTimeout(async () => {
    try {
      const result = await gateway.nameAvailable(label)
      if (result.available) {
        checked = label
        el('label-check').textContent = `${result.name} is free.`
        el('label-check').className = 'resolved ok'
        el('claim').disabled = !(identity && wallet)
      } else {
        el('label-check').textContent = result.reason ?? 'Already taken.'
        el('label-check').className = 'resolved error'
      }
    } catch (err) {
      el('label-check').textContent = err.message
      el('label-check').className = 'resolved error'
    }
  }, 300)
})

el('claim').addEventListener('click', async () => {
  el('claim').disabled = true
  status('name-status', 'Claiming…')
  try {
    // Signed by the extension key; the wallet comes from the Circle token, which
    // the server verifies rather than taking our word for.
    name = await gateway.registerName(await bridgeSigner(), checked, sessionToken())
    status('name-status', '')
    renderName()
  } catch (err) {
    status('name-status', err.message, 'error')
    el('claim').disabled = false
  }
})

el('signin').addEventListener('click', async () => {
  el('signin').disabled = true
  status('signin-status', 'Starting…')
  try {
    await signInWithGoogle((m) => status('signin-status', m))
  } catch (err) {
    status('signin-status', err.message, 'error')
    el('signin').disabled = false
  }
})

// ---- boot ----

async function boot() {
  ready = true
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
    signInAvailable = true
    el('signin').disabled = false
    wallet = circle.wallet ?? currentWallet()
    renderAccount()
  }

  if (identity) {
    name = await gateway.reverseName(identity.publicKey)
  }
  renderName()
}

/**
 * Reopen the modal only when the user was explicitly sent back to it — the
 * callback page redirects to #get-started after Google. Merely having an
 * account is not a reason to interrupt someone who came to read the page.
 */
export function resumeIfReturning() {
  if (location.hash === '#get-started') openModal()
}

/**
 * Leaving for Google disables the button, and a browser restoring this page
 * from its cache brings that disabled state back with it — so someone who
 * changed their mind returns to a button that can never be pressed again.
 * Anything that puts the page back in front of the user has to undo it.
 */
function resetSignIn() {
  if (currentWallet() || !signInAvailable) return
  el('signin').disabled = false
  el('signin').hidden = false
  status('signin-status', '')
}

addEventListener('pageshow', resetSignIn)
addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') resetSignIn()
})
