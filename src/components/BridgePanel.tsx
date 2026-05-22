import { useState, useEffect } from 'react'
import { CHAINS, IRIS, MESSAGE_TRANSMITTER_V2, findChain, type ChainCfg, type ChainKey } from '../chains'
import { txHistory } from '../txHistory'
import { bridgeWithAppKit, connectSolanaWallet, disconnectSolanaWallet, getConnectedSolanaPubkey, getSolBalance, getUsdcBalance, getSolanaKind, detectSolanaKind, type AppKitChain } from '../appKit'
import { wrapSolflare, wrapPhantom } from '../solflareWrapper'
import { PublicKey, Transaction, Connection, TransactionInstruction, VersionedTransaction } from '@solana/web3.js'
import { Buffer } from 'buffer'

const ERC20_APPROVE = '0x095ea7b3'
const DEPOSIT_FOR_BURN_SELECTOR = '0x8e0250ee' // depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)
const ERC20_BALANCE_OF = '0x70a08231'
const FAST_FINALITY_THRESHOLD = 1000n

function enc256(n: bigint) {
  return n.toString(16).padStart(64, '0')
}
function encAddr(a: string) {
  return a.slice(2).toLowerCase().padStart(64, '0')
}
function toHex(n: bigint) {
  return '0x' + n.toString(16)
}
function bytes32FromSolanaPubkey(pubkeyB58: string): string {
  // Decode base58 -> 32 bytes -> hex
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let intVal = 0n
  for (const ch of pubkeyB58) {
    const idx = alphabet.indexOf(ch)
    if (idx < 0) throw new Error('Alamat Solana tidak valid (base58)')
    intVal = intVal * 58n + BigInt(idx)
  }
  let hex = intVal.toString(16)
  if (hex.length > 64) throw new Error('Alamat Solana tidak valid (terlalu panjang)')
  hex = hex.padStart(64, '0')
  // leading zeros from base58 '1'
  let leading = 0
  for (const ch of pubkeyB58) {
    if (ch === '1') leading++
    else break
  }
  // each leading '1' represents one zero byte, ensure we have at least 32 bytes
  if (leading > 0 && hex.length < 64) hex = '00'.repeat(leading) + hex
  return hex.padStart(64, '0')
}

