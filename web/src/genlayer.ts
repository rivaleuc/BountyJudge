import { createClient, createAccount } from 'genlayer-js'
import { testnetBradbury } from 'genlayer-js/chains'
import type { Address } from 'genlayer-js/types'
export const CONTRACT = '0x867FC12E89606f7d55d92e5fcE26e1c67D3Af229' as Address
const PK = (import.meta.env.VITE_BURNER_PK ?? '') as `0x${string}`
const account = PK ? createAccount(PK) : undefined
export const client = createClient({ chain: testnetBradbury, account })
export async function read(fn: string, args: any[] = []) { return client.readContract({ address: CONTRACT, functionName: fn, args }) }
export async function write(fn: string, args: any[] = []) {
  const txHash = await client.writeContract({ address: CONTRACT, functionName: fn, args, value: 0n })
  await client.waitForTransactionReceipt({ hash: txHash, status: 'FINALIZED' as any, retries: 60, interval: 5000 })
  return txHash
}
