/**
 * Server setup page.
 *
 * The server owns the state; this walks the admin through whatever step it says
 * is next, and re-reads after every action rather than tracking progress itself.
 */

const el = (id) => document.getElementById(id)

let token = new URLSearchParams(location.search).get('token') ?? localStorage.getItem('pinesign.setupToken') ?? ''
let pollTimer = null

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-setup-token': token, ...(options.headers ?? {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(body.error ?? res.statusText), { status: res.status })
  return body
}

function status(node, message, kind = '') {
  el(node).textContent = message
  el(node).className = `status ${kind}`.trim()
}

function showOnly(step) {
  for (const s of ['locked', 'step-name', 'step-keys', 'step-fund', 'step-done']) el(s).hidden = true
  el(step).hidden = false
}

function render(state) {
  el('rpc').textContent = `RPC: ${state.rpcUrl}`

  if (state.step === 'name') {
    showOnly('step-name')
    el('subtitle').textContent = 'Nothing configured yet.'
    return
  }

  if (state.step === 'keys') {
    showOnly('step-keys')
    el('subtitle').textContent = `Issuing subnames under ${state.parentName}.`
    return
  }

  if (state.step === 'fund') {
    showOnly('step-fund')
    el('subtitle').textContent = 'Waiting for gas.'
    el('deployer').textContent = state.deployer

    const eth = (v, digits = 6) => (v ? `${Number(v.eth).toFixed(digits)} ETH` : '—')
    el('balance').textContent = state.balance
      ? `balance ${Number(state.balance.eth).toFixed(5)} ETH`
      : 'balance unknown'

    const b = state.budget
    el('gas-note').textContent = b ? `at ${b.gasPriceGwei} gwei, the current gas price` : 'at current gas'
    el('c-name').textContent = state.parentName ?? 'the name'
    el('c-domain').textContent = b?.registration
      ? `${eth(b.registration)} / year`
      : state.nameRegistered ? 'already registered' : '—'
    el('c-deploy').textContent = eth(b?.deploy)
    el('c-user').textContent = eth(b?.perUser)
    el('c-transfer').textContent = eth(b?.perTransfer)
    el('c-100users').textContent = eth(b?.hundredUsers, 4)
    el('c-100transfers').textContent = eth(b?.hundredTransfers, 4)
    el('c-suggested').textContent = b ? `${Number(b.suggested).toFixed(4)} ETH` : '—'

    // The name can be bought from here, so long as it is still free.
    el('register-name').hidden = !(state.nameAvailable && !state.nameRegistered)

    el('deploy').disabled = !state.fundedEnough
    status(
      'deploy-status',
      state.fundedEnough ? 'Funded. Ready to deploy.' : 'Send Sepolia ETH to the address above.',
      state.fundedEnough ? 'done' : '',
    )

    // Keep looking until the money lands, then stop.
    clearTimeout(pollTimer)
    if (!state.fundedEnough) pollTimer = setTimeout(refresh, 5000)
    return
  }

  showOnly('step-done')
  el('subtitle').textContent = 'Configured and running.'
  el('d-name').textContent = state.parentName
  el('d-registered').textContent = state.nameRegistered ? 'yes, on chain' : 'no — names are local only'
  el('d-address').textContent = state.receiptsAddress
  el('d-tx').textContent = state.deployTx
  el('d-deployer').textContent = state.deployer
  el('d-balance').textContent = state.balance
    ? `${Number(state.balance.eth).toFixed(5)} ETH`
    : 'balance unknown'

  // Turn the balance into the only number an operator really wants: how much
  // more use this server can pay for before it stops working.
  if (state.balance && state.budget) {
    const left = BigInt(state.balance.wei)
    const users = Number(left / BigInt(state.budget.perUser.wei))
    const transfers = Number(left / BigInt(state.budget.perTransfer.wei))
    el('d-runway').textContent =
      left === 0n
        ? 'Empty. Fund this wallet or the server cannot issue names or record receipts.'
        : `Enough for roughly ${users.toLocaleString()} more users, or ${transfers.toLocaleString()} more transfers, at ${state.budget.gasPriceGwei} gwei.`
  }
}

