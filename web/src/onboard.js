/**
 * The sign-up modal.
 *
 * Three things, in order: an account, the extension, a name. Each step reveals
 * itself only once the one before it is satisfied, so the modal never asks for
 * something that cannot yet be given.
 */

import { Gateway } from '../../shared/client.js'
import { keyMode, identity as getIdentity, signer as getSigner } from '../../shared/keysource.js'
import { initSignIn, signInWithGoogle, currentWallet, sessionToken } from './signup.js'
import { renderAccountChip } from './session.js'

const el = (id) => document.getElementById(id)
const gateway = new Gateway(location.origin)

let identity = null
let wallet = null
let name = null
let ready = false
let signInAvailable = false

/**
 * The invitation this visit came from. Remembered across the Google sign-in
 * redirect, which returns to the site root and would otherwise lose the query
 * string — and with it the fact that this person was invited at all.
 */
const INVITE_KEY = 'pinesign.invite'
const fromUrl = new URLSearchParams(location.search).get('invite')
if (fromUrl) localStorage.setItem(INVITE_KEY, fromUrl)
const inviteId = fromUrl ?? localStorage.getItem(INVITE_KEY)

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

function renderExtension(mode) {
  el('enc-key').textContent = identity.publicKey
  el('enc-key').hidden = false
  if (mode === 'extension') {
    el('extension-install').hidden = true
    el('extension-hint').textContent = 'Installed. Your key lives there, out of reach of anything this site serves.'
  } else {
    el('extension-install').hidden = false
    el('extension-hint').textContent =
      'Your key is held in this browser for now — fine for receiving. Install the extension for maximum privacy, or to send.'
  }
  mark('s-extension', 'done')
}

function renderName() {
  // Named, but under a different key than the one this page now has (the
  // extension was installed after claiming): offer to move the name over,
  // since the extension is what sends.
  if (name && identity && name.pubKey !== identity.publicKey) {
    el('rebind').hidden = false
  } else {
    el('rebind').hidden = true
  }

  if (name) {
    el('your-name').textContent = name.name
    el('your-name').hidden = false
    el('claim-form').hidden = true
    el('done-note').hidden = false
    el('invite-banner').hidden = true
    refreshInvites()
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

// ---- invitations ----

function validEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

function checkInviteForm() {
  el('inv-send').disabled = !(validEmail(el('inv-to').value.trim()) && validEmail(el('inv-from').value.trim()))
}
el('inv-to').addEventListener('input', checkInviteForm)
el('inv-from').addEventListener('input', checkInviteForm)

el('inv-send').addEventListener('click', async () => {
  el('inv-send').disabled = true
  status('inv-status', 'Sending…')
  try {
    await gateway.invite(await getSigner(), {
      toEmail: el('inv-to').value.trim(),
      fromEmail: el('inv-from').value.trim(),
    })
    status('inv-status', `Invitation sent to ${el('inv-to').value.trim()}. You will get an email when they accept.`, 'done')
    el('inv-to').value = ''
    refreshInvites()
  } catch (err) {
    status('inv-status', err.message, 'error')
    checkInviteForm()
  }
})

async function refreshInvites() {
  try {
    const list = await gateway.myInvites(await getSigner())
    el('inv-list').hidden = list.length === 0
    el('inv-items').innerHTML = list
      .map((i) => {
        const state = i.status === 'accepted'
          ? `accepted as ${i.acceptedBy.name}`
          : i.status
        return `<li><span class="who">${i.toEmail}</span><span class="st ${i.status}">${state}</span></li>`
      })
      .join('')
  } catch {
    // Not fatal; the form still works.
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
    name = await gateway.registerName(await getSigner(), checked, sessionToken(), inviteId)
    localStorage.removeItem(INVITE_KEY) // used; a later visit is not an acceptance
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

async function showInvitation() {
  if (!inviteId) return
  try {
    const inv = await gateway.inviteStatus(inviteId)
    if (inv.status !== 'pending') return
    el('invite-from').textContent = inv.fromName
    el('invite-banner').hidden = false
  } catch {
    // An invalid link just gets the ordinary flow.
  }
}

async function boot() {
  ready = true
  el('signin').disabled = true
  showInvitation()

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

  const [health, mode, circle] = await Promise.all([
    gateway.health().catch(() => null),
    keyMode(),
    circleReady,
  ])

  if (health?.parentName) el('suffix').textContent = `.${health.parentName}`

  // A key exists either way — in the extension if installed, else in this page.
  identity = await getIdentity()
  renderExtension(mode)

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
