import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Toaster, toast } from 'sonner'
import { read, write, CONTRACT, connectWallet, isWalletConnected } from './genlayer'

const SUBMITTER = '0x4531c0303a368eeC4dc8ea165edC6F215aA3e2A9'
const BOUNTY_KEY = '0'

type Milestone = { id: string; title: string; weight: number }
type Bounty = {
  id: string
  title: string
  org: string
  reward: number
  tag: string
  spec: string
  milestones: Milestone[]
}

type VMilestone = { name: string; pass: boolean; reason: string }
type RealVerdict = {
  overall_pass: boolean
  score: number
  reasoning: string
  milestones: VMilestone[]
}

const BOUNTIES: Bounty[] = [
  {
    id: 'BJ-401',
    title: 'Implement zk-rollup batch prover',
    org: 'genlayer-labs',
    reward: 4200,
    tag: 'cryptography',
    spec: 'Build a recursive SNARK prover that batches 256 transfers per proof. Must include Groth16 verifier contract, gas benchmark under 280k, and a reproducible CLI. Provide tests with ≥90% coverage.',
    milestones: [
      { id: 'm1', title: 'Circuit + witness generator', weight: 30 },
      { id: 'm2', title: 'On-chain Groth16 verifier', weight: 30 },
      { id: 'm3', title: 'Gas benchmark < 280k', weight: 20 },
      { id: 'm4', title: 'Test coverage ≥ 90%', weight: 20 },
    ],
  },
  {
    id: 'BJ-388',
    title: 'Realtime sanctions oracle adapter',
    org: 'compliance-dao',
    reward: 2600,
    tag: 'oracle',
    spec: 'Ship a Chainlink-compatible adapter that streams OFAC SDN deltas on-chain within 60s of publication. Include retry/backoff, signature verification, and a subscription manager.',
    milestones: [
      { id: 'm1', title: 'SDN delta poller', weight: 35 },
      { id: 'm2', title: 'Signed on-chain push', weight: 35 },
      { id: 'm3', title: 'Subscription manager', weight: 30 },
    ],
  },
  {
    id: 'BJ-372',
    title: 'Editor plugin: live originality lint',
    org: 'arbiter-collective',
    reward: 1800,
    tag: 'frontend',
    spec: 'A VS Code extension that highlights low-originality passages inline as the author types, calling the Arbiter API with debounce. Must degrade gracefully offline.',
    milestones: [
      { id: 'm1', title: 'Debounced API client', weight: 40 },
      { id: 'm2', title: 'Inline decoration UI', weight: 40 },
      { id: 'm3', title: 'Offline fallback', weight: 20 },
    ],
  },
]