async function ensureChain(target: ChainCfg) {
  if (!target.isEvm || !target.chainId || !target.addParams) {
    throw new Error(`${target.label} bukan jaringan EVM — tidak bisa switch via MetaMask`)
  }
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

async function getFeeOverrides(): Promise<Record<string, string>> {
  try {
    const block = (await window.ethereum.request({ method: 'eth_getBlockByNumber', params: ['latest', false] })) as { baseFeePerGas?: string }
    const baseHex = block?.baseFeePerGas
    if (baseHex && baseHex !== '0x0') {
      const baseFee = BigInt(baseHex)
      const priority = 1_500_000_000n
      const maxFee = baseFee * 3n + priority
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
    await new Promise(r => setTimeout(r, 3000))
  }
  throw new Error(`${label} timeout menunggu konfirmasi. Tx: ${txHash}`)
}

async function fetchMaxFee(srcDomain: number, dstDomain: number, amtMicro: bigint): Promise<bigint> {
  // Iris fees endpoint returns fee in basis points (with decimals e.g. 1.3)
  try {
    const r = await fetch(`${IRIS}/v2/burn/USDC/fees/${srcDomain}/${dstDomain}`, { headers: { Accept: 'application/json' } })
    if (r.ok) {
      const arr = (await r.json()) as { finalityThreshold: number; minimumFee: number }[]
      const fast = arr.find(f => f.finalityThreshold === 1000)
      const feeBps = fast?.minimumFee ?? 14
      // hundredths-of-a-bps to avoid float: (amount * (feeBps + 1) * 100) / 1_000_000
      const feeNumerator = BigInt(Math.ceil((feeBps + 1) * 100))
      let fee = (amtMicro * feeNumerator) / 1_000_000n
      if (fee === 0n) fee = 1n
      // safety cap so maxFee tidak melebihi amount
      if (fee >= amtMicro) fee = amtMicro - 1n
      return fee
    }
  } catch (e) {
    console.warn('Iris fees fetch gagal, fallback 14bps + buffer:', e)
  }
  // Fallback konservatif: 15bps
  let fee = (amtMicro * 15n) / 10_000n
  if (fee === 0n) fee = 1n
  if (fee >= amtMicro) fee = amtMicro - 1n
  return fee
}

async function fetchAttestation(
  srcDomain: number,
  burnTx: string,
  onTick: (attempt: number, elapsedSec: number) => void
): Promise<{ message: string; attestation: string }> {
  // Fast Transfer: poll setiap ~2 detik. Total tunggu maksimum 5 menit.
  const intervalMs = 2000
  const maxAttempts = 150
  const url = `${IRIS}/v2/messages/${srcDomain}?transactionHash=${burnTx}`
  let consecutive404 = 0
  for (let i = 0; i < maxAttempts; i++) {
    onTick(i, Math.round((i * intervalMs) / 1000))
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' } })
      if (r.ok) {
        const j = (await r.json()) as { messages?: { status?: string; message?: string; attestation?: string }[] }
        const m = j?.messages?.[0]
        if (m?.status === 'complete' && m.message && m.attestation) {
          return { message: m.message, attestation: m.attestation }
        }
      } else if (r.status === 404) {
        // burn belum terindeks Iris — lanjut polling
        consecutive404++
      } else {
        const t = await r.text().catch(() => '')
        console.warn('Iris non-OK', r.status, t.slice(0, 200))
      }
    } catch (err) {
      console.warn('Iris fetch error (retrying):', err)
    }
    await new Promise(r => setTimeout(r, intervalMs))
  }
  if (consecutive404 > 100) {
    throw new Error(`Iris belum mengindeks burn tx ${burnTx} setelah 5 menit. Mungkin Fast Transfer tidak tersedia untuk pasangan ini — coba ganti maxFee/threshold atau periksa explorer.`)
  }
  throw new Error(`Timeout menunggu attestation Circle (>5 menit). Burn tx: ${burnTx}.`)
}

type BridgeStep = { name: string; state: 'pending' | 'success' | 'error'; txHash?: string; explorerUrl?: string }
type Status = { type: 'success' | 'error' | 'info'; msg: string; steps?: BridgeStep[] }
interface Props { address: string | null; circleWallet: { id: string; address: string } | null; balances: Record<string, string>; eoaBalances: Record<string, string>; onRefresh: () => void }

export function BridgePanel({ address, circleWallet: _circleWallet, balances, eoaBalances, onRefresh }: Props) {
  void _circleWallet
  const [fromChain, setFromChain] = useState<ChainKey>('Arc_Testnet')
  const [toChain, setToChain] = useState<ChainKey>('Solana_Devnet')
  const [amount, setAmount] = useState('')
  const [solanaRecipient, setSolanaRecipient] = useState('')
  const [solanaConnected, setSolanaConnected] = useState<string | null>(null)
  const [solBalance, setSolBalance] = useState<number>(0)
  const [solUsdcBalance, setSolUsdcBalance] = useState<number>(0)
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState('')
  const [status, setStatus] = useState<Status | null>(null)
  const circleB = parseFloat(balances.USDC || '0')
  const eoaB = parseFloat(eoaBalances.USDC || '0')
  const totalB = circleB + eoaB
  const fee = amount ? (parseFloat(amount) * 0.00013).toFixed(6) : '-'
  const est = amount ? (parseFloat(amount) - parseFloat(fee === '-' ? '0' : fee)).toFixed(4) : '-'

  const dstIsSolana = toChain === 'Solana_Devnet'
  const srcIsSolana = fromChain === 'Solana_Devnet'
  const involvesSolana = dstIsSolana || srcIsSolana

  // Auto-detect Solana wallet on mount + set kind + fetch balance
  useEffect(() => {
    detectSolanaKind() // side-effect: set _solanaKind internals
    const pk = getConnectedSolanaPubkey()
    if (pk) {
      setSolanaConnected(pk)
      getSolBalance(pk).then(b => setSolBalance(b))
      getUsdcBalance(pk).then(b => setSolUsdcBalance(b))
    }
  }, [])

  const handleConnectSolana = async () => {
    try {
      const kind = getSolanaKind() || 'solflare'
      const pk = await connectSolanaWallet(kind)
      setSolanaConnected(pk)
      const [sol, usdc] = await Promise.all([getSolBalance(pk), getUsdcBalance(pk)])
      setSolBalance(sol)
      setSolUsdcBalance(usdc)
      setStatus({ type: 'info', msg: `✓ Wallet Solana terhubung: ${pk.slice(0, 6)}...${pk.slice(-4)}` })
    } catch (e: any) {
      setStatus({ type: 'error', msg: e?.message || 'Gagal connect wallet Solana' })
    }
  }

  const handleDisconnectSolana = async () => {
    await disconnectSolanaWallet()
    setSolanaConnected(null)
    setSolBalance(0)
    setSolUsdcBalance(0)
  }

  // ========================================================================
  // App Kit SDK path — dipakai untuk semua bridge yang melibatkan Solana
  // (Solana ↔ Arc, Solana ↔ Eth Sepolia, dst). Sesuai docs.arc.io/app-kit/bridge.
  // ========================================================================
  const handleBridgeAppKit = async () => {
    if (!amount) return
    const src = findChain(fromChain)
    const dst = findChain(toChain)
    if (!src || !dst) {
      setStatus({ type: 'error', msg: 'Konfigurasi chain tidak ditemukan' })
      return
    }
    if (!solanaConnected) {
      setStatus({ type: 'error', msg: 'Hubungkan wallet Solana (Solflare) dulu untuk bridge yang melibatkan Solana.' })
      return
    }
    if (!srcIsSolana && !address) {
      setStatus({ type: 'error', msg: 'Hubungkan MetaMask juga untuk bridge dari EVM.' })
      return
    }
    setLoading(true)
    setStatus({ type: 'info', msg: `⏳ Memulai bridge ${amount} USDC dari ${src.label} ke ${dst.label} via App Kit SDK...` })
    setStep('App Kit: Approve & Sign...')
    const txId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    txHistory.add({
      id: txId,
      ts: Date.now(),
      from: src.label,
      to: dst.label,
      amount,
      status: 'pending',
      srcDomain: src.domain,
      dstDomain: dst.domain,
    })
    try {
      // Pastikan MetaMask berada di chain sumber EVM sebelum App Kit memanggil signer.
      // Tanpa ini, kit.bridge() akan melakukan tx ke chain yang salah dan gagal —
      // ini penyebab utama "bridge Arc → Solana error" sebelumnya.
      if (!srcIsSolana && src.isEvm) {
        setStep(`Switch MetaMask ke ${src.label}...`)
        await ensureChain(src)
      }
      // Tentukan recipient untuk arah ini:
      //   Arc → Solana   : recipient = pubkey Solflare yang terhubung
      //   Solana → Arc   : recipient = alamat MetaMask EVM yang terhubung
      // Tanpa ini, App Kit akan meminta user mengonfirmasi alamat tujuan
      // di adapter destinasi (sering bikin gagal di Devnet).
      let recipient: string | undefined
      if (dstIsSolana) {
        recipient = solanaConnected || solanaRecipient.trim() || undefined
        if (!recipient) {
          throw new Error('Alamat penerima Solana belum diset. Connect Solflare atau isi pubkey base58.')
        }
      } else if (srcIsSolana && dst.isEvm) {
        if (!address) {
          throw new Error('Hubungkan MetaMask sebagai penerima sebelum bridge dari Solana.')
        }
        recipient = address
      }

      const result: any = await bridgeWithAppKit({
        from: fromChain as AppKitChain,
        to: toChain as AppKitChain,
        amount,
        speed: 'SLOW',
        recipient,
      })
      // Cari step mint dan inspect status sebenarnya — jangan asumsi sukses
      // hanya karena promise resolve. SDK bisa return dengan state='pending'
      // (relayer ditunda) atau step.mint dgn errorMessage.
      const steps: any[] = Array.isArray(result?.steps) ? result.steps : []
      const burnStep = steps.find((s) => /burn/i.test(s?.name || ''))
      const mintStep = steps.find((s) => /mint/i.test(s?.name || ''))
      const burnTx = burnStep?.txHash || result?.burnTx || result?.sourceTx || result?.fromTx?.hash
      const mintTx = mintStep?.txHash || result?.mintTx || result?.destinationTx || result?.toTx?.hash
      const overallState: string = result?.state || 'unknown'
      const mintState: string = mintStep?.state || 'unknown'
      const mintErrorMsg: string | undefined = mintStep?.errorMessage
      const wasForwarded: boolean = mintStep?.forwarded === true
      const stateLine = `state=${overallState} | mint=${mintState}${wasForwarded ? ' (forwarder)' : ''}`
      txHistory.update(txId, {
        status: overallState === 'success' && mintState === 'success' ? 'success' : 'pending',
        burnTx,
        mintTx,
        burnExplorerUrl: burnTx && src.explorer ? `${src.explorer}/tx/${burnTx}` : undefined,
        mintExplorerUrl: mintTx && dst.explorer ? `${dst.explorer}/tx/${mintTx}` : undefined,
      })
      // Susun pesan status yang akurat — tampil langsung di layar HP
      // tanpa perlu DevTools. Ini menggantikan asumsi "selalu sukses".
      if (mintState === 'success' && overallState === 'success') {
        setStatus({
          type: 'success',
          msg: `✓ Bridge sukses!\n${amount} USDC: ${src.label} → ${dst.label}\n${stateLine}` +
            (burnTx ? `\nBurn tx: ${String(burnTx).slice(0, 16)}...` : '') +
            (mintTx ? `\nMint tx: ${String(mintTx).slice(0, 16)}...` : ''),
        })
      } else if (mintState === 'error' || overallState === 'error') {
        setStatus({
          type: 'error',
          msg: `✗ Mint GAGAL di ${dst.label}\n${stateLine}` +
            (mintErrorMsg ? `\nAlasan: ${mintErrorMsg}` : '') +
            (burnTx ? `\nBurn tx (USDC sudah di-burn): ${String(burnTx).slice(0, 24)}...` : '') +
            `\n\nUSDC Anda di-burn tapi belum di-mint. Hubungi support atau retry mint manual.`,
        })
      } else {
        // pending — relayer/forwarder belum eksekusi
        setStatus({
          type: 'success',
          msg: `⏳ Bridge MASIH PENDING\n${amount} USDC: ${src.label} → ${dst.label}\n${stateLine}` +
            (burnTx ? `\nBurn tx: ${String(burnTx).slice(0, 16)}...` : '') +
            (wasForwarded ? `\n\nMint sedang diproses Circle Forwarder. Tunggu 1-5 menit lalu cek saldo Solflare.`
                          : `\n\nMint belum tereksekusi. Mungkin perlu relayer manual atau retry.`),
        })
      }
      setAmount('')
      setTimeout(onRefresh, 3000)
      setTimeout(onRefresh, 10000)
    } catch (e: any) {
      const errMsg = e?.message || 'Bridge App Kit gagal'
      setStatus({ type: 'error', msg: errMsg })
    txHistory.update(txId, { status: 'error', error: errMsg })
    }
    setLoading(false)
    setStep('')
  }

  const handleBridge = async () => {
    if (involvesSolana) {
      // Pakai App Kit SDK untuk semua kasus yang melibatkan Solana.
      // Ini mengikuti rekomendasi resmi docs.arc.io/app-kit/bridge.
      await handleBridgeAppKit()
      return
    }
    // ----- EVM ↔ EVM: pakai flow CCTP manual lama (sudah tested) -----
    if (!address || !amount || !window.ethereum) return
    const src = findChain(fromChain)
    const dst = findChain(toChain)
    if (!src || !dst) {
      setStatus({ type: 'error', msg: 'Konfigurasi chain tidak ditemukan' })
      return
    }
    if (!src.isEvm) {
      setStatus({ type: 'error', msg: 'Source chain non-EVM belum didukung dari MetaMask. Pilih Arc/Eth/Base/Arbitrum sebagai Dari Chain.' })
      return
    }
    let mintRecipientHex: string
    if (dst.isEvm) {
      mintRecipientHex = encAddr(address)
    } else {
      // Solana → ambil dari input pubkey base58
      if (!solanaRecipient.trim()) {
        setStatus({ type: 'error', msg: 'Masukkan alamat Solana (base58 pubkey) sebagai tujuan.' })
        return
      }
      try {
        mintRecipientHex = bytes32FromSolanaPubkey(solanaRecipient.trim())
      } catch (e: any) {
        setStatus({ type: 'error', msg: e?.message || 'Alamat Solana tidak valid' })
        return
      }
    }

    setLoading(true)
    setStatus(null)
    const amtNum = parseFloat(amount)
    const amtMicro = BigInt(Math.round(amtNum * 1e6))
    const localSteps: BridgeStep[] = []
    const txId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    txHistory.add({
      id: txId,
      ts: Date.now(),
      from: src.label,
      to: dst.label,
      amount,
      status: 'pending',
      srcDomain: src.domain,
      dstDomain: dst.domain,
    })

    try {
      if (!src.usdc || !src.tokenMessenger) throw new Error('Konfigurasi USDC/TokenMessenger sumber tidak ditemukan')

      // 1) Switch ke chain sumber
      setStep(`Switch ke ${src.label}...`)
      setStatus({ type: 'info', msg: `⏳ Pastikan MetaMask berada di ${src.label}...`, steps: [...localSteps] })
      await ensureChain(src)

      // 2) Preflight saldo
      try {
        const balData = ERC20_BALANCE_OF + encAddr(address)
        const balHex = (await window.ethereum.request({ method: 'eth_call', params: [{ to: src.usdc, data: balData }, 'latest'] })) as string
        const bal = BigInt(balHex || '0x0')
        if (bal < amtMicro) {
          const have = Number(bal) / 1e6
          throw new Error(`Saldo USDC di ${src.label} tidak cukup (tersedia ${have.toFixed(4)} USDC).`)
        }
      } catch (balErr: any) {
        if (balErr?.message?.startsWith('Saldo USDC')) throw balErr
        console.warn('Pre-flight balance check gagal:', balErr?.message)
      }

      // 3) Approve
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

      // 4) depositForBurn — FAST TRANSFER (threshold 1000)
      // Beberapa instant-finality chain (Arc) tidak mendukung Fast Transfer; otomatis fallback ke Standard.
      const useFast = !src.isInstantFinality
      const finalityThreshold = useFast ? FAST_FINALITY_THRESHOLD : 2000n
      const maxFee = useFast ? await fetchMaxFee(src.domain, dst.domain, amtMicro) : 0n

      setStatus({ type: 'info', msg: `✓ Approve sukses!\n⏳ MetaMask popup 2/3: Burn (${useFast ? 'Fast' : 'Standard'} Transfer, maxFee=${(Number(maxFee) / 1e6).toFixed(6)} USDC)...`, steps: [...localSteps] })
      setStep('MetaMask: Konfirmasi burn (2/3)...')
      const burnData =
        DEPOSIT_FOR_BURN_SELECTOR +
        enc256(amtMicro) +
        enc256(BigInt(dst.domain)) +
        mintRecipientHex +
        encAddr(src.usdc) +
        enc256(0n) + // destinationCaller = 0 (any)
        enc256(maxFee) +
        enc256(finalityThreshold)
      const burnFees = await getFeeOverrides()
      const burnTx = (await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{ from: address, to: src.tokenMessenger, data: burnData, gas: '0x493e0', ...burnFees }],
      })) as string
      localSteps.push({ name: 'burn', state: 'pending', txHash: burnTx, explorerUrl: `${src.explorer}/tx/${burnTx}` })
      txHistory.update(txId, { burnTx, burnExplorerUrl: `${src.explorer}/tx/${burnTx}` })
      setStatus({ type: 'info', msg: '⏳ Menunggu burn dikonfirmasi...', steps: [...localSteps] })
      await waitForReceipt(burnTx, 'Burn')
      localSteps[localSteps.length - 1].state = 'success'

      // 5) Attestation
      setStep(`Step 3/3: Menunggu attestation Circle (${useFast ? 'Fast ~8-20s' : 'Standard ~13min'})...`)
      localSteps.push({ name: 'attestation', state: 'pending' })
      setStatus({ type: 'info', msg: `✓ Burn sukses!\n⏳ Polling Iris API (${useFast ? 'fast' : 'standard'})...`, steps: [...localSteps] })
      const { message, attestation } = await fetchAttestation(src.domain, burnTx, (i, sec) => {
        if (i > 0 && i % 5 === 0) {
          setStatus({ type: 'info', msg: `⏳ Attestation Circle... (${sec}s)\nBurn tx: ${burnTx.slice(0, 12)}...`, steps: [...localSteps] })
        }
      })
      localSteps[localSteps.length - 1].state = 'success'

      // 6) Mint — hanya untuk destination EVM
      if (dst.isEvm) {
        setStatus({ type: 'info', msg: `✓ Attestation diterima!\n⏳ Switch ke ${dst.label} untuk mint...`, steps: [...localSteps] })
        setStep(`Switch ke ${dst.label}...`)
        await ensureChain(dst)

        setStep(`MetaMask: Konfirmasi mint di ${dst.label} (3/3)...`)
        setStatus({ type: 'info', msg: `⏳ MetaMask popup 3/3: Mint di ${dst.label}...`, steps: [...localSteps] })
        // @ts-ignore // ignore missing viem types if not installed
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
        txHistory.update(txId, { mintTx, mintExplorerUrl: `${dst.explorer}/tx/${mintTx}` })
        setStatus({ type: 'info', msg: `⏳ Menunggu mint dikonfirmasi di ${dst.label}...`, steps: [...localSteps] })
        await waitForReceipt(mintTx, 'Mint')
        localSteps[localSteps.length - 1].state = 'success'

        setStatus({ type: 'success', msg: `✓ Bridge berhasil! ${amount} USDC → ${dst.label}`, steps: [...localSteps] })
        txHistory.update(txId, { status: 'success' })
      } else {
        // Destination Solana — mint on-chain via Solflare/Phantom wallet
        // Build Solana transaction to call MessageTransmitterV2.receiveMessage(message, attestation)
let rawProvider = (window as any).solflare ?? (window as any).phantom?.solana
        if (!rawProvider) {
          throw new Error('Wallet Solana tidak terdeteksi. Install Solflare atau Phantom.')
        }
        // Wrap the raw provider to ensure consistent signTransaction handling
        if ((window as any).solflare) {
          rawProvider = wrapSolflare((window as any).solflare)
        } else if ((window as any).phantom?.solana) {
          rawProvider = wrapPhantom((window as any).phantom.solana)
        }
        if (!rawProvider) {
          throw new Error('Wallet Solana tidak terdeteksi. Install Solflare atau Phantom.')
        }
        // Ensure wallet is connected
        if (!rawProvider.isConnected) {
          await rawProvider.connect()
        }
        const connection = new Connection('https://api.devnet.solana.com', 'confirmed')
        const programId = new PublicKey(MESSAGE_TRANSMITTER_V2)
        const messageBytes = Buffer.from(message.slice(2), 'hex')
        const attestationBytes = Buffer.from(attestation.slice(2), 'hex')
        const data = Buffer.concat([messageBytes, attestationBytes])
        const instruction = new TransactionInstruction({ keys: [], programId, data })
        // Build transaction compatible with provider type
        let txToSign: any
        if (rawProvider.isSolflare) {
          // Solflare expects VersionedTransaction
          const recent = await connection.getLatestBlockhash()
          const { MessageV0 } = await import('@solana/web3.js')
          const messageV0 = MessageV0.compile({
            payerKey: new PublicKey(rawProvider.publicKey),
            recentBlockhash: recent.blockhash,
            instructions: [instruction],
          })
          txToSign = new VersionedTransaction(messageV0)
        } else {
          // Phantom (or generic) works with legacy Transaction
          const transaction = new Transaction().add(instruction)
          transaction.feePayer = new PublicKey(rawProvider.publicKey)
          const { blockhash } = await connection.getLatestBlockhash()
          transaction.recentBlockhash = blockhash
          txToSign = transaction
        }
        // Sign and send transaction via wallet
        const signed = await rawProvider.signTransaction(txToSign)
        const rawTx = signed.serialize()
        const txSignature = await connection.sendRawTransaction(rawTx)
        await connection.confirmTransaction(txSignature, 'processed')
        localSteps.push({ name: 'mint', state: 'pending', txHash: txSignature, explorerUrl: `${dst.explorer}/tx/${txSignature}` })
        txHistory.update(txSignature, { mintTx: txSignature, mintExplorerUrl: `${dst.explorer}/tx/${txSignature}` })
        setStatus({ type: 'info', msg: `⏳ Menunggu konfirmasi mint di Solana...`, steps: [...localSteps] })
        // Simple wait for finality (few seconds)
        await new Promise(r => setTimeout(r, 4000))
        localSteps[localSteps.length - 1].state = 'success'
        setStatus({ type: 'success', msg: `✓ Mint di Solana berhasil!`, steps: [...localSteps] })
        ;(window as any).__lastCctpAttestation = { message, attestation, burnTx }
      }

      setAmount('')
      setTimeout(onRefresh, 3000)
      setTimeout(onRefresh, 10000)
    } catch (e: any) {
      const errMsg = e?.message || 'Bridge gagal'
      setStatus({ type: 'error', msg: errMsg, steps: [...localSteps] })
    txHistory.update(txId, { status: 'error', error: errMsg })
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
        {CHAINS.map(c => <option key={c.id} value={c.id}>{c.label}{c.isEvm ? '' : ' (Solana)'}</option>)}
      </select>
      <div style={{ textAlign: 'center' }}>
        <button onClick={() => { const f = fromChain; setFromChain(toChain); setToChain(f) }} className='glass' style={{ padding: '6px 14px', borderRadius: 10, cursor: 'pointer', color: '#818cf8', fontSize: 18, border: '1px solid #1e1e2e', background: 'rgba(18,18,26,0.8)' }}>⇅</button>
      </div>
      <div>
        <label style={{ color: '#64748b', fontSize: 13, display: 'block', marginBottom: 6 }}>Ke Chain</label>
        <select className='input' value={toChain} onChange={e => setToChain(e.target.value as ChainKey)}>
          {CHAINS.filter(c => c.id !== fromChain).map(c => <option key={c.id} value={c.id}>{c.label}{c.isEvm ? '' : ' (Solana)'}</option>)}
        </select>
      </div>
      {involvesSolana && (
        <div className='glass' style={{ padding: 12, borderRadius: 10, border: '1px solid rgba(168,85,247,0.3)', background: 'rgba(168,85,247,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ color: '#a78bfa', fontSize: 13, fontWeight: 600 }}>🪐 Wallet Solana</span>
            {solanaConnected ? (
              <button onClick={handleDisconnectSolana} style={{ background: 'transparent', border: '1px solid #4b5563', color: '#94a3b8', padding: '3px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>Disconnect</button>
            ) : (
              <button onClick={handleConnectSolana} style={{ background: '#fc7227', border: 'none', color: 'white', padding: '4px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>Connect Solflare</button>
            )}
          </div>
          {solanaConnected ? (
            <>
              <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#a78bfa', wordBreak: 'break-all', marginBottom: 4 }}>
                {solanaConnected.slice(0, 8)}...{solanaConnected.slice(-6)}
              </div>
              <div style={{ display: 'flex', gap: 12, fontSize: 11, marginTop: 4 }}>
                <span style={{ color: '#94a3b8' }}>SOL: <b style={{ color: '#f8fafc' }}>{solBalance.toFixed(4)}</b></span>
                <span style={{ color: '#94a3b8' }}>USDC: <b style={{ color: '#10b981' }}>{solUsdcBalance.toFixed(2)}</b></span>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 11, color: '#64748b' }}>
              Pasang <a href='https://solflare.com' target='_blank' rel='noreferrer' style={{ color: '#fc7227' }}>Solflare</a> untuk bridge ke/dari Solana.
            </div>
          )}
          {dstIsSolana && solanaConnected && (
            <div style={{ marginTop: 8, fontSize: 11, color: '#10b981' }}>
              ✓ Tujuan otomatis: alamat Solflare Anda
            </div>
          )}
        </div>
      )}
      {dstIsSolana && !solanaConnected && (
        <div>
          <label style={{ color: '#64748b', fontSize: 13, display: 'block', marginBottom: 6 }}>Alamat Solana penerima (pubkey base58)</label>
          <input className='input' type='text' placeholder='Contoh: 5xyA...' value={solanaRecipient} onChange={e => setSolanaRecipient(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 12 }} />
          <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 6 }}>⚠ Connect Solflare di atas agar tujuan & klaim mint otomatis ditangani oleh App Kit SDK.</div>
        </div>
      )}
      <div>
        <label style={{ color: '#64748b', fontSize: 13, display: 'block', marginBottom: 6 }}>Jumlah USDC</label>
        <input className='input' type='number' placeholder='0.00' value={amount} onChange={e => setAmount(e.target.value)} />
      </div>
      <div className='glass' style={{ padding: 10, borderRadius: 10, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Protocol</span><span>CCTP v2 Fast Transfer</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Estimasi fee maks</span><span>{fee} USDC</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Estimasi diterima</span><span style={{ color: '#10b981' }}>{est} USDC</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Settlement</span><span style={{ color: '#10b981' }}>~8-20 detik</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>MetaMask popup</span><span>{dstIsSolana ? '2x (approve + burn)' : '3x (approve + burn + mint)'}</span></div>
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
      <button onClick={handleBridge} disabled={!amount || loading || fromChain === toChain || (!srcIsSolana && !address) || (involvesSolana && !solanaConnected)} className='btn btn-primary'>
        {loading ? step || '⏳ Memproses...' : amount ? `Bridge ${amount} USDC${involvesSolana ? ' (App Kit)' : ''}` : 'Bridge USDC'}
      </button>
      <div style={{ fontSize: 11, color: '#64748b', textAlign: 'center' }}>
        {involvesSolana
          ? 'Bridge Solana ↔ Arc via Circle App Kit SDK (kit.bridge). Otomatis burn → attestation → mint.'
          : `Bridge via CCTP v2 Fast Transfer. Iris API: ${IRIS.replace('https://', '')}`}
      </div>
    </div>
  )
}
