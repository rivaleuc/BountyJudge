import type { Address } from "viem";

// ─── Types ───────────────────────────────────────────────────────────

export interface Milestone {
  name: string;
  pass: boolean;
  reason: string;
}

export interface JudgmentVerdict {
  overall_pass: boolean;
  score: number;
  reasoning: string;
  milestones: Milestone[];
}

export interface BountyState {
  poster: string;
  title: string;
  spec: string;
  milestones: string[];
  status: "open" | "judging" | "completed" | "disputed";
  winner: string;
}

export interface PayoutBreakdown {
  perMilestone: bigint;
  totalEarned: bigint;
  remaining: bigint;
  milestonesPassedCount: number;
}

// ─── Logic ───────────────────────────────────────────────────────────

/** Calculate milestone-based payout breakdown from a verdict. */
export function calculatePayout(
  totalBounty: bigint,
  milestoneCount: number,
  verdict: JudgmentVerdict
): PayoutBreakdown {
  const perMilestone = totalBounty / BigInt(milestoneCount);
  const passed = verdict.milestones.filter((m) => m.pass).length;
  const totalEarned = perMilestone * BigInt(passed);
  return {
    perMilestone,
    totalEarned,
    remaining: totalBounty - totalEarned,
    milestonesPassedCount: passed,
  };
}

/** Validate a spec has enough detail for fair judgment. */
export function validateSpec(spec: string): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  if (spec.length < 50) issues.push("Spec too short — add more detail for fair judgment");
  if (spec.length > 3000) issues.push("Spec too long — max 3000 chars");
  if (!/\b(must|should|will|need|require)\b/i.test(spec))
    issues.push("Spec lacks clear requirements (use 'must', 'should', etc.)");
  return { valid: issues.length === 0, issues };
}

/** Parse GitHub URL to raw content URL for README fetch. */
export function githubToRaw(url: string): string {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return url;
  const [, owner, repo] = match;
  return `https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`;
}

/** Estimate time to judgment based on content complexity. */
export function estimateJudgmentTime(spec: string, milestoneCount: number): string {
  const baseSeconds = 15;
  const perMilestone = 5;
  const total = baseSeconds + milestoneCount * perMilestone;
  return `~${total}s`;
}

// ─── ABIs ────────────────────────────────────────────────────────────

export const escrowAbi = [
  {
    type: "function",
    name: "fund",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "milestoneCount", type: "uint8" },
      { name: "deadline", type: "uint64" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function",
    name: "releaseMilestone",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "worker", type: "address" },
      { name: "milestoneIndex", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "refund",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "remainingAmount",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "bounties",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "poster", type: "address" },
      { name: "worker", type: "address" },
      { name: "totalAmount", type: "uint256" },
      { name: "paidOut", type: "uint256" },
      { name: "milestoneCount", type: "uint8" },
      { name: "milestonesPassed", type: "uint8" },
      { name: "deadline", type: "uint64" },
      { name: "status", type: "uint8" },
    ],
  },
  {
    type: "event",
    name: "BountyFunded",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "poster", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "milestones", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "MilestonePaid",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "worker", type: "address", indexed: true },
      { name: "milestone", type: "uint8", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BountyCompleted",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "worker", type: "address", indexed: true },
      { name: "totalPaid", type: "uint256", indexed: false },
    ],
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface BJDeployment {
  chainId: number;
  token: Address;
  escrow: Address;
  genlayerContract: string;
}