export default function App() {
  const [activeId, setActiveId] = useState(BOUNTIES[0].id)
  const [url, setUrl] = useState('')
  const [judging, setJudging] = useState(false)
  const [results, setResults] = useState<Record<string, RealVerdict>>({})
  const [phase, setPhase] = useState('')
  const [stats, setStats] = useState<{ total_bounties: number; judgments_made: number } | null>(null)
  const [wallet, setWallet] = useState<string | null>(null)

  async function handleConnect() {
    try {
      const addr = await connectWallet()
      setWallet(addr)
      toast.success('Wallet connected', { description: `${addr.slice(0, 6)}…${addr.slice(-4)}` })
    } catch (e: any) {
      toast.error('Wallet connection failed', { description: e?.message ?? String(e) })
    }
  }

  const active = useMemo(() => BOUNTIES.find((b) => b.id === activeId)!, [activeId])
  const activeResult = results[activeId]

  // Load real on-chain stats on mount
  useEffect(() => {
    ;(async () => {
      try {
        const s: any = await read('stats')
        setStats({
          total_bounties: Number(s?.total_bounties ?? 0),
          judgments_made: Number(s?.judgments_made ?? 0),
        })
      } catch (e: any) {
        toast.error('Could not load contract stats', { description: e?.message ?? String(e) })
      }
    })()
  }, [])

  useEffect(() => {
    if (!judging) return
    const steps = [
      'submitting judge() transaction…',
      'validators deliberating on-chain…',
      'matching milestone specs…',
      'awaiting FINALIZED receipt…',
    ]
    let i = 0
    setPhase(steps[0])
    const t = setInterval(() => {
      i++
      setPhase(steps[i % steps.length])
    }, 4000)
    return () => clearInterval(t)
  }, [judging])

  async function runJudge() {
    setJudging(true)
    toast('Adjudication started', { description: `Judging bounty ${BOUNTY_KEY} on-chain — this can take 30–60s.` })
    try {
      await write('judge', [BOUNTY_KEY, SUBMITTER])
      const sub: any = await read('get_submission', [BOUNTY_KEY, SUBMITTER])
      const verdict: RealVerdict = {
        overall_pass: !!sub?.verdict?.overall_pass,
        score: Number(sub?.verdict?.score ?? 0),
        reasoning: String(sub?.verdict?.reasoning ?? ''),
        milestones: Array.isArray(sub?.verdict?.milestones)
          ? sub.verdict.milestones.map((m: any) => ({
              name: String(m?.name ?? ''),
              pass: !!m?.pass,
              reason: String(m?.reason ?? ''),
            }))
          : [],
      }
      if (sub?.github_url) setUrl(String(sub.github_url))
      setResults((prev) => ({ ...prev, [activeId]: verdict }))

      const passed = verdict.milestones.filter((m) => m.pass).length
      const total = verdict.milestones.length
      // refresh stats after a judgment
      try {
        const s: any = await read('stats')
        setStats({
          total_bounties: Number(s?.total_bounties ?? 0),
          judgments_made: Number(s?.judgments_made ?? 0),
        })
      } catch {
        /* non-fatal */
      }

      if (verdict.overall_pass) toast.success('All milestones passed', { description: `Score ${verdict.score}/100 · payout released.` })
      else if (passed === 0) toast.error('Bounty rejected', { description: 'No milestones met spec.' })
      else toast.warning(`${passed}/${total} milestones passed`, { description: `Score ${verdict.score}/100 · partial payout escrowed.` })
    } catch (e: any) {
      toast.error('Judgment failed', { description: e?.message ?? String(e) })
    } finally {
      setJudging(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#111827] text-gray-300">
      <Toaster theme="dark" position="top-right" richColors />
      {/* top bar */}
      <header className="sticky top-0 z-10 border-b border-gray-800 bg-[#111827]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FBBF24] text-[#111827]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2l2.4 6.9H22l-5.8 4.3 2.2 7L12 16.9 5.6 20.2l2.2-7L2 8.9h7.6z" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-gray-100">
                Bounty<span className="text-[#FBBF24]">Judge</span>
              </h1>
              <p className="font-mono text-[10px] text-gray-500">AI adjudication · per-milestone scoring</p>
            </div>
          </div>
          <div className="flex items-center gap-3 font-mono text-[10px] text-gray-500">
            <span className="hidden rounded-full border border-gray-700 px-3 py-1 sm:inline">
              ⛓ {CONTRACT.slice(0, 8)}…{CONTRACT.slice(-6)}
            </span>
            {stats && (
              <span className="hidden rounded-full border border-gray-700 px-3 py-1 md:inline">
                {stats.total_bounties} bounties · {stats.judgments_made} judged
              </span>
            )}
            <span className="rounded-full bg-[#FBBF24]/10 px-3 py-1 text-[#FBBF24]">
              {BOUNTIES.reduce((a, b) => a + b.reward, 0).toLocaleString()} USDC open
            </span>
            <button
              onClick={handleConnect}
              className={`rounded-full px-3 py-1 font-mono text-[10px] font-bold transition ${
                wallet
                  ? 'border border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                  : 'bg-[#FBBF24] text-[#111827] hover:bg-[#fcc94a]'
              }`}
            >
              {wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : 'Connect Wallet'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl grid-cols-1 gap-5 px-5 py-6 lg:grid-cols-[360px_1fr]">
        {/* board column */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-gray-500">bounty board</h2>
            <span className="font-mono text-[10px] text-gray-600">{BOUNTIES.length} open</span>
          </div>
          {BOUNTIES.map((b) => {
            const r = results[b.id]
            const score = r ? r.score : null
            const isActive = b.id === activeId
            return (
              <motion.button
                key={b.id}
                onClick={() => setActiveId(b.id)}
                whileHover={{ y: -2 }}
                className={`block w-full rounded-xl border p-4 text-left transition-colors ${
                  isActive
                    ? 'border-[#FBBF24]/60 bg-[#1b2030]'
                    : 'border-gray-800 bg-[#161c2b] hover:border-gray-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-gray-500">{b.id}</span>
                  <span className="rounded-full bg-gray-800 px-2 py-0.5 font-mono text-[9px] text-gray-400">
                    {b.tag}
                  </span>
                </div>
                <h3 className="mt-1.5 text-sm font-semibold leading-snug text-gray-100">{b.title}</h3>
                <p className="mt-0.5 font-mono text-[10px] text-gray-500">@{b.org}</p>

                {/* milestone progress */}
                <div className="mt-3 flex gap-1">
                  {b.milestones.map((m, i) => {
                    const v = r?.milestones[i]?.pass
                    return (
                      <div
                        key={m.id}
                        className={`h-1.5 flex-1 rounded-full ${
                          v === true ? 'bg-emerald-500' : v === false ? 'bg-red-500' : 'bg-gray-700'
                        }`}
                      />
                    )
                  })}
                </div>
                <div className="mt-2.5 flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-[#FBBF24]">
                    {b.reward.toLocaleString()} USDC
                  </span>
                  <span className="font-mono text-[10px] text-gray-500">
                    {score === null ? `${b.milestones.length} milestones` : `scored ${score}/100`}
                  </span>
                </div>
              </motion.button>
            )
          })}
        </div>

        {/* detail column */}
        <AnimatePresence mode="wait">
          <motion.section
            key={activeId}
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -18 }}
            transition={{ duration: 0.25 }}
            className="rounded-2xl border border-gray-800 bg-[#161c2b]"
          >
            <div className="border-b border-gray-800 p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 font-mono text-[11px] text-gray-500">
                    <span>{active.id}</span>
                    <span>·</span>
                    <span>@{active.org}</span>
                  </div>
                  <h2 className="mt-1 text-xl font-bold text-gray-100">{active.title}</h2>
                </div>
                <div className="rounded-xl border border-[#FBBF24]/30 bg-[#FBBF24]/10 px-4 py-2 text-right">
                  <div className="font-mono text-lg font-bold text-[#FBBF24]">{active.reward.toLocaleString()}</div>
                  <div className="font-mono text-[10px] text-[#FBBF24]/70">USDC bounty</div>
                </div>
              </div>
              <p className="mt-4 rounded-lg border border-gray-800 bg-[#111827] p-4 text-sm leading-relaxed text-gray-400">
                <span className="font-mono text-[10px] uppercase tracking-widest text-gray-600">spec</span>
                <br />
                {active.spec}
              </p>
            </div>

            {/* judge input */}
            <div className="border-b border-gray-800 p-6">
              <label className="font-mono text-[10px] uppercase tracking-widest text-gray-500">
                deliverable repository
              </label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <div className="flex flex-1 items-center rounded-lg border border-gray-700 bg-[#111827] px-3 focus-within:border-[#FBBF24]/60">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-gray-500">
                    <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49v-1.7c-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.36 1.12 2.94.86.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05a9.4 9.4 0 0 1 5 0c1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9v2.82c0 .27.18.6.69.49A10.26 10.26 0 0 0 22 12.25C22 6.58 17.52 2 12 2z" />
                  </svg>
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !judging && runJudge()}
                    placeholder="github_url resolved on-chain from submission"
                    disabled={judging}
                    className="w-full bg-transparent px-2 py-2.5 font-mono text-sm text-gray-200 outline-none placeholder:text-gray-600 disabled:opacity-50"
                  />
                </div>
                <button
                  onClick={runJudge}
                  disabled={judging}
                  className="flex items-center justify-center gap-2 rounded-lg bg-[#FBBF24] px-6 py-2.5 text-sm font-bold text-[#111827] transition hover:bg-[#fcc94a] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {judging ? (
                    <motion.span
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}
                      className="inline-block h-4 w-4 rounded-full border-2 border-[#111827]/40 border-t-[#111827]"
                    />
                  ) : (
                    '⚖'
                  )}
                  {judging ? 'Judging…' : 'Judge'}
                </button>
              </div>
              <AnimatePresence>
                {judging && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="mt-3 font-mono text-xs text-[#FBBF24]"
                  >
                    ▸ {phase}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>

            {/* milestone tracker */}
            <div className="p-6">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-widest text-gray-500">milestone verdicts</span>
                {activeResult && (
                  <span className="font-mono text-xs font-bold text-[#FBBF24]">{activeResult.score}/100</span>
                )}
              </div>
              <div className="mt-4 space-y-3">
                {(activeResult
                  ? activeResult.milestones.map((m, i) => ({
                      key: `r${i}`,
                      title: m.name,
                      pass: m.pass,
                      reason: m.reason,
                      idx: i,
                    }))
                  : active.milestones.map((m, i) => ({
                      key: m.id,
                      title: m.title,
                      pass: undefined as boolean | undefined,
                      reason: '',
                      idx: i,
                    }))
                ).map((m) => {
                  const v: 'pass' | 'fail' | undefined = m.pass === undefined ? undefined : m.pass ? 'pass' : 'fail'
                  return (
                    <motion.div
                      key={m.key}
                      initial={false}
                      animate={{ opacity: 1 }}
                      className="flex items-start gap-3 rounded-xl border border-gray-800 bg-[#111827] p-3.5"
                    >
                      <motion.div
                        initial={false}
                        animate={v ? { scale: [0.6, 1.15, 1], opacity: 1 } : { scale: 1, opacity: 1 }}
                        transition={{ delay: m.idx * 0.12, duration: 0.4 }}
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-xs font-bold ${
                          v === 'pass'
                            ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400'
                            : v === 'fail'
                              ? 'border-red-500 bg-red-500/20 text-red-400'
                              : 'border-gray-700 text-gray-600'
                        }`}
                      >
                        {v === 'pass' ? '✓' : v === 'fail' ? '✕' : m.idx + 1}
                      </motion.div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-200">{m.title}</p>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: v === 'pass' ? '100%' : v === 'fail' ? '20%' : '0%' }}
                            transition={{ delay: m.idx * 0.12, duration: 0.6, ease: 'easeOut' }}
                            className={`h-full rounded-full ${v === 'fail' ? 'bg-red-500' : 'bg-emerald-500'}`}
                          />
                        </div>
                        {m.reason && <p className="mt-2 text-xs leading-relaxed text-gray-500">{m.reason}</p>}
                      </div>
                      <div className="shrink-0 text-right">
                        <div
                          className={`font-mono text-[10px] font-bold uppercase ${
                            v === 'pass' ? 'text-emerald-400' : v === 'fail' ? 'text-red-400' : 'text-gray-600'
                          }`}
                        >
                          {v ?? 'pending'}
                        </div>
                      </div>
                    </motion.div>
                  )
                })}
              </div>

              <AnimatePresence>
                {activeResult && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mt-5 space-y-4"
                  >
                    {activeResult.reasoning && (
                      <div className="rounded-xl border border-gray-800 bg-[#111827] p-4">
                        <p className="font-mono text-[10px] uppercase tracking-widest text-gray-600">verdict reasoning</p>
                        <p className="mt-2 text-sm leading-relaxed text-gray-400">{activeResult.reasoning}</p>
                      </div>
                    )}
                    <div className="flex items-center justify-between rounded-xl border border-gray-800 bg-gradient-to-r from-[#FBBF24]/10 to-transparent p-4">
                      <div>
                        <p className="text-sm font-semibold text-gray-100">
                          Payout: {((activeResult.score / 100) * active.reward).toFixed(0)} / {active.reward.toLocaleString()} USDC
                        </p>
                        <p className="font-mono text-[11px] text-gray-500">
                          Released proportional to score · escrowed on contract
                        </p>
                      </div>
                      <button
                        onClick={async () => {
                          const tid = toast.loading('Reading payout status from contract…')
                          try {
                            const payout: any = await read('read_payout', [BOUNTY_KEY])
                            if (payout?.payable) {
                              toast.success('Payout unlocked on-chain', {
                                id: tid,
                                description: `Winner ${String(payout.winner).slice(0, 6)}…${String(payout.winner).slice(-4)} — escrow may release for bounty ${payout.bounty_key}.`,
                              })
                            } else {
                              toast.warning('Payout not yet unlocked', {
                                id: tid,
                                description: 'Bounty is not marked completed on-chain. All milestones must pass first.',
                              })
                            }
                          } catch (e: any) {
                            toast.error('Could not read payout', { id: tid, description: e?.message ?? String(e) })
                          }
                        }}
                        className="rounded-lg bg-[#FBBF24] px-5 py-2 text-sm font-bold text-[#111827] transition hover:bg-[#fcc94a]"
                      >
                        Check payout
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.section>
        </AnimatePresence>
      </main>
    </div>
  )
}
