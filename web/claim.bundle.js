// node_modules/@noble/hashes/esm/utils.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function abytes(b, ...lengths) {
  if (!isBytes(b))
    throw new Error("Uint8Array expected");
  if (lengths.length > 0 && !lengths.includes(b.length))
    throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
}
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function aoutput(out, instance) {
  abytes(out);
  const min = instance.outputLen;
  if (out.length < min) {
    throw new Error("digestInto() expects output buffer of length at least " + min);
  }
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
function utf8ToBytes(str) {
  if (typeof str !== "string")
    throw new Error("string expected");
  return new Uint8Array(new TextEncoder().encode(str));
}
function toBytes(data) {
  if (typeof data === "string")
    data = utf8ToBytes(data);
  abytes(data);
  return data;
}
var Hash = class {
};
function createHasher(hashCons) {
  const hashC = (msg) => hashCons().update(toBytes(msg)).digest();
  const tmp = hashCons();
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = () => hashCons();
  return hashC;
}

// node_modules/@noble/hashes/esm/_md.js
function setBigUint64(view, byteOffset, value, isLE) {
  if (typeof view.setBigUint64 === "function")
    return view.setBigUint64(byteOffset, value, isLE);
  const _32n = BigInt(32);
  const _u32_max = BigInt(4294967295);
  const wh = Number(value >> _32n & _u32_max);
  const wl = Number(value & _u32_max);
  const h = isLE ? 4 : 0;
  const l = isLE ? 0 : 4;
  view.setUint32(byteOffset + h, wh, isLE);
  view.setUint32(byteOffset + l, wl, isLE);
}
function Chi(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj(a, b, c) {
  return a & b ^ a & c ^ b & c;
}
var HashMD = class extends Hash {
  constructor(blockLen, outputLen, padOffset, isLE) {
    super();
    this.finished = false;
    this.length = 0;
    this.pos = 0;
    this.destroyed = false;
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
  update(data) {
    aexists(this);
    data = toBytes(data);
    abytes(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
      }
    }
    this.length += data.length;
    this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    clean(this.buffer.subarray(pos));
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      pos = 0;
    }
    for (let i = pos; i < blockLen; i++)
      buffer[i] = 0;
    setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE);
    this.process(view, 0);
    const oview = createView(out);
    const len = this.outputLen;
    if (len % 4)
      throw new Error("_sha2: outputLen should be aligned to 32bit");
    const outLen = len / 4;
    const state = this.get();
    if (outLen > state.length)
      throw new Error("_sha2: outputLen bigger than state");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    to || (to = new this.constructor());
    to.set(...this.get());
    const { blockLen, buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (length % blockLen)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
};
var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);

// node_modules/@noble/hashes/esm/sha2.js
var SHA256_K = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
var SHA256 = class extends HashMD {
  constructor(outputLen = 32) {
    super(64, outputLen, 8, false);
    this.A = SHA256_IV[0] | 0;
    this.B = SHA256_IV[1] | 0;
    this.C = SHA256_IV[2] | 0;
    this.D = SHA256_IV[3] | 0;
    this.E = SHA256_IV[4] | 0;
    this.F = SHA256_IV[5] | 0;
    this.G = SHA256_IV[6] | 0;
    this.H = SHA256_IV[7] | 0;
  }
  get() {
    const { A, B, C, D, E, F, G, H } = this;
    return [A, B, C, D, E, F, G, H];
  }
  // prettier-ignore
  set(A, B, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA256_W[i] = view.getUint32(offset, false);
    for (let i = 16; i < 64; i++) {
      const W15 = SHA256_W[i - 15];
      const W2 = SHA256_W[i - 2];
      const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
      const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B, C, D, E, F, G, H } = this;
    for (let i = 0; i < 64; i++) {
      const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
      const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
      const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
      const T2 = sigma0 + Maj(A, B, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B;
      B = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B, C, D, E, F, G, H);
  }
  roundClean() {
    clean(SHA256_W);
  }
  destroy() {
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean(this.buffer);
  }
};
var sha256 = /* @__PURE__ */ createHasher(() => new SHA256());

// node_modules/@noble/hashes/esm/sha256.js
var sha2562 = sha256;

// shared/crypto.js
var INFO = new TextEncoder().encode("pinesign/v1");
function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// shared/client.js
var Gateway = class {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }
  async #json(path, options) {
    const res = await fetch(this.baseUrl + path, options);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    return body;
  }
  #post(path, body) {
    return this.#json(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }
  /** A fresh nonce, signed — the gateway's proof of who is asking. */
  async #auth(signer) {
    const pubKey = signer.publicKeyHex;
    const { nonce } = await this.#post("/api/nonce", { pubKey });
    const signature = await signer.signDigest(sha2562(new TextEncoder().encode(nonce)));
    return { pubKey, nonce, signature };
  }
  health() {
    return this.#json("/api/health");
  }
  async send(signer, payload) {
    return this.#post("/api/send", { ...await this.#auth(signer), ...payload });
  }
  transfer(id2) {
    return this.#json(`/api/transfer/${id2}`);
  }
  async blob(id2) {
    const res = await fetch(`${this.baseUrl}/api/blob/${id2}`);
    if (!res.ok) throw new Error(`blob fetch failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  async claim(signer, id2, claimSignature) {
    return this.#post("/api/claim", { ...await this.#auth(signer), id: id2, claimSignature });
  }
  // ---- names ----
  /** Claim a name and publish an encryption key under it. */
  async registerName(signer, label) {
    return this.#post("/api/name/register", {
      ...await this.#auth(signer),
      label,
      address: signer.address ?? null
    });
  }
  /** Name to key — how a sender finds out where to encrypt. */
  resolveName(name) {
    return this.#json(`/api/name/resolve/${encodeURIComponent(name)}`);
  }
  /** Key to name, for showing a person rather than a hex string. */
  async reverseName(pubKey) {
    try {
      return await this.#json(`/api/name/reverse/${pubKey}`);
    } catch {
      return null;
    }
  }
};

// shared/bridge.js
var TAG = "pinesign";
var TIMEOUT_MS = 2e4;
var ready = false;
window.addEventListener("message", (event) => {
  if (event.source === window && event.data?.tag === TAG && event.data.type === "ready") {
    ready = true;
  }
});
function request(type, payload) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("the extension did not respond"));
    }, TIMEOUT_MS);
    function onMessage(event) {
      if (event.source !== window) return;
      const msg = event.data;
      if (msg?.tag !== TAG || msg.requestId !== requestId) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      if (!msg.response?.ok) return reject(new Error(msg.response?.error ?? "extension error"));
      resolve(msg.response.result);
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ tag: TAG, requestId, type, payload }, window.location.origin);
  });
}
async function extensionPresent() {
  if (ready) return true;
  await new Promise((r) => setTimeout(r, 300));
  if (ready) return true;
  try {
    await request("identity", {});
    return true;
  } catch {
    return false;
  }
}
function getIdentity() {
  return request("identity", {});
}
function openTransfer(payload) {
  return request("openTransfer", payload);
}
async function bridgeSigner() {
  const identity2 = await getIdentity();
  return {
    publicKeyHex: identity2.publicKey,
    address: identity2.address,
    async signDigest(digest) {
      const { signature } = await request("signDigest", { digest: toHex(digest) });
      return signature;
    }
  };
}

// web/src/claim.js
var el = (id2) => document.getElementById(id2);
var gateway = new Gateway(location.origin);
var id = new URLSearchParams(location.search).get("id");
var identity = null;
var transfer = null;
function say(message, kind = "") {
  el("status").textContent = message;
  el("status").className = `status ${kind}`.trim();
}
function subtitle(text, colour) {
  el("subtitle").textContent = text;
  if (colour) el("subtitle").style.color = colour;
}
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
var short = (hex) => `${hex.slice(0, 10)}\u2026${hex.slice(-6)}`;
function showReceipt(claim) {
  el("r-time").textContent = new Date(claim.claimedAt).toLocaleString();
  el("r-hash").textContent = short(transfer.plaintextHash);
  el("r-sig").textContent = short(claim.recipientSignature);
  el("receipt").hidden = false;
  el("accept").disabled = true;
}
async function load() {
  if (!id) return subtitle("No transfer in this link.", "#ff9c7a");
  if (!await extensionPresent()) {
    el("install-panel").hidden = false;
    return subtitle("Install the PineSign extension to open this file.", "#ff9c7a");
  }
  identity = await getIdentity();
  const named = await gateway.reverseName(identity.publicKey);
  el("pubkey").textContent = named ? named.name : identity.publicKey;
  el("identity-panel").hidden = false;
  try {
    transfer = await gateway.transfer(id);
  } catch (err) {
    return subtitle(err.message, "#ff9c7a");
  }
  el("f-name").textContent = transfer.filename;
  el("f-size").textContent = formatSize(transfer.size);
  el("f-sender").textContent = transfer.senderName ?? short(transfer.senderPubKey);
  el("f-ref").textContent = short(transfer.reference);
  el("f-expires").textContent = new Date(transfer.expiresAt).toLocaleString();
  el("details").hidden = false;
  if (transfer.expired) {
    return subtitle("This transfer expired. The file is gone.", "#ff9c7a");
  }
  if (transfer.recipientPubKey !== identity.publicKey) {
    el("identity-hint").textContent = "This file was sent to a different key. Give the sender the name above and ask them to send it again.";
    return subtitle("Not addressed to this device.", "#ff9c7a");
  }
  el("action-panel").hidden = false;
  if (transfer.claim) {
    subtitle("Already delivered.", "var(--glow)");
    return showReceipt(transfer.claim);
  }
  subtitle("Waiting for you to accept.");
}
el("accept").addEventListener("click", async () => {
  el("accept").disabled = true;
  try {
    say("Fetching the encrypted file\u2026");
    const blob = await gateway.blob(id);
    say("Opening it in the extension\u2026");
    const opened = await openTransfer({
      ciphertext: Array.from(blob),
      senderPubKey: transfer.senderPubKey,
      expectedHash: transfer.plaintextHash
    });
    say("Recording the receipt\u2026");
    const { claim } = await gateway.claim(await bridgeSigner(), id, opened.signature);
    const bytes = Uint8Array.from(opened.plaintext);
    const url = URL.createObjectURL(new Blob([bytes]));
    const a = document.createElement("a");
    a.href = url;
    a.download = transfer.filename;
    a.click();
    URL.revokeObjectURL(url);
    say("Decrypted, verified, and receipted.", "done");
    subtitle("Delivered.", "var(--glow)");
    showReceipt(claim);
  } catch (err) {
    say(err.message, "error");
    el("accept").disabled = false;
  }
});
load();
/*! Bundled license information:

@noble/hashes/esm/utils.js:
  (*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) *)
*/
