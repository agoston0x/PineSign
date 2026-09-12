// web/src/signup.js
import { W3SSdk } from "https://cdn.jsdelivr.net/npm/@circle-fin/w3s-pw-web-sdk@1.1.11/+esm";
var STORE = "pinesign.circle";
var REDIRECT_URI = `${window.location.origin}/app.html`;
var sdk = null;
var config = null;
var session = load();
function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "null");
  } catch {
    return null;
  }
}
function save(patch) {
  session = { ...session ?? {}, ...patch };
  localStorage.setItem(STORE, JSON.stringify(session));
  return session;
}
function currentWallet() {
  return session?.wallet ?? null;
}
async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json;
}
async function finishSignIn({ userToken, encryptionKey }, onStep) {
  save({ userToken, encryptionKey });
  onStep?.("Creating your wallet\u2026");
  const init = await api("/api/circle/initialize", { userToken });
  if (init.challengeId) {
    onStep?.("Confirm in the Circle window\u2026");
    sdk.setAuthentication({ userToken, encryptionKey });
    await new Promise((resolve, reject) => {
      sdk.execute(init.challengeId, (error) => error ? reject(new Error(error.message)) : resolve());
    });
  }
  onStep?.("Reading your wallet\u2026");
  const { wallets } = await api("/api/circle/wallets", { userToken });
  const wallet = wallets?.[0];
  if (!wallet) throw new Error("Circle created no wallet for this account");
  save({ wallet: { id: wallet.id, address: wallet.address, blockchain: wallet.blockchain } });
  return wallet;
}
async function initSignIn({ onStep, onWallet, onError }) {
  config = await (await fetch("/api/circle/config")).json();
  if (!config.configured) return { configured: false };
  sdk = new W3SSdk({ appSettings: { appId: config.appId } }, async (error, result) => {
    if (error) return onError?.(new Error(error.message));
    if (!result) return;
    try {
      onWallet?.(await finishSignIn(result, onStep));
    } catch (err) {
      onError?.(err);
    }
  });
  if (session?.deviceToken) {
    sdk.updateConfigs({
      appSettings: { appId: config.appId },
      loginConfigs: {
        deviceToken: session.deviceToken,
        deviceEncryptionKey: session.deviceEncryptionKey,
        google: { clientId: config.googleClientId, redirectUri: REDIRECT_URI }
      }
    });
  }
  return { configured: true, wallet: currentWallet() };
}

// web/src/callback.js
var el = (id) => document.getElementById(id);
function say(message, kind = "") {
  el("cb-status").textContent = message;
  el("cb-status").className = `status ${kind}`.trim();
}
function done() {
  location.replace("/#get-started");
}
var circle = await initSignIn({
  onStep: say,
  onWallet: () => {
    say("Wallet ready. Taking you back\u2026", "done");
    setTimeout(done, 600);
  },
  onError: (err) => {
    say(err.message, "error");
    el("cb-back").hidden = false;
  }
});
if (!circle.configured) {
  say("This server has no Circle credentials configured.", "error");
  el("cb-back").hidden = false;
} else if (currentWallet()) {
  done();
} else {
  say("Completing sign-in\u2026");
  setTimeout(() => {
    if (!currentWallet()) {
      say("Sign-in did not complete.", "error");
      el("cb-back").hidden = false;
    }
  }, 15e3);
}
