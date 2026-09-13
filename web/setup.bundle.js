// web/src/wallet.js
var SEPOLIA = "0xaa36a7";
var GNOSIS = "0x64";
var CHAINS = {
  [SEPOLIA]: {
    chainId: SEPOLIA,
    chainName: "Sepolia",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
    blockExplorerUrls: ["https://sepolia.etherscan.io"]
  },
  [GNOSIS]: {
    chainId: GNOSIS,
    chainName: "Gnosis",
    nativeCurrency: { name: "xDAI", symbol: "xDAI", decimals: 18 },
    rpcUrls: ["https://rpc.gnosischain.com"],
    blockExplorerUrls: ["https://gnosisscan.io"]
  }
};
function provider() {
  const injected = window.ethereum;
  if (!injected) throw new Error("No browser wallet found. Install MetaMask or Phantom.");
  return injected;
}
function walletPresent() {
  return Boolean(window.ethereum);
}
function walletName() {
  const p = window.ethereum;
  if (!p) return null;
  if (p.isMetaMask) return "MetaMask";
  if (p.isPhantom) return "Phantom";
  if (p.isRabby) return "Rabby";
  return "your wallet";
}
async function connect() {
  const p = provider();
  const accounts = await p.request({ method: "eth_requestAccounts" });
  if (!accounts?.length) throw new Error("No account was shared");
  await ensureSepolia();
  return accounts[0];
}
async function ensureChain(chainId) {
  const p = provider();
  if (await p.request({ method: "eth_chainId" }) === chainId) return;
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (err) {
    if (err.code !== 4902) throw err;
    await p.request({ method: "wallet_addEthereumChain", params: [CHAINS[chainId]] });
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  }
}
var ensureSepolia = () => ensureChain(SEPOLIA);
async function currentAccount() {
  if (!walletPresent()) return null;
  const accounts = await provider().request({ method: "eth_accounts" });
  return accounts?.[0] ?? null;
}
async function send({ to, wei }) {
  const from = await currentAccount() ?? await connect();
  await ensureSepolia();
  return provider().request({
    method: "eth_sendTransaction",
    params: [{ from, to, value: `0x${BigInt(wei).toString(16)}` }]
  });
}
var pad = (hex) => hex.replace(/^0x/, "").padStart(64, "0");
async function sendXdai({ to, wei }) {
  const from = await currentAccount() ?? await connect();
  await ensureChain(GNOSIS);
  return provider().request({
    method: "eth_sendTransaction",
    params: [{ from, to, value: `0x${BigInt(wei).toString(16)}` }]
  });
}
async function sendToken({ token: token2, to, amount }) {
  const from = await currentAccount() ?? await connect();
  await ensureChain(GNOSIS);
  const data = `0xa9059cbb${pad(to)}${pad(BigInt(amount).toString(16))}`;
  return provider().request({
    method: "eth_sendTransaction",
    params: [{ from, to: token2, data }]
  });
}
async function signMessage(message) {
  const from = await currentAccount() ?? await connect();
  const signature = await provider().request({
    method: "personal_sign",
    params: [message, from]
  });
  return { address: from, signature };
}

