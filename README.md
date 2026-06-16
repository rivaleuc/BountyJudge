# BountyJudge

**On-chain bounty adjudication — an AI judge fetches the deliverable, scores every milestone, and releases the payout.**

BountyJudge replaces the trusted reviewer in a bounty workflow. A poster writes a spec and a milestone list; a worker submits a GitHub URL. GenLayer validators fetch the actual deliverable, compare it to the spec milestone-by-milestone, and reach consensus on a pass/fail verdict that an EVM escrow reads to release funds — no maintainer playing favourites, no off-chain trust.

- **Contract (Bradbury, chain 4221):** `0xaB2a96720ff2ecEA5994d8BA777D93e4a3D19E55`
- **Explorer:** https://explorer-bradbury.genlayer.com/contract/0xaB2a96720ff2ecEA5994d8BA777D93e4a3D19E55
- **Live app:** https://bountyjudge.pages.dev

## What it does

The lifecycle is **post → submit → judge → (dispute) → pay**:

1. **`create_bounty(title, spec, repo_required, milestones)`** — a poster creates a bounty with a spec (capped at `MAX_SPEC_CHARS`) and an optional JSON array of milestones like `["Setup repo","Core logic","Tests pass"]`. Stored as JSON in `bounties: TreeMap[str, str]`, status `"open"`.
2. **`submit_work(bounty_key, github_url, notes)`** — a worker submits their deliverable (repo/PR URL + notes). Stored in `submissions: TreeMap[str, str]` under `"bountyKey:submitter"` with an empty verdict.
3. **`judge(bounty_key, submitter)`** — triggers AI adjudication via the internal `_run_judgment`. If the verdict's `overall_pass` is true, the bounty flips to `"completed"` and `winner` is set.
4. **Adjudication (the core).** Inside `_run_judgment`, a `leader_fn` crawls the deliverable: it first tries **`gl.nondet.web.get(...)`** against the raw GitHub README (`raw.githubusercontent.com/.../main/README.md`), then falls back to **`gl.nondet.web.render(github_url, mode="text")`**. The fetched code/README plus the spec and milestones go into **`gl.nondet.exec_prompt(prompt, response_format="json")`**, which must reply `{"overall_pass", "score", "reasoning", "milestones":[{"name","pass","reason"}]}` — judging each milestone individually, with overall pass requiring *all* milestones to pass.
5. **Consensus.** The verdict is finalized through **`gl.vm.run_nondet_unsafe(leader_fn, validator_fn)`**. The `validator_fn` re-checks the leader's `gl.vm.Return.calldata` for *structure*: `overall_pass` is a bool, `score` is an int 0–100, `reasoning` is a string, `milestones` is a list. Validators agree on a well-formed verdict, not identical wording.
6. **`dispute(bounty_key, submitter)`** — the poster or worker can request a fresh re-judgment (a new validator set re-runs `_run_judgment`); status becomes `"completed"` or `"disputed"`.
7. **Payout.** `read_payout(bounty_key)` is the resolver the `BountyEscrow` EVM contract reads to release funds (`payable`, `winner`, `poster`). `get_bounty`, `get_submission`, and `stats` are views.

## Why GenLayer

A deterministic EVM cannot judge whether a pile of code "meets the spec." Solidity cannot clone a repo, read a README, or reason about whether `recursive SNARK prover, gas under 280k, ≥90% coverage` was actually delivered — there is no opcode for fetching a live GitHub page, and two nodes fetching it at different times would diverge. The judgement itself is a natural-language comparison that only an LLM can perform, and it must be reproducible by many independent nodes to be trustworthy.

GenLayer's **Optimistic Democracy** is built for this: a leader validator produces the verdict, the rest re-evaluate it, and finalization happens when a supermajority agrees the result is *reasonable* — not byte-identical. Either party can appeal via `dispute`.

**Use GenLayer when** acceptance depends on subjective, off-chain artifacts (does this code satisfy this English spec?) and you still need an on-chain, appealable record. **Use a plain backend when** payout is a pure function of deterministic on-chain state — which is why escrow and the `BJTToken` stay on the EVM and only *read* the verdict.

## Architecture

