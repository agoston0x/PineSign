# PineSign

Verifiable file transfer. Encrypted on your machine, stored on Swarm, attested on ENS.

Built at ETHRome 2026. Live at https://pinesign.claws.page

## What it does

Alice invites Bob by email. Bob signs in with Google (Circle creates his wallet) and
takes a name — `bob.pinesign.eth`. Alice's browser extension encrypts the file to Bob's
key, the gateway stores the ciphertext on Swarm, and Bob opens it in any browser.

When Bob decrypts, a record is written to ENS under `<id>.tx.pinesign.eth`:
both names and keys, both signatures, the file hash, the Swarm reference, timestamps.
It is frozen on delivery. Not even the server that wrote it can change it.

## Verify a transfer yourself

No PineSign server involved — read the resolver on Sepolia directly. A real transfer
from the demo, `966e872faac33223ef0ab629cdd31b85.tx.pinesign.eth`:

```bash
RESOLVER=0xa7bdce7d8499a299d84406b0a29a33e4d515201c        # pinesign.eth's resolver
NODE=$(cast namehash 966e872faac33223ef0ab629cdd31b85.tx.pinesign.eth)
RPC=https://ethereum-sepolia-rpc.publicnode.com

cast call $RESOLVER "text(bytes32,string)(string)" $NODE "sender"        --rpc-url $RPC
cast call $RESOLVER "text(bytes32,string)(string)" $NODE "recipient"     --rpc-url $RPC
cast call $RESOLVER "text(bytes32,string)(string)" $NODE "file.hash"     --rpc-url $RPC
cast call $RESOLVER "text(bytes32,string)(string)" $NODE "recipient.sig" --rpc-url $RPC
cast call $RESOLVER "frozen(bytes32)(bool)"        $NODE                 --rpc-url $RPC
```

Keys: `sender`, `sender.key`, `sender.sig`, `recipient`, `recipient.key`, `file.name`,
`file.commitment`, `file.hash`, `swarm`, `sent`, `recipient.sig`, `delivered`.

The resolver is what the ENSv2 registry returns for `pinesign.eth`
(`getResolver("pinesign")` on `0xBDC85dD5b15D7ecb354cd7cb6f2c50b4f2c4F0E2`), so the
chain of trust starts at ENS, not at us. The same data is served for convenience at
`/api/attestation/<id>`.

## How it holds up

- **No key is ever sent.** ECDH: each side derives the same secret from its own private
  key and the other's public key.
- **The gateway is blind.** It pays for storage and sees only ciphertext.
- **Proof of decryption.** The sender commits to `keccak(fileHash)`; the recipient must
  reveal `fileHash` to claim. You cannot claim without opening the file.
- **Two privacy modes, the sender's choice.** *Private*: the recipient's key must live in
  the extension, where no served code can reach it. *Receipted*: any browser holds the
  key. Same proof either way.
- **Expiry is passive.** The Swarm batch is sized to the transfer window; unclaimed
  files just lapse.

## What's in the repo

| | |
|---|---|
| `gateway/` | Node server: Circle sign-in, invitations + email, Swarm upload, ENSv2 registration, on-chain attestation, admin panel |
| `extension/` | Chrome extension: keypair, encrypt, send. Built with the server's address baked in |
| `web/` | Lander, sign-up modal, claim page, admin panel |
| `shared/` | Crypto (secp256k1 ECDH + AES-GCM), page↔extension bridge, key source |
| `contracts/` | `PineSignReceipts` (write-once) · `PineSignResolver` (ENSIP-10 wildcard, frozen records) |
| `docker-compose.yml` | Bee 2.8.2 light node on Gnosis |

## Integrations

- **Swarm** — Bee light node ships with the server; postage bought from the admin panel,
  priced live from `/chainstate`. Every file lives on the real network.
- **ENSv2 (Sepolia)** — the server registers its own name through the v2 registrar
  (fee in test USDC, gas only), attaches a wildcard resolver, and writes each transfer's
  attestation under a subname without minting a token per transfer.
- **Circle** — user-controlled wallets via Google sign-in. Identity only; MPC keys can't do
  ECDH, so encryption uses a separate key the name publishes.
- **Resend** — four emails: invited, accepted, file ready, delivered.

## Run your own

Needs Node 22+, Docker, a domain with HTTPS (Google OAuth won't accept a bare IP).

**1. Credentials**
- Circle console → *User Controlled → Configurator*: copy the **App ID**; *Keys*: make an
  **API key** (sending only)
- Google Cloud → *Auth Platform → Clients → Web*: origin `https://yourdomain`, redirect
  `https://yourdomain/app.html`. Copy the **Client ID**, paste it into Circle's
  *Social Logins → Google*. Add test users, or publish the app.
- Resend → add your domain, set its DNS records, make a sending key

**2. Install**
```bash
git clone https://github.com/agoston0x/pinesign /opt/pinesign && cd /opt/pinesign
npm install
cat > .env <<'ENV'
PORT=8788
HOST=127.0.0.1
PUBLIC_ORIGIN=https://yourdomain
CIRCLE_API_KEY=
CIRCLE_APP_ID=
GOOGLE_CLIENT_ID=
RESEND_API_KEY=
MAIL_FROM=PineSign <noreply@yourdomain>
BEE_URL=http://127.0.0.1:1633
ENV
npm run build
npm start          # brings up the Bee node, then the gateway
```
Put `yourdomain { reverse_proxy localhost:8788 }` in Caddy (or equivalent). Firewall:
22, 80, 443, and 1634 for Bee's P2P.

**3. Set up** — the server prints an admin link. Open it, sign in with MetaMask to claim
the server, then:
1. choose a name (checked free on Sepolia *and* mainnet)
2. generate the server wallet
3. fund it from MetaMask — packages are priced live; the name costs gas only
4. register the name, attach the resolver, deploy the receipt contract
5. fund the Bee node (xDAI + BZZ on Gnosis, one click) and buy a postage batch

The admin panel stays at `/setup.html`, wallet-gated. Back up `.storage/` — it holds
the server's keys. Every generated key is also copied to `~/.pinesign/keys/`.

## Tests

```bash
npm test               # gateway: 20 checks against a throwaway server
npm run test:contracts # foundry: 14 tests
```

## Contracts (Sepolia)

Ours — addresses in the admin panel after setup. Integrated: ENSv2 registrar
`0xa88553f454b77203b0d036a05c894d555eaaa2cc`, ENSv2 registry
`0xBDC85dD5b15D7ecb354cd7cb6f2c50b4f2c4F0E2`, ENSv2 fee token
`0x768f42455a2d082e23ceef7d51e5787c82d67a39`.
