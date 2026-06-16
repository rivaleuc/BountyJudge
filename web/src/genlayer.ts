import { createClient } from 'genlayer-js'
import { testnetBradbury } from 'genlayer-js/chains'
import type { Address } from 'genlayer-js/types'
export const CONTRACT = '0xaB2a96720ff2ecEA5994d8BA777D93e4a3D19E55' as Address
const BRADBURY_HEX = '0x107d'
let client = createClient({ chain: testnetBradbury })
let walletAddress: string | null = null
export function account(): string | null { return walletAddress }
export function isWalletConnected(): boolean { return walletAddress !== null }
async function ensureChain(eth: any) {
  const id: string = await eth.request({ method: 'eth_chainId' })
  if (id?.toLowerCase() !== BRADBURY_HEX) {
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BRADBURY_HEX }] })
    } catch (e: any) {
      if (e?.code === 4902 || /Unrecognized chain/i.test(e?.message ?? '')) {
        await eth.request({ method: 'wallet_addEthereumChain', params: [{ chainId: BRADBURY_HEX, chainName: 'GenLayer Bradbury Testnet', nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 }, rpcUrls: ['https://rpc-bradbury.genlayer.com'], blockExplorerUrls: ['https://explorer-bradbury.genlayer.com'] }] })
      } else throw e
    }
  }
}
export async function connectWallet(): Promise<string> {
  const eth = (globalThis as any).window?.ethereum
  if (!eth) throw new Error('MetaMask not found — install it to sign transactions.')
  const accounts: string[] = await eth.request({ method: 'eth_requestAccounts' })
  await ensureChain(eth)
  walletAddress = accounts[0]
  client = createClient({ chain: testnetBradbury, account: walletAddress as Address })
  return walletAddress
}
export async function read(fn: string, args: any[] = []) {
  return client.readContract({ address: CONTRACT, functionName: fn, args })
}
export async function write(fn: string, args: any[] = []) {
  if (!walletAddress) await connectWallet()
  const txHash = await client.writeContract({ address: CONTRACT, functionName: fn, args, value: 0n })
  await client.waitForTransactionReceipt({ hash: txHash, status: 'FINALIZED', retries: 60, interval: 5000 })
  return txHash
}
