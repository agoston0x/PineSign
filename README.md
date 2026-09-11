
## Components

1. **Gateway Server** — Node/Express, holds the app's Swarm ID, pays postage
2. **App Lander** — public web page, project explainer
3. **Claim Page** — where the recipient accepts and downloads
4. **Chrome Extension** — keypair, file picker, local encrypt/decrypt, chain polling
5. **Encryption Module** — ECDH + AES-GCM, shared by extension and claim page
6. **Receipt Contract** — Solidity, write-once send/claim attestations (Sepolia)
7. **ENS Module** — ephemeral subname mint + text records, expiry
8. **Auth Module** — nonce-challenge signing, Google sign-in, Circle wallet
9. **Shared Types** — refs, pubkeys, receipt schema