| Intelligent contract (GenLayer) | Frontend dir | EVM / off-chain |
| --- | --- | --- |
| `genlayer/bounty_judge.py` — `BountyJudge(gl.Contract)`: `create_bounty`, `submit_work`, `judge`, `dispute`, `read_payout`, per-milestone scoring via `run_nondet_unsafe` | `web/` (Vite + React + TS) | `contracts/BountyEscrow.sol` + `BJTToken.sol` — escrow releases on `read_payout`; deliverables fetched off-chain from GitHub by validators |

## Tech

**Contract** — GenVM Python, pinned to `py-genlayer:1jb45aa8…jpz09h6` via the `# { "Depends": ... }` header. State is held in `TreeMap[str, str]` stores (`bounties`, `submissions`) with `u256` counters (`bounty_count`, `judgments_made`). The AI judgment runs as a `leader_fn`/`validator_fn` pair through `gl.vm.run_nondet_unsafe`; evidence is fetched with `gl.nondet.web.get` (raw README) and `gl.nondet.web.render` (fallback), bounded by `MAX_SPEC_CHARS`/`MAX_CODE_CHARS`.

**Frontend** — Vite + React 19 + TypeScript with Tailwind v4, `framer-motion`, and `sonner`. `src/genlayer.ts` wraps `genlayer-js`: reads via `createClient({ chain: testnetBradbury }).readContract`; writes connect MetaMask (`eth_requestAccounts`), switch the wallet to chain `0x107d` (4221) via `wallet_switchEthereumChain`/`wallet_addEthereumChain` (no GenLayer snap required), then `writeContract` and await a `FINALIZED` receipt. The UI is a dark, amber-accented **bounty board**: a left column of bounty cards with per-milestone progress strips, a detail pane showing the spec and a deliverable-repo input that fires `judge`, an animated milestone-verdict tracker (✓/✕ per milestone with reasons), and a score-proportional USDC payout/release panel.

## Project structure

```
BountyJudge/
├── genlayer/
│   └── bounty_judge.py       # BountyJudge(gl.Contract) — intelligent contract
├── contracts/
│   ├── src/BountyEscrow.sol  # EVM escrow, releases on read_payout
│   ├── src/BJTToken.sol      # bounty token
│   └── test/BountyEscrow.t.sol
├── packages/sdk/             # shared TS helpers
├── web/                      # frontend (Vite + React + TS)
│   ├── src/
│   │   ├── App.tsx           # bounty board + milestone tracker
│   │   ├── genlayer.ts       # genlayer-js reads + MetaMask writes
│   │   └── main.tsx
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
├── pnpm-workspace.yaml
└── README.md
```

## Develop

```bash
cd web
npm install
npm run dev      # local dev server
npm run build    # tsc -b && vite build → dist/
```

## Deploy the frontend

Deployed on **Cloudflare Pages**:

- **Root directory:** `web`
- **Build command:** `npm run build`
- **Output directory:** `dist`
- **Environment:** `NODE_VERSION=20`

## Why GenLayer (engineering notes)

- **No floats.** Scores are plain `int` (0–100) and counters are `u256`. The frontend derives a proportional payout from the integer score; if you need fractional currency, use basis points / `u256`, never floating point in contract state.
- **Validate structure, not exact match.** `validator_fn` only checks that the verdict JSON is well-formed (`overall_pass` bool, `score` in range, `milestones` a list). It never requires the leader's reasoning text to match — LLM output is non-deterministic, so exact-match consensus is impossible.
- **ACCEPTED ≠ executed.** A finalized `judge`/`dispute` means validators agreed the verdict is reasonable; no funds move until `BountyEscrow` reads `read_payout` and acts.
- **Optimistic finality paces writes.** Writes are only trustworthy after the appeal window — the frontend waits for a `FINALIZED` receipt (retries 60 × 5s), so a judgment takes ~30–60s. `dispute` is the appeal path; don't release funds before finality.
- **Evidence is untrusted / greybox.** The GitHub URL is worker-supplied and attacker-controllable. Fetches can fail or be padded; the prompt instructs the judge to fail when no real deliverable is available, and fetched content is capped. Treat every fetched page as hostile.

## License

MIT
