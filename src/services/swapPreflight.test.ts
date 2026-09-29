// Menjaga urutan preflight swap EOA: simulasi (`eth_call`) harus dijalankan
// sebelum transaksi dikirim, permit yang ditolak adapter harus jatuh ke jalur
// approve (`permitType: 0`), dan revert yang terbaca harus menghentikan alur
// sebelum wallet diminta menandatangani transaksi yang pasti gagal.
import { toFunctionSelector } from 'viem'
import { describe, expect, it } from 'vitest'
import { runAdapterLeg } from './swapService'

const OWNER = '0x1111111111111111111111111111111111111111'
const SPENDER = '0x2222222222222222222222222222222222222222'
const TOKEN_IN = '0x3333333333333333333333333333333333333333'
const SIGNATURE = `0x${'11'.repeat(32)}${'22'.repeat(32)}1b`
const TX_HASH = `0x${'aa'.repeat(32)}`

const NONCES_SELECTOR = toFunctionSelector('function nonces(address)')
const ALLOWANCE_SELECTOR = toFunctionSelector('function allowance(address,address)')

const encodeUint = (value: bigint) => `0x${value.toString(16).padStart(64, '0')}`

type SimulateStep = { revert?: { data?: string; shortMessage?: string; message?: string } }

function adapterLeg(tokenIn: 'USDC' | 'EURC') {
  return {
    tokenIn,
    tokenOut: tokenIn === 'USDC' ? 'EURC' : 'USDC',
    tokenInAddress: TOKEN_IN,
    amountBaseUnits: '19000',
    amountOut: '0.015922',
    signature: `0x${'ab'.repeat(65)}`,
    executionParams: {
      instructions: [{
        target: TOKEN_IN,
        data: '0x',
        value: '0x0',
        tokenIn: TOKEN_IN,
        amountToApprove: '0x0',
        tokenOut: TOKEN_IN,
        minTokenOut: '0x0',
      }],
      tokens: [{ token: TOKEN_IN, beneficiary: OWNER }],
      execId: '0x1',
      deadline: `0x${(Math.floor(Date.now() / 1000) + 3600).toString(16)}`,
      metadata: '0x',
    },
  }
}

/**
 * Provider EIP-1193 palsu yang cukup untuk satu leg adapter: permit nonce,
 * allowance token, simulasi `eth_call` ke adapter, dan pengiriman transaksi.
 */
function makeProvider(options: { simulate: SimulateStep[]; allowance?: bigint }) {
  const simulations = [...options.simulate]
  const state = { allowance: options.allowance ?? 0n, spenderCalls: 0, spenderSends: [] as any[], tokenSends: [] as any[] }
  let receiptPending = 0

  const request = async ({ method, params }: { method: string; params?: any[] }) => {
    if (method === 'eth_chainId') return '0x13b2'
    if (method === 'eth_call') {
      const call = params?.[0] || {}
      if (String(call.to).toLowerCase() === SPENDER.toLowerCase()) {
        state.spenderCalls += 1
        const step = simulations.shift()
        if (step?.revert) throw Object.assign(new Error(step.revert.message || 'execution reverted'), step.revert)
        return '0x'
      }
      if (String(call.to).toLowerCase() === TOKEN_IN.toLowerCase()) {
        const data = String(call.data || '')
        if (data.startsWith(NONCES_SELECTOR)) return encodeUint(0n)
        if (data.startsWith(ALLOWANCE_SELECTOR)) return encodeUint(state.allowance)
      }
      return '0x'
    }
    if (method === 'eth_signTypedData_v4') return SIGNATURE
    if (method === 'eth_estimateGas') return '0x5208'
    if (method === 'eth_getBlockByNumber') return { baseFeePerGas: '0x3b9aca00' }
    if (method === 'eth_maxPriorityFeePerGas') return '0x59682f00'
    if (method === 'eth_gasPrice') return '0x3b9aca00'
    if (method === 'eth_sendTransaction' || method === 'wallet_sendTransaction') {
      const tx = params?.[0] || {}
      if (String(tx.to).toLowerCase() === SPENDER.toLowerCase()) state.spenderSends.push(tx)
      else {
        state.tokenSends.push(tx)
        // Setelah approve, allowance tersedia — sama seperti perilaku on-chain.
        state.allowance = 19000n
      }
      receiptPending += 1
      return TX_HASH
    }
    if (method === 'eth_getTransactionReceipt') {
      if (receiptPending > 0) receiptPending -= 1
      return { status: '0x1' }
    }
    throw new Error(`method ${method} tidak diharapkan`)
  }

  return { ethereum: { request }, state }
}

