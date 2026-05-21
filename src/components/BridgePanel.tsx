import { useState } from 'react'
import { BridgeChain } from '@circle-fin/app-kit'
declare global { interface Window { ethereum?: any } }

// Circle CCTP v2 sandbox / testnet
const IRIS = 'https://iris-api-sandbox.circle.com'
// CCTP V2 MessageTransmitter address — sama untuk semua testnet chain
const MESSAGE_TRANSMITTER_V2 = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275'
const ERC20_APPROVE = '0x095ea7b3'
const DEPOSIT_FOR_BURN_SELECTOR = '0x8e0250ee' // depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)

type ChainKey = 'Arc_Testnet' | 'Ethereum_Sepolia' | 'Base_Sepolia' | 'Arbitrum_Sepolia'

interface ChainCfg {
  id: ChainKey
  bridgeChain: BridgeChain
  label: string
  chainId: string
  domain: number
  tokenMessenger: string
  usdc: string
  explorer: string
  addParams: {
    chainId: string
    chainName: string
    nativeCurrency: { name: string; symbol: string; decimals: number }
    rpcUrls: string[]
    blockExplorerUrls: string[]
  }
}

const CHAINS: ChainCfg[] = [
  {
    id: 'Arc_Testnet',
    bridgeChain: BridgeChain.Arc_Testnet,
    label: 'Arc Testnet',
    chainId: '0x4cef52',
    domain: 26,
    tokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    usdc: '0x3600000000000000000000000000000000000000',
    explorer: 'https://testnet.arcscan.app',
    addParams: {
      chainId: '0x4cef52',
      chainName: 'Arc Testnet',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
      rpcUrls: ['https://rpc.testnet.arc.network/'],
      blockExplorerUrls: ['https://testnet.arcscan.app'],
    },
  },
  {
    id: 'Ethereum_Sepolia',
    bridgeChain: BridgeChain.Ethereum_Sepolia,
    label: 'Ethereum Sepolia',
    chainId: '0xaa36a7',
    domain: 0,
    tokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    explorer: 'https://sepolia.etherscan.io',
    addParams: {
      chainId: '0xaa36a7',
      chainName: 'Ethereum Sepolia',
      nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://rpc.sepolia.org'],
      blockExplorerUrls: ['https://sepolia.etherscan.io'],
    },
  },
  {
    id: 'Base_Sepolia',
    bridgeChain: BridgeChain.Base_Sepolia,
    label: 'Base Sepolia',
    chainId: '0x14a34',
    domain: 6,
    tokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    explorer: 'https://sepolia.basescan.org',
    addParams: {
      chainId: '0x14a34',
      chainName: 'Base Sepolia',
      nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://sepolia.base.org'],
      blockExplorerUrls: ['https://sepolia.basescan.org'],
    },
  },
  {
    id: 'Arbitrum_Sepolia',
    bridgeChain: BridgeChain.Arbitrum_Sepolia,
    label: 'Arbitrum Sepolia',
    chainId: '0x66eee',
    domain: 3,
    tokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    explorer: 'https://sepolia.arbiscan.io',
    addParams: {
      chainId: '0x66eee',
      chainName: 'Arbitrum Sepolia',
      nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://sepolia-rollup.arbitrum.io/rpc'],
      blockExplorerUrls: ['https://sepolia.arbiscan.io'],
    },
  },
]

function findChain(id: string): ChainCfg | undefined {
  return CHAINS.find(c => c.id === id)
}

function enc256(n: bigint) {
  return n.toString(16).padStart(64, '0')
}
function encAddr(a: string) {
  return a.slice(2).toLowerCase().padStart(64, '0')
}
function toHex(n: bigint) {
  return '0x' + n.toString(16)
}

