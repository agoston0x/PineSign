// web/src/signup.js
import { W3SSdk } from "https://cdn.jsdelivr.net/npm/@circle-fin/w3s-pw-web-sdk@1.1.11/+esm";
var STORE = "pinesign.circle";
var REDIRECT_URI = `${window.location.origin}/app.html`;
var session = load();
function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "null");
  } catch {
    return null;
  }
}
function clearSession() {
  session = null;
  localStorage.removeItem(STORE);
}
function currentWallet() {
  return session?.wallet ?? null;
}

// web/src/session.js
var short = (addr) => `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`;
function renderAccountChip(onGetStarted) {
  const slot = document.getElementById("account-slot");
  if (!slot) return;
  const wallet = currentWallet();
  if (!wallet) {
    slot.innerHTML = "";
    const chip = document.createElement(onGetStarted ? "button" : "a");
    chip.className = "cta-btn";
    chip.textContent = "Get started";
    if (onGetStarted) {
      chip.addEventListener("click", onGetStarted);
    } else {
      chip.href = "/#get-started";
    }
    slot.append(chip);
    return;
  }
  slot.innerHTML = `
    <div class="account-chip" tabindex="0">
      <span class="dot"></span>
      <span class="addr">${short(wallet.address)}</span>
      <div class="account-menu">
        <div class="full">${wallet.address}</div>
        <button class="signout">Sign out</button>
      </div>
    </div>`;
  slot.querySelector(".signout").addEventListener("click", () => {
    clearSession();
    location.reload();
  });
}

// web/src/nav.js
renderAccountChip();