describe('runAdapterLeg', () => {
  it('mengirim permit tanpa approve saat simulasi lolos', async () => {
    const provider = makeProvider({ simulate: [{}] })
    const steps: any[] = []
    const tx = await runAdapterLeg({
      ethereum: provider.ethereum as any,
      owner: OWNER,
      spender: SPENDER,
      leg: adapterLeg('USDC') as any,
      steps,
    })

    expect(tx).toBe(TX_HASH)
    expect(provider.state.spenderSends).toHaveLength(1)
    expect(provider.state.tokenSends).toHaveLength(0)
    expect(steps.map(step => step.name)).toEqual(['Permit USDC', 'USDC → EURC'])
  })

  it('jatuh ke approve saat adapter menolak permit, lalu tetap mengirim leg', async () => {
    const provider = makeProvider({
      simulate: [
        { revert: { data: '0x8baa579f', message: 'execution reverted' } },
        {},
      ],
    })
    const steps: any[] = []
    const tx = await runAdapterLeg({
      ethereum: provider.ethereum as any,
      owner: OWNER,
      spender: SPENDER,
      leg: adapterLeg('USDC') as any,
      steps,
    })

    expect(tx).toBe(TX_HASH)
    expect(provider.state.spenderCalls).toBe(2)
    expect(provider.state.tokenSends).toHaveLength(1)
    expect(provider.state.spenderSends).toHaveLength(1)
    // Approve harus tercatat sebelum hasil swap, bukan menggantikannya.
    expect(steps.map(step => step.name)).toEqual(['Approve USDC', 'USDC → EURC'])
  })

  it('berhenti sebelum kirim saat revert tetap terbaca setelah fallback', async () => {
    const provider = makeProvider({
      simulate: [
        { revert: { data: '0x8baa579f', message: 'execution reverted' } },
        { revert: { data: '0x08c379a0' + '20'.padStart(64, '0') + (44).toString(16).padStart(64, '0') + Buffer.from('ERC20: transfer amount exceeds allowance').toString('hex').padEnd(64, '0') } },
      ],
      allowance: 19000n,
    })
    const steps: any[] = []
    await expect(runAdapterLeg({
      ethereum: provider.ethereum as any,
      owner: OWNER,
      spender: SPENDER,
      leg: adapterLeg('USDC') as any,
      steps,
    })).rejects.toThrow(/Simulasi swap USDC → EURC gagal sebelum dikirim ke wallet: ERC20: transfer amount exceeds allowance/)

    expect(provider.state.spenderSends).toHaveLength(0)
  })

  it('tetap mengirim saat simulasi tidak konklusif (wallet tanpa eth_call)', async () => {
    const provider = makeProvider({
      simulate: [{ revert: { message: 'Method not found', data: undefined } }],
      allowance: 19000n,
    })
    const steps: any[] = []
    const tx = await runAdapterLeg({
      ethereum: provider.ethereum as any,
      owner: OWNER,
      spender: SPENDER,
      leg: adapterLeg('EURC') as any,
      steps,
    })

    expect(tx).toBe(TX_HASH)
    expect(provider.state.spenderSends).toHaveLength(1)
    expect(steps.map(step => step.name)).toEqual(['EURC → USDC'])
  })
})