async function ensureChain(target: ChainCfg) {
  const want = target.chainId.toLowerCase()
  const cur = ((await window.ethereum.request({ method: 'eth_chainId' })) as string || '').toLowerCase()
  if (cur === want) return
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: target.chainId }] })
  } catch (e: any) {
    const msg = String(e?.message || '')
    const needsAdd = e?.code === 4902 || e?.code === -32603 || /Unrecognized chain|not added|chain has not been added/i.test(msg)
    if (e?.code === 4001) throw new Error('Switch network ditolak. Setujui permintaan MetaMask untuk lanjut.')
    if (!needsAdd) throw new Error(`Gagal switch ke ${target.label}: ${msg || e?.code}`)
    try {
      await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [target.addParams] })
    } catch (addErr: any) {
      if (addErr?.code === 4001) throw new Error(`Penambahan ${target.label} ditolak. Tambahkan jaringan ini di MetaMask lalu coba lagi.`)
      throw new Error(`Gagal menambahkan ${target.label}: ${addErr?.message || addErr?.code}`)
    }
  }
  for (let i = 0; i < 15; i++) {
    const now = ((await window.ethereum.request({ method: 'eth_chainId' })) as string || '').toLowerCase()
    if (now === want) return
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error(`Gagal switch ke ${target.label}. Pilih jaringan ini di MetaMask lalu coba lagi.`)
}

// Hindari error "max fee per gas less than block base fee" (Arbitrum Sepolia, dll)
async function getFeeOverrides(): Promise<Record<string, string>> {
  try {
    const block = (await window.ethereum.request({ method: 'eth_getBlockByNumber', params: ['latest', false] })) as { baseFeePerGas?: string }
    const baseHex = block?.baseFeePerGas
    if (baseHex && baseHex !== '0x0') {
      const baseFee = BigInt(baseHex)
      const priority = 1_500_000_000n // 1.5 gwei
      const maxFee = baseFee * 3n + priority // ~3x base fee headroom + tip
      return { maxFeePerGas: toHex(maxFee), maxPriorityFeePerGas: toHex(priority) }
    }
  } catch {
    /* fallthrough */
  }
  try {
    const gp = BigInt((await window.ethereum.request({ method: 'eth_gasPrice' })) as string)
    return { gasPrice: toHex(gp * 2n + 1_000_000_000n) }
  } catch {
    return {}
  }
}

async function waitForReceipt(txHash: string, label: string) {
  for (let i = 0; i < 60; i++) {
    try {
      const rec = (await window.ethereum.request({ method: 'eth_getTransactionReceipt', params: [txHash] })) as { status?: string } | null
      if (rec?.status === '0x1') return
      if (rec?.status === '0x0') throw new Error(`${label} gagal di on-chain. Tx: ${txHash}`)
    } catch (e: any) {
      if (e?.message?.toLowerCase()?.includes('gagal')) throw e
    }
    await new Promise(r => setTimeout(r, 4000))
  }
  throw new Error(`${label} timeout menunggu konfirmasi. Tx: ${txHash}`)
}

async function fetchAttestation(srcDomain: number, burnTx: string, onTick: (attempt: number) => void): Promise<{ message: string; attestation: string }> {
  // Iris V2 sandbox API; CORS: access-control-allow-origin: *
  const url = `${IRIS}/v2/messages/${srcDomain}?transactionHash=${burnTx}`
  for (let i = 0; i < 90; i++) {
    onTick(i)
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' } })
      if (r.ok) {
        const j = (await r.json()) as { messages?: { status?: string; message?: string; attestation?: string }[] }
        const m = j?.messages?.[0]
        if (m?.status === 'complete' && m.message && m.attestation) {
          return { message: m.message, attestation: m.attestation }
        }
      } else if (r.status !== 404) {
        const t = await r.text().catch(() => '')
        console.warn('Iris non-OK', r.status, t.slice(0, 200))
      }
    } catch (err) {
      console.warn('Iris fetch error (retrying):', err)
    }
    await new Promise(r => setTimeout(r, 5000))
  }
  throw new Error(`Timeout menunggu attestation Circle (>7 menit). Burn tx: ${burnTx} — Anda bisa klaim mint manual nanti.`)
}

type BridgeStep = { name: string; state: 'pending' | 'success' | 'error'; txHash?: string; explorerUrl?: string }
type Status = { type: 'success' | 'error' | 'info'; msg: string; steps?: BridgeStep[] }
interface Props { address: string | null; circleWallet: { id: string; address: string } | null; balances: Record<string, string>; eoaBalances: Record<string, string>; onRefresh: () => void }

