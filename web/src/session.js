/**
 * The account chip in the nav, shared by every page.
 *
 * Signed out it reads "Get started"; signed in it shows the wallet address and
 * offers to sign out. One element, two states, so the nav never lies about
 * whether you have an account.
 */

import { currentWallet, clearSession } from './signup.js'

const short = (addr) => `${addr.slice(0, 6)}…${addr.slice(-4)}`

/**
 * @param onGetStarted - called when a signed-out visitor clicks the chip.
 *   Omit it on pages with no sign-up UI of their own and the chip becomes a
 *   link to the one page that has.
 */
export function renderAccountChip(onGetStarted) {
  const slot = document.getElementById('account-slot')
  if (!slot) return

  const wallet = currentWallet()

  if (!wallet) {
    slot.innerHTML = ''
    const chip = document.createElement(onGetStarted ? 'button' : 'a')
    chip.className = 'cta-btn'
    chip.textContent = 'Get started'
    if (onGetStarted) {
      chip.addEventListener('click', onGetStarted)
    } else {
      chip.href = '/#get-started'
    }
    slot.append(chip)
    return
  }

  slot.innerHTML = `
    <div class="account-chip" tabindex="0">
      <span class="dot"></span>
      <span class="addr">${short(wallet.address)}</span>
      <div class="account-menu">
        <div class="full">${wallet.address}</div>
        <button class="signout">Sign out</button>
      </div>
    </div>`

  slot.querySelector('.signout').addEventListener('click', () => {
    clearSession()
    location.reload()
  })
}
