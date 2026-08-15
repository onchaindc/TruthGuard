# TruthGuard

TruthGuard is a decentralized AI fact checker built on **GenLayer Bradbury Testnet**.

You submit a claim with an optional evidence URL. A GenLayer intelligent contract
([`intelligent-contracts/TruthGuard.py`](intelligent-contracts/TruthGuard.py)) fetches
the evidence through GenLayer's web oracle, runs an independent AI analysis, and only
records a verdict after the network's validators agree (equivalence principle). The
frontend reads the agreed result back from the chain — **verdict, confidence,
reasoning, and evidence analysis are all produced on-chain, never fabricated in the
browser.**

## What is real (and what was fixed)

The first version of this app only passed a claim to a contract and read back a
verdict string; every other number on the page (confidence %, "5 validators
participated", evidence reliability) was hardcoded in the frontend. That has been
removed:

- **New intelligent contract** — evidence is fetched inside the contract via
  `gl.nondet.web.render`, analyzed with an LLM prompt, and validated through
  `gl.eq_principle.prompt_comparative` so validators must agree before anything is
  stored.
- **Everything displayed comes from `get_last_result()`** — verdict, confidence,
  reasoning, evidence title/excerpt/reliability, requester, and timestamp are all
  on-chain fields. No fabricated numbers remain.
- **Honest fallback** — if the app is pointed at an older FactChecker deployment
  (which returns only `[claim, verdict, reason]`), it shows exactly that and labels
  confidence/evidence analysis as "not recorded" instead of inventing values.

## How it works

1. Connect a GenLayer-compatible wallet (the app switches/adds the Bradbury network).
2. Paste a claim (min 12 chars) and optionally an evidence URL.
3. The app submits `verify_claim(claim, url)` to the TruthGuard contract.
4. Validators render the evidence, run the analysis prompt, and must reach
   equivalence; the agreed result is stored on-chain.
5. The app polls the transaction, then reads `get_last_result()` and renders it.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Deploying the contract

The repo includes the deploy script that deploys `TruthGuard.py` to Bradbury:

```bash
cd scripts
npm install
# create .env from the template:
#   PRIVATE_KEY=<your Bradbury testnet wallet private key>
#   RPC_URL=https://rpc-bradbury.genlayer.com  (optional, this is the default)
npm run deploy
```

The script prints the new contract address and writes
`NEXT_PUBLIC_FACTCHECKER_CONTRACT=<address>` to `.env.local`. Restart the app (or set
the env var in your hosting dashboard) so the frontend points at the new contract.
See [`intelligent-contracts/README.md`](intelligent-contracts/README.md) for the
contract interface and result schema.

## Environment variables

All are optional — sensible defaults point at Bradbury Testnet:

| Variable | Default |
| --- | --- |
| `NEXT_PUBLIC_GENLAYER_RPC_URL` | `https://rpc-bradbury.genlayer.com` |
| `NEXT_PUBLIC_FACTCHECKER_CONTRACT` | `0x6966358267e8e85fD1CAA204F89E8d340b77DBE6` (TruthGuard intelligent contract) |
| `NEXT_PUBLIC_GENLAYER_EXPLORER` | `https://explorer-bradbury.genlayer.com/` |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | _(empty — WalletConnect QR pairing disabled)_ |

Only `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` requires setup: create a free project at
[cloud.walletconnect.com](https://cloud.walletconnect.com) and set it in your hosting
dashboard to enable QR-code wallet pairing (mobile wallets). Evidence fetching and AI
analysis run inside the GenLayer network itself — no other API keys are needed.