async function refresh() {
  try {
    render(await api('/api/setup/status'))
  } catch (err) {
    if (err.status === 401) {
      showOnly('locked')
      el('subtitle').textContent = 'Locked.'
      return
    }
    el('subtitle').textContent = err.message
  }
}

el('d-copy').addEventListener('click', () => {
  navigator.clipboard.writeText(el('d-deployer').textContent)
  el('d-copy').textContent = 'Copied'
  setTimeout(() => (el('d-copy').textContent = 'Copy address'), 1200)
})

el('d-refresh').addEventListener('click', refresh)

el('unlock').addEventListener('click', async () => {
  token = el('token').value.trim()
  localStorage.setItem('pinesign.setupToken', token)
  status('lock-status', 'Checking…')
  await refresh()
})

// ---- 1: name ----

let checkTimer = null
el('name').addEventListener('input', () => {
  const name = el('name').value.trim().toLowerCase()
  el('save-name').disabled = true
  el('name-check').textContent = ''
  el('name-check').className = 'resolved'
  if (!/^[a-z0-9-]+\.eth$/.test(name)) return

  clearTimeout(checkTimer)
  el('name-check').textContent = 'checking…'
  checkTimer = setTimeout(async () => {
    try {
      const result = await api(`/api/setup/name/${name}`)
      if (result.available) {
        el('name-check').textContent = `${name} is unregistered — you will need to register it to issue real subnames.`
        el('name-check').className = 'resolved ok'
      } else {
        el('name-check').textContent = `${name} is owned by ${result.owner.slice(0, 10)}… — use it only if that is you.`
        el('name-check').className = 'resolved'
      }
      el('save-name').disabled = false
    } catch (err) {
      el('name-check').textContent = err.message
      el('name-check').className = 'resolved error'
    }
  }, 400)
})

el('save-name').addEventListener('click', async () => {
  el('save-name').disabled = true
  try {
    render(await api('/api/setup/name', { method: 'POST', body: JSON.stringify({ name: el('name').value.trim().toLowerCase() }) }))
  } catch (err) {
    el('name-check').textContent = err.message
    el('name-check').className = 'resolved error'
    el('save-name').disabled = false
  }
})

// ---- 2: keys ----

el('gen-keys').addEventListener('click', async () => {
  el('gen-keys').disabled = true
  status('keys-status', 'Generating…')
  try {
    render(await api('/api/setup/keys', { method: 'POST' }))
  } catch (err) {
    status('keys-status', err.message, 'error')
    el('gen-keys').disabled = false
  }
})

// ---- 3: fund and deploy ----

el('copy-deployer').addEventListener('click', () => {
  navigator.clipboard.writeText(el('deployer').textContent)
  el('copy-deployer').textContent = 'Copied'
  setTimeout(() => (el('copy-deployer').textContent = 'Copy address'), 1200)
})

el('register-name').addEventListener('click', async () => {
  el('register-name').disabled = true
  clearTimeout(pollTimer)
  status('deploy-status', 'Registering — this takes two transactions and a minute between them…')
  try {
    render(await api('/api/setup/register-name', { method: 'POST' }))
  } catch (err) {
    status('deploy-status', err.message, 'error')
    el('register-name').disabled = false
  }
})

el('deploy').addEventListener('click', async () => {
  el('deploy').disabled = true
  clearTimeout(pollTimer)
  status('deploy-status', 'Deploying — this takes a block or two…')
  try {
    render(await api('/api/setup/deploy', { method: 'POST' }))
  } catch (err) {
    status('deploy-status', err.message, 'error')
    el('deploy').disabled = false
  }
})

refresh()
