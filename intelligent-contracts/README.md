# TruthGuard Intelligent Contract

`TruthGuard.py` is the GenVM intelligent contract that makes TruthGuard real. It is
written in GenLayer's Python contract language and deployed on **Bradbury Testnet**.

## Why this contract exists

The first version of TruthGuard only sent a claim string to a contract and read back
a verdict — every other number on the page (confidence %, validator count, evidence
reliability) was fabricated client-side. This contract moves the actual judgment
on-chain:

1. **Evidence fetching** — the contract renders the submitted evidence URL through
   GenLayer's web oracle (`gl.nondet.web.render`) inside a non-deterministic block.
2. **AI analysis** — each validator independently runs an LLM prompt
   (`gl.nondet.exec_prompt`) against the claim + rendered evidence.
3. **Consensus** — `gl.eq_principle.prompt_comparative` requires the network's
   validators to agree on verdict, confidence, and evidence reliability before the
   transaction can be finalized. If validators disagree, the transaction fails and
   nothing is recorded.
4. **On-chain storage** — only the agreed result is stored: verdict, confidence,
   reasoning, evidence title/excerpt/reliability, requester, and timestamp.

The frontend reads everything back via `get_last_result()` — nothing is invented.

## Contract interface

| Method | Type | Description |
| --- | --- | --- |
| `verify_claim(claim: str, url: str = "")` | `write` | Submit a claim (min 12 chars) with an optional `http(s)` evidence URL. Runs the full analysis + consensus flow. |
| `get_last_result() -> dict` | `view` | Returns the most recent agreed result (see schema below). |
| `get_checks_count() -> int` | `view` | Total number of verifications performed by this contract instance. |

### `get_last_result()` schema

```json
{
  "claim": "string",
  "url": "string",
  "verdict": "true | false | uncertain",
  "confidence": 0,
  "reasoning": "string",
  "evidence_title": "string",
  "evidence_excerpt": "string",
  "evidence_reliability": 0,
  "evidence_loaded": "true | false",
  "requester": "0x...",
  "verified_at": "ISO 8601",
  "checks_count": 0
}
```

`confidence` and `evidence_reliability` are 0–100 integers that validators round to
the nearest 10 so independent runs agree. When no evidence URL is submitted,
`evidence_loaded` is `"false"`, reliability is `0`, and validators are instructed to
cap confidence at 50 and lean toward `uncertain`.

## Deployment

The deploy script lives in [`../scripts`](../scripts):

```bash
cd scripts
npm install
cp .env.example .env    # fill in PRIVATE_KEY (Bradbury wallet) and optionally RPC_URL
npm run deploy
```

The script deploys `TruthGuard.py`, waits for acceptance, prints the new contract
address, and writes it to the app's `.env.local` as `NEXT_PUBLIC_FACTCHECKER_CONTRACT`.
Restart the app (or set the env var in your hosting dashboard) so the frontend points
at the new contract.

> Old deployments of the first FactChecker contract return `[claim, verdict, reason]`.
> The frontend tolerates that shape and only shows what that contract actually
> recorded — no fake confidence or validator numbers.

## Local testing / linting

- `genvm-lint check intelligent-contracts/TruthGuard.py` — contract linting.
- The `genlayer-test` pytest suite can run contract logic in-memory; see the GenLayer
  docs for the testing guide.
