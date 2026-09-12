/**
 * Google sign-in callback.
 *
 * Google will only return to a URI registered with it, so the redirect lands
 * here rather than on the lander. This page exists to receive the login result,
 * let Circle finish provisioning the wallet, and send the user back to where
 * they started.
 */

import { initSignIn, currentWallet } from './signup.js'

const el = (id) => document.getElementById(id)

function say(message, kind = '') {
  el('cb-status').textContent = message
  el('cb-status').className = `status ${kind}`.trim()
}

function done() {
  location.replace('/#get-started')
}

const circle = await initSignIn({
  onStep: say,
  onWallet: () => {
    say('Wallet ready. Taking you back…', 'done')
    setTimeout(done, 600)
  },
  onError: (err) => {
    say(err.message, 'error')
    el('cb-back').hidden = false
  },
})

// Nothing to complete: either the session is already good, or the user opened
// this page directly.
if (!circle.configured) {
  say('This server has no Circle credentials configured.', 'error')
  el('cb-back').hidden = false
} else if (currentWallet()) {
  done()
} else {
  say('Completing sign-in…')
  // If Google never returns a result, do not leave the user staring at this.
  setTimeout(() => {
    if (!currentWallet()) {
      say('Sign-in did not complete.', 'error')
      el('cb-back').hidden = false
    }
  }, 15000)
}