export function BridgePanel({ address, circleWallet: _circleWallet, balances, eoaBalances, onRefresh }: Props) {
  void _circleWallet
  const [fromChain, setFromChain] = useState<ChainKey>('Arc_Testnet')
  const [toChain, setToChain] = useState<ChainKey>('Ethereum_Sepolia')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState('')
  const [status, setStatus] = useState<Status | null>(null)
  const circleB = parseFloat(balances.USDC || '0')
  const eoaB = parseFloat(eoaBalances.USDC || '0')
  const totalB = circleB + eoaB
  const fee = amount ? (parseFloat(amount) * 0.0001).toFixed(6) : '-'
  const est = amount ? (parseFloat(amount) - parseFloat(fee === '-' ? '0' : fee)).toFixed(4) : '-'

  const handleBridge = async () => {
    if (!address || !amount || !window.ethereum) return
    setLoading(true)
    setStatus(null)
    const amtNum = parseFloat(amount)
    const amtMicro = BigInt(Math.round(amtNum * 1e6))
    const localSteps: BridgeStep[] = []
    try {
      const src = findChain(fromChain)
      const dst = findChain(toChain)
      if (!src) throw new Error('Konfigurasi chain sumber tidak ditemukan')
      if (!dst) throw new Error('Konfigurasi chain tujuan tidak ditemukan')

      // 1) Pastikan MetaMask berada di chain sumber
      setStep(`Switch ke ${src.label}...`)
      setStatus({ type: 'info', msg: `⏳ Pastikan MetaMask berada di ${src.label}...`, steps: [...localSteps] })
      await ensureChain(src)

      // 2) Preflight saldo USDC on-chain di source
      try {
        const balData = '0x70a08231' + encAddr(address)
        const balHex = (await window.ethereum.request({ method: 'eth_call', params: [{ to: src.usdc, data: balData }, 'latest'] })) as string
        const bal = BigInt(balHex || '0x0')
        if (bal < amtMicro) {
          const have = Number(bal) / 1e6
          throw new Error(`Saldo USDC di ${src.label} tidak cukup (tersedia ${have.toFixed(4)} USDC). Pindahkan USDC ke jaringan ini dulu atau ganti Dari Chain.`)
        }
      } catch (balErr: any) {
        if (balErr?.message?.startsWith('Saldo USDC')) throw balErr
        console.warn('Pre-flight balance check gagal:', balErr?.message)
      }

      // 3) Approve USDC ke TokenMessengerV2
      setStep('MetaMask: Approve USDC (1/3)...')
      setStatus({ type: 'info', msg: '⏳ MetaMask popup 1/3: Approve USDC...', steps: [...localSteps] })
      const approveFees = await getFeeOverrides()
      const approveTx = (await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{ from: address, to: src.usdc, data: ERC20_APPROVE + encAddr(src.tokenMessenger) + enc256(amtMicro), gas: '0x186a0', ...approveFees }],
      })) as string
      localSteps.push({ name: 'approve', state: 'pending', txHash: approveTx, explorerUrl: `${src.explorer}/tx/${approveTx}` })
      setStatus({ type: 'info', msg: '⏳ Menunggu approve dikonfirmasi...', steps: [...localSteps] })
      await waitForReceipt(approveTx, 'Approve')
      localSteps[localSteps.length - 1].state = 'success'
      setStatus({ type: 'info', msg: '✓ Approve sukses!\n⏳ MetaMask popup 2/3: Konfirmasi burn...', steps: [...localSteps] })

      // 4) depositForBurn di TokenMessengerV2
      setStep('MetaMask: Konfirmasi burn (2/3)...')
      const mintRecipient = encAddr(address)
      const burnData =
        DEPOSIT_FOR_BURN_SELECTOR +
        enc256(amtMicro) +
        enc256(BigInt(dst.domain)) +
        mintRecipient +
        encAddr(src.usdc) +
        enc256(0n) +
        enc256(0n) +
        enc256(2000n) // standard finality
      const burnFees = await getFeeOverrides()
      const burnTx = (await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{ from: address, to: src.tokenMessenger, data: burnData, gas: '0x493e0', ...burnFees }],
      })) as string
      localSteps.push({ name: 'burn', state: 'pending', txHash: burnTx, explorerUrl: `${src.explorer}/tx/${burnTx}` })
      setStatus({ type: 'info', msg: '⏳ Menunggu burn dikonfirmasi...', steps: [...localSteps] })
      await waitForReceipt(burnTx, 'Burn')
      localSteps[localSteps.length - 1].state = 'success'

      // 5) Polling attestation Circle Iris API langsung dari client
      setStep('Step 3/3: Menunggu attestation Circle (~30-90 detik)...')
      localSteps.push({ name: 'attestation', state: 'pending' })
      setStatus({ type: 'info', msg: '✓ Burn sukses!\n⏳ Menunggu attestation dari Circle (Iris API)...', steps: [...localSteps] })
      const { message, attestation } = await fetchAttestation(src.domain, burnTx, (i) => {
        if (i > 0 && i % 4 === 0) {
          setStatus({ type: 'info', msg: `⏳ Menunggu attestation Circle... (${i * 5}s)\nBurn tx: ${burnTx.slice(0, 12)}...`, steps: [...localSteps] })
        }
      })
      localSteps[localSteps.length - 1].state = 'success'
      setStatus({ type: 'info', msg: `✓ Attestation diterima!\n⏳ Switch ke ${dst.label} untuk mint...`, steps: [...localSteps] })

      // 6) Switch ke destination chain
      setStep(`Switch ke ${dst.label}...`)
      await ensureChain(dst)

      // 7) Mint via receiveMessage di MessageTransmitterV2 destination
      setStep(`MetaMask: Konfirmasi mint di ${dst.label} (3/3)...`)
      setStatus({ type: 'info', msg: `⏳ MetaMask popup 3/3: Mint di ${dst.label}...`, steps: [...localSteps] })
      const { encodeFunctionData } = await import('viem')
      const mintCalldata = encodeFunctionData({
        abi: [
          {
            type: 'function',
            name: 'receiveMessage',
            stateMutability: 'nonpayable',
            inputs: [
              { name: 'message', type: 'bytes' },
              { name: 'attestation', type: 'bytes' },
            ],
            outputs: [],
          },
        ],
        functionName: 'receiveMessage',
        args: [message as `0x${string}`, attestation as `0x${string}`],
      })
      const mintFees = await getFeeOverrides()
      const mintTx = (await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{ from: address, to: MESSAGE_TRANSMITTER_V2, data: mintCalldata, gas: '0x7a120', ...mintFees }],
      })) as string
      localSteps.push({ name: 'mint', state: 'pending', txHash: mintTx, explorerUrl: `${dst.explorer}/tx/${mintTx}` })
      setStatus({ type: 'info', msg: `⏳ Menunggu mint dikonfirmasi di ${dst.label}...`, steps: [...localSteps] })
      await waitForReceipt(mintTx, 'Mint')
      localSteps[localSteps.length - 1].state = 'success'

      setStatus({ type: 'success', msg: `✓ Bridge berhasil! ${amount} USDC → ${dst.label}`, steps: [...localSteps] })
      setAmount('')
      setTimeout(onRefresh, 3000)
      setTimeout(onRefresh, 10000)
    } catch (e: any) {
      setStatus({ type: 'error', msg: e?.message || 'Bridge gagal', steps: [...localSteps] })
    }
    setLoading(false)
    setStep('')
  }

  const STEP_LABELS: Record<string, string> = {
    approve: '1. Approve USDC',
    burn: '2. Burn',
    attestation: '3. Attestation',
    mint: '4. Mint',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className='glass' style={{ padding: 10, borderRadius: 10, fontSize: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}><span style={{ color: '#64748b' }}>🔵 Circle Wallet</span><span style={{ color: '#818cf8', fontWeight: 600 }}>{circleB.toFixed(4)} USDC</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}><span style={{ color: '#64748b' }}>🟡 MetaMask</span><span style={{ color: '#f59e0b', fontWeight: 600 }}>{eoaB.toFixed(4)} USDC</span></div>
        <div style={{ borderTop: '1px solid #1e1e2e', paddingTop: 3, display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Total</span><span style={{ fontWeight: 700 }}>{totalB.toFixed(4)} USDC</span></div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <label style={{ color: '#64748b', fontSize: 13 }}>Dari Chain</label>
        <button onClick={() => setAmount(totalB.toFixed(4))} style={{ color: '#818cf8', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: 0 }}>Max: {totalB.toFixed(4)}</button>
      </div>
      <select className='input' value={fromChain} onChange={e => setFromChain(e.target.value as ChainKey)}>
        {CHAINS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
      <div style={{ textAlign: 'center' }}>
        <button onClick={() => { const f = fromChain; setFromChain(toChain); setToChain(f) }} className='glass' style={{ padding: '6px 14px', borderRadius: 10, cursor: 'pointer', color: '#818cf8', fontSize: 18, border: '1px solid #1e1e2e', background: 'rgba(18,18,26,0.8)' }}>⇅</button>
      </div>
      <div>
        <label style={{ color: '#64748b', fontSize: 13, display: 'block', marginBottom: 6 }}>Ke Chain</label>
        <select className='input' value={toChain} onChange={e => setToChain(e.target.value as ChainKey)}>
          {CHAINS.filter(c => c.id !== fromChain).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>
      <div>
        <label style={{ color: '#64748b', fontSize: 13, display: 'block', marginBottom: 6 }}>Jumlah USDC</label>
        <input className='input' type='number' placeholder='0.00' value={amount} onChange={e => setAmount(e.target.value)} />
      </div>
      <div className='glass' style={{ padding: 10, borderRadius: 10, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Protocol</span><span>CCTP v2 Direct</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Fee</span><span>{fee} USDC</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Estimasi diterima</span><span style={{ color: '#10b981' }}>{est} USDC</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>MetaMask popup</span><span style={{ color: '#10b981' }}>✓ 3x (approve + burn + mint)</span></div>
      </div>
      {step && <div style={{ padding: 8, borderRadius: 8, background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', color: '#818cf8', fontSize: 12, textAlign: 'center' }}>⏳ {step}</div>}
      {status && (
        <div style={{ padding: 10, borderRadius: 10, fontSize: 13, whiteSpace: 'pre-line', background: status.type === 'success' ? 'rgba(16,185,129,0.1)' : status.type === 'info' ? 'rgba(99,102,241,0.1)' : 'rgba(239,68,68,0.1)', color: status.type === 'success' ? '#10b981' : status.type === 'info' ? '#818cf8' : '#f87171', border: status.type === 'success' ? '1px solid rgba(16,185,129,0.3)' : status.type === 'info' ? '1px solid rgba(99,102,241,0.3)' : '1px solid rgba(239,68,68,0.3)' }}>
          <div style={{ fontWeight: 600, marginBottom: status.steps?.length ? 6 : 0 }}>{status.msg}</div>
          {status.steps?.map((s, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 2 }}>
              <span style={{ color: '#64748b' }}>{STEP_LABELS[s.name] || s.name}</span>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ color: s.state === 'success' ? '#10b981' : s.state === 'pending' ? '#f59e0b' : '#f87171' }}>{s.state === 'success' ? '✓' : s.state === 'pending' ? '⏳' : '✗'}</span>
                {s.txHash && <a href={s.explorerUrl || '#'} target='_blank' rel='noreferrer' style={{ color: '#818cf8', fontSize: 10, fontFamily: 'monospace' }}>{s.txHash.slice(0, 8)}...→</a>}
              </div>
            </div>
          ))}
        </div>
      )}
      <button onClick={handleBridge} disabled={!amount || loading || fromChain === toChain || !address} className='btn btn-primary'>
        {loading ? step || '⏳ Memproses...' : amount ? `Bridge ${amount} USDC` : 'Bridge USDC'}
      </button>
      <div style={{ fontSize: 11, color: '#64748b', textAlign: 'center' }}>Bridge via CCTP v2 Direct. MetaMask popup 3x: approve + burn + mint.</div>
    </div>
  )
}
