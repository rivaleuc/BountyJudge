# BountyJudge

Decentralized bounty adjudication. Posters define specs with milestones, workers submit GitHub deliverables, and GenLayer AI validators judge whether the work meets the spec — milestone by milestone.

## Why this exists

Bounty disputes are a bottleneck. The poster says "this doesn't meet the spec." The worker says "it does." Today this gets resolved by a single human judge, or not at all. BountyJudge replaces that with decentralized AI consensus: validators fetch the actual code from GitHub, compare it against the spec, and score each milestone independently.

## Why GenLayer

Judging whether code meets a natural-language spec is interpretation, not computation. "Must handle errors gracefully" cannot be verified by a deterministic VM. GenLayer validators run diverse models, independently fetch the deliverable, and reach consensus on whether each requirement is met. The judgment is decentralized and can be disputed for a fresh evaluation with a new validator set.

## Architecture

```
┌───────────────────────┐         ┌────────────────────────────┐
│    BountyEscrow       │         │   BountyJudge.py           │
│    (Base / EVM)       │◄────────│   (GenLayer)               │
│                       │  reads  │                            │
│  • fund(amount,ms,dl) │ verdict │  • create_bounty(spec,ms)  │
│  • releaseMilestone() │         │  • submit_work(github_url) │
│  • refund()           │         │  • judge(key, submitter)   │
│                       │         │  • dispute(key, submitter) │
└───────────────────────┘         └────────────────────────────┘
         ▲                                    ▲
         │                                    │
    BJT locked per-milestone          AI fetches README/code
    partial payouts on pass           from GitHub + scores spec
```

## Key differentiators

- **Milestone-based payouts** — not all-or-nothing. 2/3 milestones pass → 2/3 of funds released.
- **GitHub deliverable fetch** — validators actually read the submitted code.
- **Per-milestone scoring** — each requirement judged independently with pass/fail + reason.
- **Dispute mechanism** — either party can trigger re-judgment with fresh validators.
- **Deadline refund** — poster gets funds back if no one delivers.
- **SvelteKit frontend** — not Next.js.

## Deployed

- **GenLayer (Bradbury):** `0x867FC12E89606f7d55d92e5fcE26e1c67D3Af229`
- **Network:** Bradbury Testnet (chain 4221)

## Test results

Created a bounty: "Build a Node.js CLI tool that fetches top 5 GitHub repos by stars."

Submitted `sindresorhus/gh-contrib` (not a CLI tool) → **All milestones FAILED**. AI correctly identified that the deliverable is an HTML page, not a functional CLI tool. Bounty stayed open, no payout.

## Structure

- `genlayer/` — Intelligent contract: bounty lifecycle + AI judgment with GitHub fetch
- `contracts/` — EVM: `BJTToken` + `BountyEscrow` (milestone-based partial payouts)
- `packages/sdk/` — TypeScript: `calculatePayout()`, `validateSpec()`, `githubToRaw()` + ABIs
- `web/` — SvelteKit + Tailwind tabbed UI (Post / Submit / Judge)

## Quick start

```bash
pnpm install
cd contracts && forge install OpenZeppelin/openzeppelin-contracts foundry-rs/forge-std
forge test -vv
cd ../web && pnpm dev
```
