// web/src/setup.js
var el = (id) => document.getElementById(id);
var token = new URLSearchParams(location.search).get("token") ?? localStorage.getItem("pinesign.setupToken") ?? "";
var pollTimer = null;
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", "x-setup-token": token, ...options.headers ?? {} }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? res.statusText), { status: res.status });
  return body;
}
function status(node, message, kind = "") {
  el(node).textContent = message;
  el(node).className = `status ${kind}`.trim();
}
function showOnly(step) {
  for (const s of ["locked", "step-name", "step-keys", "step-fund", "step-done"]) el(s).hidden = true;
  el(step).hidden = false;
}
function render(state) {
  el("rpc").textContent = `RPC: ${state.rpcUrl}`;
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
    el("deployer").textContent = state.deployer;
    el("balance").textContent = state.balance ? `balance ${Number(state.balance.eth).toFixed(5)} ETH` : "balance unknown";
    el("cost").textContent = state.cost ? `${Number(state.cost.eth).toFixed(6)} ETH` : "\u2014";
    el("suggested").textContent = state.cost ? `${Number(state.cost.suggested).toFixed(4)} ETH` : "\u2014";
    el("deploy").disabled = !state.fundedEnough;
    status("deploy-status", state.fundedEnough ? "Funded. Ready to deploy." : "Send Sepolia ETH to the address above.", state.fundedEnough ? "done" : "");
    clearTimeout(pollTimer);
    if (!state.fundedEnough) pollTimer = setTimeout(refresh, 5e3);
    return;
  }
  showOnly("step-done");
  el("subtitle").textContent = "This server is configured.";
  el("d-name").textContent = state.parentName;
  el("d-address").textContent = state.receiptsAddress;
  el("d-tx").textContent = state.deployTx;
  el("d-deployer").textContent = state.deployer;
}
async function refresh() {
  try {
    render(await api("/api/setup/status"));
  } catch (err) {
    if (err.status === 401) {
      showOnly("locked");
      el("subtitle").textContent = "Locked.";
      return;
    }
    el("subtitle").textContent = err.message;
  }
}
el("unlock").addEventListener("click", async () => {
  token = el("token").value.trim();
  localStorage.setItem("pinesign.setupToken", token);
  status("lock-status", "Checking\u2026");
  await refresh();
});
var checkTimer = null;
el("name").addEventListener("input", () => {
  const name = el("name").value.trim().toLowerCase();
  el("save-name").disabled = true;
  el("name-check").textContent = "";
  el("name-check").className = "resolved";
  if (!/^[a-z0-9-]+\.eth$/.test(name)) return;
  clearTimeout(checkTimer);
  el("name-check").textContent = "checking\u2026";
  checkTimer = setTimeout(async () => {
    try {
      const result = await api(`/api/setup/name/${name}`);
      if (result.available) {
        el("name-check").textContent = `${name} is unregistered \u2014 you will need to register it to issue real subnames.`;
        el("name-check").className = "resolved ok";
      } else {
        el("name-check").textContent = `${name} is owned by ${result.owner.slice(0, 10)}\u2026 \u2014 use it only if that is you.`;
        el("name-check").className = "resolved";
      }
      el("save-name").disabled = false;
    } catch (err) {
      el("name-check").textContent = err.message;
      el("name-check").className = "resolved error";
    }
  }, 400);
});
el("save-name").addEventListener("click", async () => {
  el("save-name").disabled = true;
  try {
    render(await api("/api/setup/name", { method: "POST", body: JSON.stringify({ name: el("name").value.trim().toLowerCase() }) }));
  } catch (err) {
    el("name-check").textContent = err.message;
    el("name-check").className = "resolved error";
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
el("copy-deployer").addEventListener("click", () => {
  navigator.clipboard.writeText(el("deployer").textContent);
  el("copy-deployer").textContent = "Copied";
  setTimeout(() => el("copy-deployer").textContent = "Copy address", 1200);
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