// web/src/setup.js
var BZZ_TOKEN = "0xdBF3Ea6F5beE45c02255B2c26a16F300502F68da";
var BZZ_DECIMALS = 16n;
var el = (id) => document.getElementById(id);
var token = new URLSearchParams(location.search).get("token") ?? localStorage.getItem("pinesign.setupToken") ?? "";
var session = localStorage.getItem("pinesign.adminSession") ?? "";
var adminAddress = null;
var pollTimer = null;
var viewing = null;
var latest = null;
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      // Either proof is enough; the session is preferred and the token remains
      // as recovery for an admin who has lost the wallet.
      ...session ? { "x-admin-session": session } : {},
      ...token ? { "x-setup-token": token } : {},
      ...options.headers ?? {}
    }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? res.statusText), { status: res.status });
  return body;
}
function status(node, message, kind = "") {
  el(node).textContent = message;
  el(node).className = `status ${kind}`.trim();
}
var STEPS = ["name", "keys", "fund", "swarm"];
function showOnly(step) {
  for (const s of ["locked", "step-name", "step-keys", "step-fund", "step-swarm", "step-done"]) {
    el(s).hidden = true;
  }
  el(step).hidden = false;
}
function renderProgress(serverStep, shownStep) {
  const at = STEPS.indexOf(serverStep);
  const shown = STEPS.indexOf(shownStep);
  for (const li of el("progress").children) {
    const i = STEPS.indexOf(li.dataset.step);
    const done = at === -1 || i < at;
    li.className = i === shown ? "current" : done ? "done" : "";
    const revisitable = done && (li.dataset.step !== "name" || latest?.canChangeName);
    li.classList.toggle("clickable", Boolean(revisitable));
    li.onclick = revisitable ? () => {
      viewing = li.dataset.step;
      render(latest);
    } : null;
  }
}
function renderPackages(state) {
  const box = el("packages");
  const setUp = state.nameRegistered && state.receiptsAddress;
  const packages = (setUp ? state.budget?.topUpPackages : state.budget?.setupPackages) ?? [];
  if (!walletPresent()) {
    box.innerHTML = "";
    el("pay-hint").textContent = "No browser wallet detected. Install MetaMask or Phantom to pay from here, or send to the address in the top right by hand.";
    return;
  }
  el("pay-hint").textContent = `Pick what this server should be able to do. Paid from ${walletName()} on Sepolia.`;
  box.innerHTML = "";
  for (const pkg of packages) {
    const button = document.createElement("button");
    button.className = "package";
    const price = pkg.alreadyCovered ? "covered" : Number(pkg.wei) < Number(pkg.target) ? `+${Number(pkg.eth).toFixed(4)} ETH` : `${Number(pkg.eth).toFixed(4)} ETH`;
    const note = pkg.alreadyCovered ? `${pkg.note} \u2014 already funded` : pkg.note;
    button.innerHTML = `
      <span class="pk-top">
        <span class="pk-name">${pkg.label}</span>
        <span class="pk-price">${price}</span>
      </span>
      <span class="pk-note">${note}</span>`;
    button.disabled = pkg.alreadyCovered;
    button.addEventListener("click", async () => {
      for (const b of box.children) b.disabled = true;
      status("pay-status", `Confirm ${Number(pkg.eth).toFixed(4)} ETH in your wallet\u2026`);
      try {
        const hash = await send({ to: state.deployer, wei: pkg.wei });
        status("pay-status", `Sent. Waiting for it to land \u2014 ${hash.slice(0, 12)}\u2026`, "done");
        clearTimeout(pollTimer);
        pollTimer = setTimeout(refresh, 4e3);
      } catch (err) {
        status("pay-status", err.code === 4001 ? "" : err.message, err.code === 4001 ? "" : "error");
        for (const b of box.children) b.disabled = false;
      }
    });
    box.append(button);
  }
}
function renderWalletBar(state) {
  if (!state.deployer) {
    el("bar-wallet").hidden = true;
    return;
  }
  el("bar-wallet").hidden = false;
  el("bar-address").textContent = `${state.deployer.slice(0, 10)}\u2026${state.deployer.slice(-6)}`;
  el("bar-address").title = state.deployer;
  const eth = state.balance ? Number(state.balance.eth) : null;
  el("bar-balance").textContent = eth === null ? "balance unknown" : `${eth.toFixed(5)} ETH`;
  el("bar-balance").className = `wc-balance${eth === 0 ? " empty" : ""}`;
}
function renderNodeBar(bee) {
  const address = bee?.wallet?.address;
  if (!address) {
    el("bar-node").hidden = true;
    return;
  }
  el("bar-node").hidden = false;
  el("bar-node-address").textContent = `${address.slice(0, 10)}\u2026${address.slice(-6)}`;
  el("bar-node-address").title = address;
  if (!bee.balancesKnown) {
    el("bar-node-balance").textContent = "syncing\u2026";
    el("bar-node-balance").className = "wc-balance";
    return;
  }
  const bzz = Number(bee.wallet.bzz?.formatted ?? 0);
  const xdai = Number(bee.wallet.xdai?.formatted ?? 0);
  el("bar-node-balance").textContent = `${bzz.toFixed(3)} BZZ \xB7 ${xdai.toFixed(4)} xDAI`;
  el("bar-node-balance").className = `wc-balance${bzz === 0 || xdai === 0 ? " empty" : ""}`;
}
function renderBee(bee) {
  if (!bee || !bee.reachable) {
    el("b-status").textContent = "not reachable";
    el("b-missing").hidden = false;
    el("b-funding").hidden = true;
    el("buy-postage").disabled = true;
    return;
  }
  el("b-missing").hidden = true;
  el("b-status").textContent = bee.ready ? "running" : `starting (${bee.status ?? "wait"})`;
  el("b-version").textContent = bee.version ?? "\u2014";
  if (bee.wallet) {
    el("b-funding").hidden = false;
    el("b-wallet").textContent = bee.wallet.address;
    el("b-balances").textContent = bee.balancesKnown ? `${bee.wallet.bzz?.formatted ?? "?"} BZZ \xB7 ${bee.wallet.xdai?.formatted ?? "?"} xDAI` : "balances available once the node has synced";
  }
  if (bee.quote) {
    el("stamp-quote").hidden = false;
    el("q-ttl").textContent = `${bee.quote.ttlDays.toFixed(1)} days`;
    el("q-capacity").textContent = `${(bee.quote.capacityBytes / 1024 / 1024).toFixed(0)} MB`;
    el("q-cost").textContent = `${bee.quote.costBzz.toFixed(4)} BZZ`;
  }
  const held = Number(bee.wallet?.bzz?.formatted ?? 0);
  const affordable = !bee.quote || held >= bee.quote.costBzz;
  const funded = held > 0;
  el("buy-postage").disabled = !(bee.ready && funded && affordable);
  if (!bee.ready) {
    status(
      "swarm-status",
      "The node is syncing \u2014 this takes a few minutes on first boot. You can send it BZZ and xDAI now; it needs them to finish."
    );
  } else if (!funded) {
    status("swarm-status", "Send BZZ and xDAI on Gnosis to the node address above.");
  } else if (!affordable) {
    status("swarm-status", `This batch costs ${bee.quote.costBzz.toFixed(4)} BZZ and the node holds ${held.toFixed(4)}. Send more BZZ.`, "error");
  } else {
    status("swarm-status", "Funded. Ready to buy a batch.", "done");
  }
}
function render(state) {
  latest = state;
  el("bar-admin").hidden = !adminAddress;
  if (adminAddress) el("bar-admin-address").textContent = `${adminAddress.slice(0, 6)}\u2026${adminAddress.slice(-4)}`;
  el("rpc").textContent = `RPC: ${state.rpcUrl}`;
  renderWalletBar(state);
  renderNodeBar(state.bee);
  const step = viewing ?? state.step;
  renderProgress(state.step, step);
  if (viewing && viewing !== state.step) {
    showOnly(`step-${viewing}`);
    if (viewing === "name") {
      el("subtitle").textContent = `Currently ${state.parentName}. Change it if you like.`;
      el("name").value = (state.parentName ?? "").replace(/\.eth$/, "");
      el("name-check").textContent = "";
      el("name-check").className = "availability";
      el("save-name").disabled = true;
      return;
    }
    if (viewing === "keys") {
      el("subtitle").textContent = "Already done.";
      el("gen-keys").hidden = Boolean(state.deployer);
      status(
        "keys-status",
        state.deployer ? `This server's wallet is ${state.deployer}. It cannot be replaced \u2014 the name and contract belong to it.` : "",
        state.deployer ? "done" : ""
      );
      return;
    }
    el("subtitle").textContent = "Looking back.";
    return;
  }
  el("gen-keys").hidden = false;
  if (state.step === "name") {
    showOnly("step-name");
    el("subtitle").textContent = "Nothing configured yet.";
    return;
  }
  if (state.step === "keys") {
    showOnly("step-keys");
    el("subtitle").textContent = `Issuing subnames under ${state.parentName}.`;
    return;
  }
  if (state.step === "fund") {
    showOnly("step-fund");
    el("subtitle").textContent = "Waiting for gas.";
    const eth = (v, digits = 6) => v ? `${Number(v.eth).toFixed(digits)} ETH` : "\u2014";
    el("fund-tip").hidden = Boolean(state.canRegisterName && state.fundedEnough);
    const b = state.budget;
    renderPackages(state);
    el("gas-note").textContent = b ? `at ${b.gasPriceGwei} gwei, the current gas price` : "at current gas";
    el("c-name").textContent = state.parentName ?? "the name";
    el("c-domain").textContent = state.nameRegistered ? "already registered" : "gas only";
    el("c-fee").textContent = state.registrationFee ? `${state.registrationFee} \u2014 minted by the server, free on testnet` : "\u2014";
    el("c-deploy").textContent = eth(b?.deploy);
    el("c-user").textContent = eth(b?.perUser);
    el("c-transfer").textContent = eth(b?.perTransfer);
    el("c-100users").textContent = eth(b?.hundredUsers, 4);
    el("c-100transfers").textContent = eth(b?.hundredTransfers, 4);
    el("c-suggested").textContent = b ? `${Number(b.suggested).toFixed(4)} ETH` : "\u2014";
    if (state.registrationAvailable === false) {
      status("deploy-status", state.registrationBlockedReason ?? "Registration is unavailable on this network.", "error");
    }
    const showRegister = state.nameAvailable && !state.nameRegistered && state.registrationAvailable !== false;
    el("register-name").hidden = !showRegister;
    el("register-name").disabled = !state.canRegisterName;
    if (showRegister) {
      el("register-name").textContent = state.canRegisterName ? `Register ${state.parentName}` : `Need ${Number(state.registrationShortfall ?? 0).toFixed(4)} ETH more to register`;
    }
    el("deploy").disabled = !state.fundedEnough || Boolean(state.receiptsAddress);
    el("deploy").textContent = state.receiptsAddress ? "Contract deployed" : "Deploy the contract";
    el("attach-resolver").hidden = !state.canAttachResolver;
    el("resolver-hint").hidden = !state.canAttachResolver;
    const outstanding = [];
    if (!state.nameRegistered) outstanding.push("register the name");
    if (state.canAttachResolver) outstanding.push("attach the resolver");
    if (!state.receiptsAddress) outstanding.push("deploy the contract");
    if (state.registrationAvailable === false) {
    } else if (!state.fundedEnough) {
      status("deploy-status", "Send Sepolia ETH to the address above.");
    } else if (outstanding.length) {
      status("deploy-status", `Funded. Still to do: ${outstanding.join(" and ")}.`, "done");
    } else {
      status("deploy-status", "Done.", "done");
    }
    clearTimeout(pollTimer);
    if (!state.fundedEnough) pollTimer = setTimeout(refresh, 5e3);
    return;
  }
  if (state.step === "swarm") {
    showOnly("step-swarm");
    el("subtitle").textContent = "One thing left: storage.";
    renderBee(state.bee);
    clearTimeout(pollTimer);
    if (!state.bee?.reachable || !state.bee?.ready) pollTimer = setTimeout(refresh, 8e3);
    return;
  }
  showOnly("step-done");
  el("subtitle").textContent = "Configured and running.";
  el("d-name").textContent = state.parentName;
  el("d-registered").textContent = state.nameRegistered ? state.resolver ? `yes, resolver ${state.resolver.slice(0, 10)}\u2026` : "yes, no resolver" : "no \u2014 names are local only";
  el("d-address").textContent = state.receiptsAddress;
  el("d-tx").textContent = state.deployTx;
  el("d-deployer").textContent = state.deployer;
  el("d-storage").textContent = state.postageBatchId ? state.bee?.reachable ? "swarm" : "swarm (node unreachable)" : "local folder";
  el("d-batch").textContent = state.postageBatchId ? `${state.postageBatchId.slice(0, 14)}\u2026` : "none";
  el("d-balance").textContent = state.balance ? `${Number(state.balance.eth).toFixed(5)} ETH` : "balance unknown";
  if (state.balance && state.budget) {
    const left = BigInt(state.balance.wei);
    const users = Number(left / BigInt(state.budget.perUser.wei));
    const transfers = Number(left / BigInt(state.budget.perTransfer.wei));
    el("d-runway").textContent = left === 0n ? "Empty. Fund this wallet or the server cannot issue names or record receipts." : `Enough for roughly ${users.toLocaleString()} more users, or ${transfers.toLocaleString()} more transfers, at ${state.budget.gasPriceGwei} gwei.`;
  }
}
async function refresh() {
  try {
    if (!adminAddress && !session) {
      const { adminAddress: owner } = await (await fetch("/api/setup/admin")).json();
      if (!owner) return showSignIn();
      adminAddress = owner;
    }
    render(await api("/api/setup/status"));
  } catch (err) {
    if (err.status === 401) return showSignIn();
    el("subtitle").textContent = err.message;
  }
}
async function fundNode(kind) {
  const to = el("b-wallet").textContent.trim();
  if (!to.startsWith("0x")) return;
  const buttons = [el("send-xdai"), el("send-bzz")];
  for (const b of buttons) b.disabled = true;
  status("node-fund-status", "Confirm in your wallet \u2014 it will switch to Gnosis first\u2026");
  try {
    const hash = kind === "xdai" ? await sendXdai({ to, wei: 50000000000000000n }) : await sendToken({ token: BZZ_TOKEN, to, amount: 10n * 10n ** BZZ_DECIMALS });
    status("node-fund-status", `Sent \u2014 ${hash.slice(0, 12)}\u2026 The node picks it up within a minute.`, "done");
    clearTimeout(pollTimer);
    pollTimer = setTimeout(refresh, 6e3);
  } catch (err) {
    status("node-fund-status", err.code === 4001 ? "" : err.message, err.code === 4001 ? "" : "error");
  } finally {
    for (const b of buttons) b.disabled = false;
  }
}
el("send-xdai").addEventListener("click", () => fundNode("xdai"));
el("send-bzz").addEventListener("click", () => fundNode("bzz"));
el("fund-test").addEventListener("click", async () => {
  const to = el("b-wallet").textContent.trim();
  if (!to.startsWith("0x")) return;
  const buttons = [el("fund-test"), el("send-xdai"), el("send-bzz")];
  for (const b of buttons) b.disabled = true;
  try {
    status("node-fund-status", "Confirm the first of two: 0.02 xDAI for gas\u2026");
    await sendXdai({ to, wei: 20000000000000000n });
    status("node-fund-status", "Now the second: 1 BZZ for postage\u2026");
    const hash = await sendToken({ token: BZZ_TOKEN, to, amount: 1n * 10n ** BZZ_DECIMALS });
    status("node-fund-status", `Both sent \u2014 ${hash.slice(0, 12)}\u2026 The node needs a minute to notice.`, "done");
    clearTimeout(pollTimer);
    pollTimer = setTimeout(refresh, 6e3);
  } catch (err) {
    status(
      "node-fund-status",
      err.code === 4001 ? "Cancelled. Anything already sent has still arrived." : err.message,
      err.code === 4001 ? "" : "error"
    );
  } finally {
    for (const b of buttons) b.disabled = false;
  }
});
el("b-copy").addEventListener("click", () => {
  navigator.clipboard.writeText(el("b-wallet").textContent);
  el("b-copy").textContent = "Copied";
  setTimeout(() => el("b-copy").textContent = "Copy address", 1200);
});
el("b-refresh").addEventListener("click", refresh);
el("buy-postage").addEventListener("click", async () => {
  el("buy-postage").disabled = true;
  clearTimeout(pollTimer);
  status("swarm-status", "Buying postage \u2014 the node is waiting on Gnosis\u2026");
  try {
    render(await api("/api/setup/postage", { method: "POST", body: JSON.stringify({}) }));
  } catch (err) {
    status("swarm-status", err.message, "error");
    el("buy-postage").disabled = false;
  }
});
el("bar-node-copy").addEventListener("click", () => {
  navigator.clipboard.writeText(el("bar-node-address").title);
  el("bar-node-copy").textContent = "ok";
  setTimeout(() => el("bar-node-copy").textContent = "copy", 1200);
});
el("bar-copy").addEventListener("click", () => {
  navigator.clipboard.writeText(el("bar-address").title);
  el("bar-copy").textContent = "ok";
  setTimeout(() => el("bar-copy").textContent = "copy", 1200);
});
el("d-copy").addEventListener("click", () => {
  navigator.clipboard.writeText(el("d-deployer").textContent);
  el("d-copy").textContent = "Copied";
  setTimeout(() => el("d-copy").textContent = "Copy address", 1200);
});
el("d-refresh").addEventListener("click", refresh);
async function showSignIn() {
  showOnly("locked");
  el("subtitle").textContent = "Locked.";
  const { adminAddress: owner } = await (await fetch("/api/setup/admin")).json();
  const claimed = Boolean(owner);
  el("claim-block").hidden = claimed;
  if (!claimed && token) el("token").value = token;
  el("lock-title").textContent = claimed ? "Sign in as administrator" : "Claim this server";
  el("lock-hint").textContent = claimed ? `This server is administered by ${owner.slice(0, 10)}\u2026${owner.slice(-6)}. Sign in with that wallet.` : "Connect a wallet to become the administrator of this server.";
  if (!walletPresent()) {
    el("wallet-signin").disabled = true;
    status("lock-status", "No browser wallet found. Use the console token below instead.");
  } else {
    el("wallet-signin").textContent = `Sign in with ${walletName()}`;
  }
}
el("wallet-signin").addEventListener("click", async () => {
  el("wallet-signin").disabled = true;
  status("lock-status", "Connecting\u2026");
  try {
    const address = await connect();
    status("lock-status", "Check your wallet for a message to sign\u2026");
    const { nonce, message } = await (await fetch("/api/setup/admin/nonce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address })
    })).json();
    const signed = await signMessage(message);
    const res = await fetch("/api/setup/admin/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: signed.address,
        nonce,
        signature: signed.signature,
        // Only consulted on a first run, to claim an unowned server.
        token: el("token").value.trim() || token
      })
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    session = body.session;
    adminAddress = body.address;
    token = "";
    localStorage.removeItem("pinesign.setupToken");
    localStorage.setItem("pinesign.adminSession", session);
    status("lock-status", "");
    await refresh();
  } catch (err) {
    status("lock-status", err.code === 4001 ? "Signature declined." : err.message, "error");
    el("wallet-signin").disabled = false;
  }
});
el("bar-signout").addEventListener("click", async () => {
  await fetch("/api/setup/admin/signout", { method: "POST", headers: { "x-admin-session": session } });
  localStorage.removeItem("pinesign.adminSession");
  session = "";
  location.reload();
});
el("unlock").addEventListener("click", async () => {
  token = el("token-only").value.trim();
  localStorage.setItem("pinesign.setupToken", token);
  status("lock-status", "Checking\u2026");
  await refresh();
});
var checkTimer = null;
el("name").addEventListener("input", () => {
  const label = el("name").value.trim().toLowerCase().replace(/\.eth$/, "");
  const name = `${label}.eth`;
  el("save-name").disabled = true;
  el("name-check").textContent = "";
  el("name-check").className = "availability";
  if (!/^[a-z0-9-]{3,}$/.test(label)) return;
  clearTimeout(checkTimer);
  el("name-check").textContent = "checking\u2026";
  el("name-check").className = "availability";
  checkTimer = setTimeout(async () => {
    try {
      const result = await api(`/api/setup/name/${name}`);
      const free = result.available;
      const onSepolia = result.sepolia?.available;
      const onMainnet = result.mainnet?.available;
      if (free) {
        el("name-check").textContent = `${name} is free on Sepolia and mainnet.`;
        el("name-check").className = "availability free";
      } else if (!onSepolia) {
        el("name-check").textContent = `${name} is already taken on Sepolia.`;
        el("name-check").className = "availability taken";
      } else if (onMainnet === false) {
        const until = result.mainnet.expires ? ` until ${result.mainnet.expires.slice(0, 10)}` : "";
        el("name-check").textContent = `${name} is free on Sepolia but owned on mainnet${until} \u2014 you could not keep it beyond the testnet.`;
        el("name-check").className = "availability taken";
      } else {
        el("name-check").textContent = `${name} is free on Sepolia; mainnet could not be checked.`;
        el("name-check").className = "availability";
      }
      el("save-name").disabled = false;
    } catch (err) {
      el("name-check").textContent = err.message;
      el("name-check").className = "availability bad";
    }
  }, 400);
});
el("save-name").addEventListener("click", async () => {
  el("save-name").disabled = true;
  viewing = null;
  try {
    const label = el("name").value.trim().toLowerCase().replace(/\.eth$/, "");
    render(await api("/api/setup/name", { method: "POST", body: JSON.stringify({ name: `${label}.eth` }) }));
  } catch (err) {
    el("name-check").textContent = err.message;
    el("name-check").className = "availability bad";
    el("save-name").disabled = false;
  }
});
el("gen-keys").addEventListener("click", async () => {
  el("gen-keys").disabled = true;
  status("keys-status", "Generating\u2026");
  try {
    render(await api("/api/setup/keys", { method: "POST" }));
  } catch (err) {
    status("keys-status", err.message, "error");
    el("gen-keys").disabled = false;
  }
});
el("register-name").addEventListener("click", async () => {
  el("register-name").disabled = true;
  clearTimeout(pollTimer);
  status("deploy-status", "Registering \u2014 this takes two transactions and a minute between them\u2026");
  try {
    render(await api("/api/setup/register-name", { method: "POST" }));
  } catch (err) {
    status("deploy-status", err.message, "error");
    el("register-name").disabled = false;
  }
});
el("attach-resolver").addEventListener("click", async () => {
  el("attach-resolver").disabled = true;
  clearTimeout(pollTimer);
  status("deploy-status", "Deploying the resolver and attaching it to the name \u2014 two transactions\u2026");
  try {
    render(await api("/api/setup/resolver", { method: "POST" }));
  } catch (err) {
    status("deploy-status", err.message, "error");
    el("attach-resolver").disabled = false;
  }
});
el("deploy").addEventListener("click", async () => {
  el("deploy").disabled = true;
  clearTimeout(pollTimer);
  status("deploy-status", "Deploying \u2014 this takes a block or two\u2026");
  try {
    render(await api("/api/setup/deploy", { method: "POST" }));
  } catch (err) {
    status("deploy-status", err.message, "error");
    el("deploy").disabled = false;
  }
});
refresh();
