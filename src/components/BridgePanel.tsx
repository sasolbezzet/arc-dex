/* eslint-disable */
import { useState, useEffect } from 'react'
import { safePost } from '../api'
import { txHistory } from '../txHistory'
import { CompactChainPicker, CompactTokenPicker } from './CompactPickers'
import { useI18n } from '../i18n'
import { wrapPhantom, wrapSolflare } from '../solflareWrapper'
import { decodeFunctionResult, encodeFunctionData, formatUnits, parseUnits } from 'viem'
// import { BridgeChain } from '@circle-fin/app-kit' // unused import disabled
declare global { interface Window { ethereum?: any; solana?: any; solflare?: any; phantom?: { solana?: any } } }

const API = ''

const EVM_CHAINS = [
  { id: 'Arc_Testnet', label: 'Arc Testnet', chainId: '0x4cef52', addParams: { chainId:'0x4cef52', chainName:'Arc Testnet', nativeCurrency:{name:'USDC',symbol:'USDC',decimals:18}, rpcUrls:['https://rpc.testnet.arc.network/'], blockExplorerUrls:['https://testnet.arcscan.app'] } },
  { id: 'Ethereum_Sepolia', label: 'Ethereum Sepolia', chainId: '0xaa36a7', addParams: null },
  { id: 'Base_Sepolia', label: 'Base Sepolia', chainId: '0x14a34', addParams: null },
  { id: 'Arbitrum_Sepolia', label: 'Arbitrum Sepolia', chainId: '0x66eee', addParams: null },
  { id: 'HyperEVM_Testnet', label: 'HyperEVM Testnet', chainId: '0x3e6', addParams: { chainId:'0x3e6', chainName:'HyperEVM Testnet', nativeCurrency:{name:'HYPE',symbol:'HYPE',decimals:18}, rpcUrls:['https://rpc.hyperliquid-testnet.xyz/evm'], blockExplorerUrls:['https://app.hyperliquid-testnet.xyz/explorer'] } },
]
const SOLANA_CHAIN = { id: 'Solana_Devnet', label: 'Solana Devnet (Solana)' }
const ALL_DST_CHAINS = [...EVM_CHAINS, SOLANA_CHAIN]
const NATIVE_TO_ARC: Record<string,{ token:string; symbol:string; label:string; note:string; unavailableReason?:string }> = {
  Ethereum_Sepolia: { token:'ETH_NATIVE', symbol:'ETH', label:'Ethereum native ETH', note:'ETH swaps to USDC, burns via CCTP, then mints on Arc.' },
  Base_Sepolia: { token:'ETH_NATIVE', symbol:'ETH', label:'Base native ETH', note:'ETH swaps to USDC, burns via CCTP, then mints on Arc.' },
  Arbitrum_Sepolia: { token:'ETH_NATIVE', symbol:'ETH', label:'Arbitrum native ETH', note:'ETH is the gas token on Arbitrum Sepolia.', unavailableReason:'Waiting for a verified router/liquid WETH-USDC route on Arbitrum Sepolia.' },
  HyperEVM_Testnet: { token:'HYPE_NATIVE', symbol:'HYPE', label:'HyperEVM native HYPE', note:'HYPE is the gas token on HyperEVM Testnet.', unavailableReason:'Native HYPE route is not enabled until a wrapped-HYPE router and CCTP-compatible USDC pool are verified.' },
  Solana_Devnet: { token:'SOL_NATIVE', symbol:'SOL', label:'Solana native SOL', note:'SOL is the gas token on Solana Devnet.', unavailableReason:'SOL-native swap-and-bridge needs a Solana route/program; current Solana bridge supports USDC only.' },
}

// CCTP source config — token addresses per chain
// cirBTC hanya ada di Arc Testnet + Ethereum Sepolia (Circle docs)
const CCTP_SRC: Record<string,{tokenMessenger:string;usdc:string;cirbtc?:string;domain:number}> = {
  Arc_Testnet: { tokenMessenger:'0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA', usdc:'0x3600000000000000000000000000000000000000', cirbtc:'0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF', domain:26 },
  Ethereum_Sepolia: { tokenMessenger:'0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa', usdc:'0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', cirbtc:'0x3a3fe695F684Bf9b9e43CF43C2b895Ea5e392bB3', domain:0 },
  Base_Sepolia: { tokenMessenger:'0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa', usdc:'0x036CbD53842c5426634e7929541eC2318f3dCF7e', domain:6 },
  Arbitrum_Sepolia: { tokenMessenger:'0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa', usdc:'0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', domain:3 },
  HyperEVM_Testnet: { tokenMessenger:'0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA', usdc:'0x2B3370eE501B4a559b57D449569354196457D8Ab', domain:19 },
}
const DST_DOMAIN: Record<string,number> = { Arc_Testnet:26, Ethereum_Sepolia:0, Base_Sepolia:6, Arbitrum_Sepolia:3, HyperEVM_Testnet:19, Solana_Devnet:5 }
const ARCOX_ROUTER: Record<string,string> = {
  Arc_Testnet: '0xDf800310443BEB589CEf91A09854203Ea36e43a7',
  Ethereum_Sepolia: '0x53aB114FeE64b177B8D6066056DfD03Ea38D0ef1',
  Base_Sepolia: '0x9425cC5b3C8B9e0FCb35beBdE737B4365A614Acc',
  Arbitrum_Sepolia: '0x5dCAA895dDc7350cF0f9eb69E69536a4548b0cA7',
}
const NATIVE_SWAP_BRIDGE_ROUTER: Record<string,string> = {
  Ethereum_Sepolia: '0x8fE3d887cD7D08D5A45bEaa57D061FFf9192EB59',
  Base_Sepolia: '0x3c5beFa0c208F0732D2c357f26EB897E727da498',
}
const ARCOX_ROUTER_ABI = [{
  type: 'function',
  name: 'bridgeUsdcWithFee',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'amount', type: 'uint256' },
    { name: 'destinationDomain', type: 'uint32' },
    { name: 'mintRecipient', type: 'bytes32' },
    { name: 'destinationCaller', type: 'bytes32' },
    { name: 'maxFee', type: 'uint256' },
    { name: 'minFinalityThreshold', type: 'uint32' },
  ],
  outputs: [{ name: 'fee', type: 'uint256' }, { name: 'netAmount', type: 'uint256' }],
}] as const
const NATIVE_SWAP_BRIDGE_ROUTER_ABI = [{
  type: 'function',
  name: 'swapNativeAndBridgeUsdc',
  stateMutability: 'payable',
  inputs: [
    { name: 'destinationDomain', type: 'uint32' },
    { name: 'mintRecipient', type: 'bytes32' },
    { name: 'destinationCaller', type: 'bytes32' },
    { name: 'poolFee', type: 'uint24' },
    { name: 'amountOutMinimum', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'maxFee', type: 'uint256' },
    { name: 'minFinalityThreshold', type: 'uint32' },
  ],
  outputs: [
    { name: 'usdcOut', type: 'uint256' },
    { name: 'platformFee', type: 'uint256' },
    { name: 'netUsdc', type: 'uint256' },
  ],
}] as const

// Solana CCTP burn config
const SOLANA_CCTP = {
  usdcMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  tokenMessengerProgram: 'CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe',
  messageTransmitterProgram: 'CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC',
  domain: 5,
}
const SOLANA_MINT_CLIENT_VERSION = 'cctp-v2-solana-mint-20260601-09'
const CCTP_FAST_FINALITY_THRESHOLD = 1000n
const INITIAL_FEE_MULTIPLIER = 3n
const MAX_FEE_MULTIPLIER = 4n
const PLATFORM_FEE_BPS = Number(import.meta.env.VITE_ARCOX_ROUTER_FEE_BPS || 30)
const EVM_FEE_TREASURY = import.meta.env.VITE_ARCOX_FEE_TREASURY || '0xE34FF1D2C925DDafB28C95C2396fC49A6f64569e'
const SOLANA_FEE_TREASURY = import.meta.env.VITE_SOLANA_FEE_TREASURY || '4kAf2Qxf9KnbnKo7ukPMMu8q1UButJYNik4yQtvWhExw'

function enc256(n: bigint) { return n.toString(16).padStart(64,'0') }
function encAddr(a: string) { return a.slice(2).toLowerCase().padStart(64,'0') }
const explorerFor = (chain: string, tx: string) => chain === 'Arc_Testnet' ? `https://testnet.arcscan.app/tx/${tx}` :
  chain === 'Base_Sepolia' ? `https://sepolia.basescan.org/tx/${tx}` :
  chain === 'Arbitrum_Sepolia' ? `https://sepolia.arbiscan.io/tx/${tx}` :
  chain === 'HyperEVM_Testnet' ? `https://app.hyperliquid-testnet.xyz/explorer/tx/${tx}` :
  `https://sepolia.etherscan.io/tx/${tx}`

type BridgeStep = { name:string; state:'pending'|'success'|'error'; txHash?:string; explorerUrl?:string }
type Status = { type:'success'|'error'|'info'|'warning'; msg:string; steps?:BridgeStep[] }

interface Props {
  address: string|null
  circleWallet: {id:string;address:string}|null
  balances: Record<string,string>
  eoaBalances: Record<string,string>
  onRefresh: ()=>void
}

export function BridgePanel({ address, circleWallet, balances, eoaBalances, onRefresh }: Props) {
  const { t } = useI18n()
  void circleWallet;


  const [fromChain, setFromChain] = useState('Arc_Testnet')

  const [toChain, setToChain] = useState('Ethereum_Sepolia')
  const [source, setSource] = useState<'circle'|'eoa'>('circle')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState('')
  const [status, setStatus] = useState<Status|null>(null)
  const [solanaWallet, setSolanaWallet] = useState<{address:string;provider:any}|null>(null)
  const [solanaUsdcBal, setSolanaUsdcBal] = useState('0')
  const BRIDGE_TOKENS = ['USDC','cirBTC']
  const [token, setToken] = useState('USDC')
  const TOKEN_DECIMALS: Record<string,number> = { USDC:6, cirBTC:8 }
  const nativeBridgeToken = toChain === 'Arc_Testnet' ? NATIVE_TO_ARC[fromChain] : null
  const isNativeBridgeToken = Boolean(nativeBridgeToken && token === nativeBridgeToken.token)
  const nativeBridgeExecutable = Boolean(isNativeBridgeToken && NATIVE_SWAP_BRIDGE_ROUTER[fromChain] && toChain === 'Arc_Testnet')
  const nativeRouteLive = Boolean(nativeBridgeToken && NATIVE_SWAP_BRIDGE_ROUTER[fromChain] && toChain === 'Arc_Testnet')
  const displayToken = isNativeBridgeToken ? nativeBridgeToken!.symbol : token
  const tokenDec = TOKEN_DECIMALS[token]||6

  const circleB = parseFloat(balances[token]||'0')
  const eoaB = parseFloat(eoaBalances[token]||'0')
  const totalB = circleB + eoaB
  const isToSolana = toChain === 'Solana_Devnet'
  const isFromSolana = fromChain === 'Solana_Devnet'
  const sourceBalance = isNativeBridgeToken ? 0 : source === 'circle' && fromChain === 'Arc_Testnet' ? circleB : isFromSolana ? parseFloat(solanaUsdcBal || '0') : eoaB
  const customFee = amount ? (parseFloat(amount)*0.0001).toFixed(6) : '-'
  const cctpFee = amount ? (parseFloat(amount)*0.0001).toFixed(6) : '-'
  const gatewayForwardingEnabled = false
  const forwardingFee = gatewayForwardingEnabled && (isFromSolana || isToSolana) ? (amount ? (parseFloat(amount)*0.0002).toFixed(6) : '-') : '-'
  const platformFee = amount
    ? (parseFloat(amount) * (PLATFORM_FEE_BPS / 10000)).toFixed(6)
    : '-'
  const routerFee = !isFromSolana && (ARCOX_ROUTER[fromChain] || token !== 'USDC') ? platformFee : isFromSolana && token === 'USDC' ? platformFee : '-'
  const platformFeeLabel = isNativeBridgeToken
    ? nativeBridgeExecutable ? 'Quote before bridge' : 'Tidak tersedia'
    : routerFee === '-' ? 'Router belum tersedia' : `${routerFee} ${token}`
  const totalDebit = amount ? (parseFloat(amount) + parseFloat(customFee === '-' ? '0' : customFee)).toFixed(tokenDec === 8 ? 8 : 6) : '-'
  const est = amount ? (parseFloat(amount)-parseFloat(cctpFee==='-'?'0':cctpFee)-parseFloat(forwardingFee==='-'?'0':forwardingFee)-parseFloat(routerFee==='-'?'0':routerFee)).toFixed(tokenDec === 8 ? 8 : 4) : '-'

  // ── Solana wallet connect ──
  const connectSolana = async (): Promise<{address:string;provider:any}|null> => {
    try {
      const rawProvider = window.solflare || window.phantom?.solana || window.solana
      const provider = window.solflare
        ? wrapSolflare(window.solflare)
        : (window.phantom?.solana || window.solana?.isPhantom)
          ? wrapPhantom(window.phantom?.solana || window.solana)
          : rawProvider
      if (!provider) { alert('Install Solflare atau Phantom wallet'); return null }
      await provider.connect()
      const addr = provider.publicKey?.toString()
      if (addr) {
        const wallet = { address: addr, provider }
        setSolanaWallet(wallet)
        fetchSolanaUsdcBalance(addr, provider)
        return wallet
      }
      return null
    } catch(e:any) { console.error('Solana connect:', e.message); return null }
  }

  const fetchSolanaUsdcBalance = async (addr: string, provider: any) => {
    void provider;
    try {
      const { Connection, PublicKey } = await import('@solana/web3.js')
      const { getAssociatedTokenAddress } = await import('@solana/spl-token')
      const conn = new Connection('https://api.devnet.solana.com', 'confirmed')
      const mint = new PublicKey(SOLANA_CCTP.usdcMint)
      const owner = new PublicKey(addr)
      const ata = await getAssociatedTokenAddress(mint, owner)
      try {
        const bal = await conn.getTokenAccountBalance(ata)
        setSolanaUsdcBal(bal.value.uiAmountString || '0')
      } catch { setSolanaUsdcBal('0') }
    } catch {}
  }

  // Reset token jika tidak tersedia untuk route yang dipilih
  useEffect(() => {
    if (token==='cirBTC' && (isFromSolana||isToSolana||!CCTP_SRC[fromChain]?.cirbtc||!CCTP_SRC[toChain]?.cirbtc)) {
      setToken('USDC')
    }
    if (token.endsWith('_NATIVE') && !(toChain === 'Arc_Testnet' && NATIVE_TO_ARC[fromChain]?.token === token)) {
      setToken('USDC')
    }
  }, [fromChain, toChain, isFromSolana, isToSolana, token])

  useEffect(() => {
    if (fromChain !== 'Arc_Testnet' && source === 'circle') setSource('eoa')
  }, [fromChain, source])

  useEffect(() => {
    if (isFromSolana && !solanaWallet) connectSolana()
    if (isToSolana && !solanaWallet) connectSolana()
  }, [fromChain, toChain])

  const buildReceiveMessageCalldata = (message: string, attestation: string) => {
    const msgHex = message.startsWith('0x') ? message.slice(2) : message
    const attHex = attestation.startsWith('0x') ? attestation.slice(2) : attestation
    const pad32 = (hex: string) => hex.length % 64 === 0 ? hex : hex.padEnd(Math.ceil(hex.length / 64) * 64, '0')
    const msgLenHex = (msgHex.length / 2).toString(16).padStart(64, '0')
    const attLenHex = (attHex.length / 2).toString(16).padStart(64, '0')
    const msgPadded = pad32(msgHex)
    const attPadded = pad32(attHex)
    const attOffsetBytes = 64 + 32 + msgPadded.length / 2
    return '0x57ecfd28' +
      '0000000000000000000000000000000000000000000000000000000000000040' +
      attOffsetBytes.toString(16).padStart(64, '0') +
      msgLenHex + msgPadded +
      attLenHex + attPadded
  }

  const completeEvmMintAfterBurn = async (params: {
    burnTx: string
    historyId: string
    localSteps: BridgeStep[]
    sourceChain: string
    destinationChain: string
    amountLabel: string
    tokenLabel: string
  }) => {
    const { burnTx, historyId, localSteps, sourceChain, destinationChain, amountLabel, tokenLabel } = params
    localSteps.push({ name:'attestation', state:'pending' })
    const attEst = sourceChain === 'Arc_Testnet' ? '~30 detik' : '~30 detik - 3 menit'
    setStatus({ type:'info', msg:`✓ Burn sukses!\n⏳ Polling attestasi (${attEst})...`, steps:[...localSteps] })
    setStep('Menunggu attestasi...')

    const maxPolls = 120
    const pollDelay = sourceChain === 'Arc_Testnet' ? 1000 : 3000
    let attData: any = null
    for (let i = 0; i < maxPolls; i++) {
      attData = await safePost(API, '/api/get-attestation', {txHash: burnTx, fromChain: sourceChain, toChain: destinationChain, once: true})
      if (attData.success) break
      const statusText = attData.status ? ` (${attData.status})` : ''
      setStatus({ type:'info', msg:`✓ Burn sukses!\n⏳ Polling attestasi ${i+1}/${maxPolls}${statusText}...`, steps:[...localSteps] })
      await new Promise(r => setTimeout(r, pollDelay))
    }
    if (!attData?.success) {
      localSteps[localSteps.length-1].state = 'error'
      txHistory.update(historyId, { status:'error', error:attData?.error || 'Attestation timeout' })
      throw new Error(attData?.error || 'Attestation timeout')
    }
    localSteps[localSteps.length-1].state='success'

    const toInfo = EVM_CHAINS.find(c=>c.id===destinationChain)
    if (toInfo) {
      try {
        await window.ethereum!.request({ method:'wallet_switchEthereumChain', params:[{chainId:toInfo.chainId}] })
        await new Promise(r=>setTimeout(r,1500))
      } catch(e:any) {
        if ((e.code===4902||e.code===-32603) && toInfo.addParams) {
          await window.ethereum!.request({ method:'wallet_addEthereumChain', params:[toInfo.addParams] })
          await new Promise(r=>setTimeout(r,3000))
        }
      }
    }

    const callData = buildReceiveMessageCalldata(attData.message, attData.attestation)
    localSteps.push({ name:'mint', state:'pending' })
    setStep(`MetaMask: Mint USDC di ${destinationChain}...`)
    setStatus({ type:'info', msg:`✓ Attestasi siap!\n⏳ MetaMask popup: Mint USDC di ${destinationChain}...`, steps:[...localSteps] })
    const mintTx = await sendEvmTxBuffered({ from:address, to:attData.messageTransmitter, data:callData })
    localSteps[localSteps.length-1].txHash = mintTx
    setStatus({ type:'info', msg:'⏳ Menunggu mint...', steps:[...localSteps] })
    await waitEvmTx(mintTx)
    localSteps[localSteps.length-1].state='success'
    const explorerUrl = explorerFor(destinationChain, mintTx)
    localSteps[localSteps.length-1].explorerUrl = explorerUrl
    txHistory.update(historyId, { status:'success', mintTx, mintExplorerUrl:explorerUrl, note:'Bridge completed on Arc Testnet.' })
    setStatus({ type:'success', msg:`✓ Bridge berhasil! ${amountLabel} ${tokenLabel} → ${destinationChain}`, steps:[...localSteps] })
  }

  const quoteNativeBridge = async (nativeAmount: bigint) => {
    if (!address || !window.ethereum) throw new Error('Wallet belum terhubung.')
    const routerAddr = NATIVE_SWAP_BRIDGE_ROUTER[fromChain]
    if (!routerAddr) throw new Error(`Native bridge router belum tersedia untuk ${fromChain}.`)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 900)
    const mintRecipient = `0x${encAddr(address)}`
    const quotes: Array<{poolFee:number;usdcOut:bigint;platformFee:bigint;netUsdc:bigint;deadline:bigint}> = []
    for (const poolFee of [500, 3000, 10000]) {
      try {
        const data = encodeFunctionData({
          abi: NATIVE_SWAP_BRIDGE_ROUTER_ABI,
          functionName: 'swapNativeAndBridgeUsdc',
          args: [26, mintRecipient as `0x${string}`, `0x${'0'.repeat(64)}`, poolFee, 1n, deadline, 10n, Number(CCTP_FAST_FINALITY_THRESHOLD)],
        })
        const result = await window.ethereum.request({
          method:'eth_call',
          params:[{ from:address, to:routerAddr, data, value:toHex(nativeAmount) }, 'latest'],
        })
        const decoded = decodeFunctionResult({ abi:NATIVE_SWAP_BRIDGE_ROUTER_ABI, functionName:'swapNativeAndBridgeUsdc', data:result })
        quotes.push({ poolFee, usdcOut:decoded[0] as bigint, platformFee:decoded[1] as bigint, netUsdc:decoded[2] as bigint, deadline })
      } catch {}
    }
    quotes.sort((a,b) => a.netUsdc === b.netUsdc ? 0 : a.netUsdc > b.netUsdc ? -1 : 1)
    const best = quotes[0]
    if (!best || best.netUsdc <= 0n) throw new Error('Tidak ada quote native route yang berhasil. Pool mungkin tidak punya liquidity.')
    return best
  }

  const bridgeNativeEvmToArc = async () => {
    if (!address || !amount || !window.ethereum) return
    if (!nativeBridgeExecutable) throw new Error(`Native bridge belum tersedia untuk ${fromChain}.`)
    const nativeAmount = parseUnits(amount, 18)
    const localSteps: BridgeStep[] = []
    const fromInfo = EVM_CHAINS.find(c=>c.id===fromChain)
    if (fromInfo) {
      setStep('Switch network...')
      try {
        await window.ethereum.request({ method:'wallet_switchEthereumChain', params:[{chainId:fromInfo.chainId}] })
        await new Promise(r=>setTimeout(r,1500))
      } catch(e:any) {
        if ((e.code===4902||e.code===-32603) && fromInfo.addParams) {
          await window.ethereum.request({ method:'wallet_addEthereumChain', params:[fromInfo.addParams] })
          await new Promise(r=>setTimeout(r,3000))
        }
      }
    }
    const gasBal = await evmNativeBalance(address)
    if (gasBal <= nativeAmount) throw new Error(`Saldo ${displayToken} tidak cukup untuk amount + gas.`)

    setStep('Mengambil quote native route...')
    const quote = await quoteNativeBridge(nativeAmount)
    const minOut = (quote.usdcOut * 9950n) / 10000n
    const estimatedReceive = formatUnits(quote.netUsdc, 6)
    const platformFeeUsdc = formatUnits(quote.platformFee, 6)
    const ok = window.confirm(
      `Preview native bridge\n\n` +
      `Route: ${fromChain} ${displayToken} -> swap USDC -> Arc Testnet\n` +
      `Input: ${amount} ${displayToken}\n` +
      `Estimated USDC to Arc: ${estimatedReceive} USDC\n` +
      `Platform fee: ${platformFeeUsdc} USDC\n` +
      `Pool fee tier: ${quote.poolFee}\n` +
      `Slippage guard: 0.5%\n\n` +
      `Lanjutkan bridge?`
    )
    if (!ok) throw new Error('Bridge dibatalkan user setelah preview.')

    const routerAddr = NATIVE_SWAP_BRIDGE_ROUTER[fromChain]
    const data = encodeFunctionData({
      abi: NATIVE_SWAP_BRIDGE_ROUTER_ABI,
      functionName: 'swapNativeAndBridgeUsdc',
      args: [26, `0x${encAddr(address)}` as `0x${string}`, `0x${'0'.repeat(64)}`, quote.poolFee, minOut, quote.deadline, 10n, Number(CCTP_FAST_FINALITY_THRESHOLD)],
    })
    setStep('MetaMask: Confirm native bridge...')
    setStatus({ type:'info', msg:`⏳ MetaMask popup: bridge ${amount} ${displayToken} ke Arc via native router...`, steps:[...localSteps] })
    const burnTx = await sendEvmTxBuffered({ from:address, to:routerAddr, data, value:toHex(nativeAmount) })
    localSteps.push({ name:'burn', state:'pending', txHash:burnTx })
    setStatus({ type:'info', msg:'⏳ Menunggu swap + burn...', steps:[...localSteps] })
    await waitEvmTx(burnTx)
    localSteps[localSteps.length-1].state='success'
    localSteps[localSteps.length-1].explorerUrl=explorerFor(fromChain, burnTx)
    const historyId = `bridge-${Date.now()}-${burnTx.slice(-6)}`
    txHistory.add({
      id: historyId,
      ts: Date.now(),
      action: 'bridge',
      source: 'web-ui',
      walletSource: 'eoa',
      from: fromChain,
      to: 'Arc_Testnet',
      amount,
      token: displayToken,
      status: 'pending',
      burnTx,
      burnExplorerUrl: explorerFor(fromChain, burnTx),
      srcDomain: CCTP_SRC[fromChain]?.domain,
      dstDomain: DST_DOMAIN.Arc_Testnet,
      note: `Native ${displayToken} swapped to USDC through ARCOX native router. Estimated receive ${estimatedReceive} USDC. Mint pending.`,
    })
    await completeEvmMintAfterBurn({ burnTx, historyId, localSteps, sourceChain: fromChain, destinationChain: 'Arc_Testnet', amountLabel: estimatedReceive, tokenLabel: 'USDC' })
    setAmount('')
    setTimeout(onRefresh,3000); setTimeout(onRefresh,10000)
  }

  // ── EVM Bridge (Arc/EVM ↔ EVM) ──
  const bridgeEvm = async (_solWallet?: {address:string;provider:any}|null) => {
    const sw = _solWallet?.provider ? _solWallet : solanaWallet
    if (!address || !amount || !window.ethereum) return
    const amtNum = parseFloat(amount)
    const amtMicro = parseUnits(amount, tokenDec)
    const localSteps: BridgeStep[] = []
    let historyId: string|null = null
    const srcInfo = CCTP_SRC[fromChain]
    const burnToken = token === 'cirBTC' && srcInfo?.cirbtc ? srcInfo.cirbtc : srcInfo?.usdc || ''
    const routerAddr = token === 'USDC' && !isFromSolana ? ARCOX_ROUTER[fromChain] : ''
    if (token === 'USDC' && !isFromSolana && !routerAddr) {
      throw new Error(`ArcoxRouter belum tersedia untuk source ${fromChain}; bridge USDC direct ditolak agar platform fee tidak terlewati.`)
    }

    if (source === 'circle' && fromChain !== 'Arc_Testnet') {
      throw new Error('Circle Wallet hanya tersedia untuk source Arc Testnet.')
    }
    if (source === 'eoa' && fromChain === 'Arc_Testnet' && eoaB < amtNum) {
      throw new Error(`Saldo ${token} EOA tidak cukup. Pilih Circle Wallet atau isi saldo MetaMask.`)
    }
    if (source === 'circle' && circleB < amtNum) {
      throw new Error(`Saldo ${token} Circle Wallet tidak cukup.`)
    }

    // Step 0: Circle → EOA dalam satu flow jika sumber Circle dipilih.
    if (source === 'circle' && fromChain === 'Arc_Testnet') {
      setStep('Transfer dari Circle Wallet ke MetaMask...')
      setStatus({ type:'info', msg:`⏳ Mentransfer ${token} dari Circle Wallet ke MetaMask...` })
      const d = await safePost(API, '/api/prepare-bridge', {metamaskAddress:address,amount,token})
      if (d.error) throw new Error(d.error)
      localSteps.push({ name:'circle-transfer', state:'success', txHash:d.txHash, explorerUrl:d.explorerUrl })
      setStatus({ type:'info', msg:`✓ ${token} di MetaMask!\n⏳ Siapkan approve...`, steps:[...localSteps] })
      await new Promise(r=>setTimeout(r,5000))
    }

    // Switch network
    const fromInfo = EVM_CHAINS.find(c=>c.id===fromChain)
    if (fromInfo) {
      setStep('Switch network...')
      try {
        await window.ethereum.request({ method:'wallet_switchEthereumChain', params:[{chainId:fromInfo.chainId}] })
        await new Promise(r=>setTimeout(r,2000))
      } catch(e:any) {
        if ((e.code===4902||e.code===-32603) && fromInfo.addParams) {
          await window.ethereum.request({ method:'wallet_addEthereumChain', params:[fromInfo.addParams] })
          await new Promise(r=>setTimeout(r,3000))
        }
      }
    }

    if (!srcInfo) throw new Error('Source chain tidak didukung')
    const dstDomain = DST_DOMAIN[toChain]
    if (fromChain !== 'Arc_Testnet') {
      const gasBal = await evmNativeBalance(address)
      if (gasBal === 0n) {
        throw new Error(`Saldo gas ${fromInfo?.label || fromChain} kosong. Isi ETH testnet di ${fromInfo?.label || fromChain} untuk membayar gas.`)
      }
    }
    const feeMicro = (amtMicro * BigInt(Math.max(0, Math.floor(PLATFORM_FEE_BPS)))) / 10000n
    const burnMicro = routerAddr ? amtMicro : amtMicro - feeMicro
    if (burnMicro <= 0n) throw new Error('Amount terlalu kecil setelah platform fee.')
    const srcBal = await evmTokenBalance(burnToken, address)
    if (srcBal < amtMicro) {
      const have = Number(srcBal) / 10 ** tokenDec
      throw new Error(`Saldo ${token} di ${fromInfo?.label || fromChain} tidak cukup. Terdeteksi ${have.toFixed(6)} ${token}, butuh ${amount}.`)
    }
    if (!routerAddr && feeMicro > 0n) {
      setStep(`MetaMask: Platform fee ${token}...`)
      setStatus({ type:'info', msg:`⏳ MetaMask popup: transfer platform fee ${token}...`, steps:[...localSteps] })
      const feeTx = await sendEvmTxBuffered({ from:address, to:burnToken, data:'0xa9059cbb'+encAddr(EVM_FEE_TREASURY)+enc256(feeMicro) })
      localSteps.push({ name:'platform-fee', state:'pending', txHash:feeTx })
      await waitEvmTx(feeTx)
      localSteps[localSteps.length-1].state='success'
      localSteps[localSteps.length-1].explorerUrl=explorerFor(fromChain, feeTx)
    }

    // Approve
    setStep(`MetaMask: Approve ${token} (1/2)...`)
    setStatus({ type:'info', msg:`⏳ MetaMask popup 1/2: Approve ${token}${routerAddr ? ' ke ArcoxRouter' : ''}...`, steps:[...localSteps] })
    const approveSpender = routerAddr || srcInfo.tokenMessenger
    const approveTx = await sendEvmTxBuffered({ from:address, to:burnToken, data:'0x095ea7b3'+encAddr(approveSpender)+enc256(routerAddr ? amtMicro : burnMicro) })
    localSteps.push({ name:'approve', state:'pending', txHash:approveTx })
    setStatus({ type:'info', msg:'⏳ Menunggu approve...', steps:[...localSteps] })
    await waitEvmTx(approveTx)
    localSteps[localSteps.length-1].state='success'
    localSteps[localSteps.length-1].explorerUrl=explorerFor(fromChain, approveTx)

    // Burn
    setStep(`MetaMask: Confirm burn ${token} (2/2)...`)
    setStatus({ type:'info', msg:`✓ Approve!\n⏳ MetaMask popup 2/2: Burn ${token}...`, steps:[...localSteps] })

    let burnData: string
    const maxFeeMicro = 10n
    let routerMintRecipient = `0x${encAddr(address)}`
    if (isToSolana && sw) {
      const { PublicKey } = await import('@solana/web3.js')
      const { getAssociatedTokenAddress } = await import('@solana/spl-token')
      const solPubkey = new PublicKey(sw.address)
      const solUsdcAta = await getAssociatedTokenAddress(new PublicKey(SOLANA_CCTP.usdcMint), solPubkey)
      const solBytes = solUsdcAta.toBytes()
      routerMintRecipient = `0x${Array.from(solBytes).map(b=>b.toString(16).padStart(2,'0')).join('').padStart(64,'0')}`
    }
    if (routerAddr) {
      burnData = encodeFunctionData({
        abi: ARCOX_ROUTER_ABI,
        functionName: 'bridgeUsdcWithFee',
        args: [amtMicro, Number(dstDomain), routerMintRecipient as `0x${string}`, `0x${'0'.repeat(64)}`, maxFeeMicro, Number(CCTP_FAST_FINALITY_THRESHOLD)],
      })
    } else if (isToSolana && sw) {
      // CCTP v2 Solana requires the destination USDC token account, not the wallet address.
      const { PublicKey } = await import('@solana/web3.js')
      const { getAssociatedTokenAddress } = await import('@solana/spl-token')
      const solPubkey = new PublicKey(sw!.address)
      const solUsdcAta = await getAssociatedTokenAddress(new PublicKey(SOLANA_CCTP.usdcMint), solPubkey)
      const solBytes = solUsdcAta.toBytes()
      const mintRecipient = Array.from(solBytes).map(b=>b.toString(16).padStart(2,'0')).join('').padStart(64,'0')
      burnData = '0x8e0250ee'+enc256(burnMicro)+enc256(BigInt(dstDomain))+mintRecipient+encAddr(burnToken)+enc256(0n)+enc256(maxFeeMicro)+enc256(CCTP_FAST_FINALITY_THRESHOLD)
    } else {
      burnData = '0x8e0250ee'+enc256(burnMicro)+enc256(BigInt(dstDomain))+encAddr(address)+encAddr(burnToken)+enc256(0n)+enc256(maxFeeMicro)+enc256(CCTP_FAST_FINALITY_THRESHOLD)
    }

    const burnTx = await sendEvmTxBuffered({ from:address, to:routerAddr || srcInfo.tokenMessenger, data:burnData })
    localSteps.push({ name:'burn', state:'pending', txHash:burnTx })
    setStatus({ type:'info', msg:'⏳ Menunggu burn...', steps:[...localSteps] })
    await waitEvmTx(burnTx)
    localSteps[localSteps.length-1].state='success'
    localSteps[localSteps.length-1].explorerUrl=explorerFor(fromChain, burnTx)
    historyId = `bridge-${Date.now()}-${burnTx.slice(-6)}`
    txHistory.add({
      id: historyId,
      ts: Date.now(),
      action: 'bridge',
      source: 'web-ui',
      walletSource: source,
      from: fromChain,
      to: toChain,
      amount,
      token,
      status: 'pending',
      burnTx,
      burnExplorerUrl: explorerFor(fromChain, burnTx),
      srcDomain: srcInfo.domain,
      dstDomain: dstDomain,
      note: routerAddr ? 'Burn via ArcoxRouter complete. Platform fee collected. Mint/receive step pending.' : 'Burn complete. Mint/receive step pending.',
    })

    // Attestation + Mint
    localSteps.push({ name:'attestation', state:'pending' })
    const attEst = fromChain === 'Arc_Testnet' ? '~30 detik' : '~30 detik - 3 menit'
    setStatus({ type:'info', msg:`✓ Burn sukses!\n⏳ Menunggu attestasi (${attEst})...`, steps:[...localSteps] })
    setStep('Menunggu attestasi...')

    if (isToSolana) {
      // Mint di Solana → frontend Solflare yang sign
      const mintData = await safePost(API, '/api/mint-cctp-solana', {burnTxHash:burnTx,toAddress:sw!.address,fromChain,toChain:'Solana_Devnet',amount})
      if (mintData.error) throw new Error(mintData.error)

      if (mintData.requiresSolanaSign) {
        localSteps[localSteps.length-1].state='success'
        // Sign receiveMessage via Solflare
        setStep('Solflare: Sign receiveMessage di Solana...')
        setStatus({ type:'info', msg:'⏳ Solflare akan popup untuk sign mint di Solana...', steps:[...localSteps] })
        try {
          const solTxHash = await signSolanaReceiveMessage(mintData.attestation, mintData.message, sw!.address, sw!.provider)
          localSteps.push({ name:'mint', state:'success', txHash:solTxHash, explorerUrl:`https://explorer.solana.com/tx/${solTxHash}?cluster=devnet` })
          if (historyId) txHistory.update(historyId, { status:'success', mintTx:solTxHash, mintExplorerUrl:`https://explorer.solana.com/tx/${solTxHash}?cluster=devnet`, note:'Bridge completed on Solana destination.' })
          setStatus({ type:'success', msg:`✓ Bridge berhasil! ${amount} ${token} → Solana Devnet`, steps:[...localSteps] })
          fetchSolanaUsdcBalance(sw!.address, sw!.provider)
          setTimeout(() => fetchSolanaUsdcBalance(sw!.address, sw!.provider), 3000)
        } catch(e:any) {
          localSteps.push({ name:'mint', state:'error' })
          if (historyId) txHistory.update(historyId, { status:'error', error:e.message || 'Mint Solana gagal' })
          setStatus({
            type:'warning',
            msg:`✗ Mint GAGAL di Solana Devnet\nstate=error | mint=error\nAlasan: ${e.message?.slice(0,150)}\nBurn tx (${token} sudah di-burn):\n${burnTx.slice(0,40)}...\n\n${token} Anda di-burn tapi belum di-mint. Hubungi support atau retry mint manual.`,
            steps:[...localSteps]
          })
          throw new Error(e.message || 'Mint Solana gagal')
        }
      } else {
        // Backend sudah handle mint (requiresSolanaSign=false)
        localSteps.push({ name:'mint', state:'success', txHash:mintData.txHash || burnTx, explorerUrl:`https://explorer.solana.com/tx/${mintData.txHash||burnTx}?cluster=devnet` })
        if (historyId) txHistory.update(historyId, { status:'success', mintTx:mintData.txHash || burnTx, mintExplorerUrl:`https://explorer.solana.com/tx/${mintData.txHash||burnTx}?cluster=devnet`, note:'Bridge completed on Solana destination.' })
        setStatus({ type:'success', msg:`✓ Bridge berhasil! ${amount} ${token} → Solana Devnet`, steps:[...localSteps] })
      }
    } else {
      // EVM→EVM Mint via MetaMask: backend hanya polling attestation, frontend sign tx
      localSteps[localSteps.length-1].state='success'
      const attEst2 = '~30 detik - 3 menit'
      setStep('Menunggu attestasi...')
      setStatus({ type:'info', msg:`✓ Burn sukses!\n⏳ Polling attestasi (${attEst2})...`, steps:[...localSteps] })

      // Step 3: Poll attestation dengan request pendek agar chain slow-finality tidak timeout di proxy.
      const maxPolls = 120
      const pollDelay = fromChain === 'Arc_Testnet' ? 1000 : 3000
      let attData: any = null
      for (let i = 0; i < maxPolls; i++) {
        attData = await safePost(API, '/api/get-attestation', {txHash: burnTx, fromChain, toChain, once: true})
        if (attData.success) break
        const statusText = attData.status ? ` (${attData.status})` : ''
        setStatus({ type:'info', msg:`✓ Burn sukses!\n⏳ Polling attestasi ${i+1}/${maxPolls}${statusText}...`, steps:[...localSteps] })
        await new Promise(r => setTimeout(r, pollDelay))
      }
      if (!attData.success) {
        localSteps.push({ name:'mint', state:'error' })
        if (historyId) txHistory.update(historyId, { status:'error', error:attData.error || 'Attestation timeout' })
        throw new Error(attData.error || 'Attestation timeout')
      }

      // Step 4: Switch MetaMask ke destination chain + send receiveMessage via user wallet
      setStep(`MetaMask: Mint ${token} di ${toChain}...`)
      setStatus({ type:'info', msg:`✓ Attestasi siap!\n⏳ MetaMask popup 3/3: Mint ${token} di ${toChain}...`, steps:[...localSteps] })

      // Switch ke destination chain
      const toInfo = EVM_CHAINS.find(c=>c.id===toChain)
      if (toInfo) {
        try {
          await window.ethereum.request({ method:'wallet_switchEthereumChain', params:[{chainId:toInfo.chainId}] })
          await new Promise(r=>setTimeout(r,1500))
        } catch(e:any) {
          if ((e.code===4902||e.code===-32603) && toInfo.addParams) {
            await window.ethereum.request({ method:'wallet_addEthereumChain', params:[toInfo.addParams] })
            await new Promise(r=>setTimeout(r,3000))
          }
        }
      }

      // Manual ABI-encode receiveMessage(bytes,bytes)
      const recvMsg = attData.message
      const recvAtt = attData.attestation
      const msgHex = recvMsg.startsWith('0x') ? recvMsg.slice(2) : recvMsg
      const attHex = recvAtt.startsWith('0x') ? recvAtt.slice(2) : recvAtt

      // ABI encoding: selector(4) + msgOffset(32) + attOffset(32) + msgLen(32) + msgData(padded) + attLen(32) + attData(padded)
      const pad32 = (hex: string) => hex.length % 64 === 0 ? hex : hex.padEnd(Math.ceil(hex.length / 64) * 64, '0')
      const msgLenHex = (msgHex.length / 2).toString(16).padStart(64, '0')
      const attLenHex = (attHex.length / 2).toString(16).padStart(64, '0')
      const msgPadded = pad32(msgHex)
      const attPadded = pad32(attHex)
      const attOffsetBytes = 64 + 32 + msgPadded.length / 2
      const callData = '0x57ecfd28' + // receiveMessage(bytes,bytes) selector
        '0000000000000000000000000000000000000000000000000000000000000040' +
        attOffsetBytes.toString(16).padStart(64, '0') +
        msgLenHex + msgPadded +
        attLenHex + attPadded

      const msgTxAddr = attData.messageTransmitter

      // Push mint step BEFORE attempting transaction (biar tx hash tetap muncul walau fallback)
      localSteps.push({ name:'mint', state:'pending' })
      let mintTx: string
      try {
        mintTx = await sendEvmTxBuffered({ from:address, to:msgTxAddr, data:callData })
        localSteps[localSteps.length-1].txHash = mintTx
        setStatus({ type:'info', msg:'⏳ Menunggu mint...', steps:[...localSteps] })
        await waitEvmTx(mintTx)
      } catch(e:any) {
        localSteps[localSteps.length-1].state='error'
        if (historyId) txHistory.update(historyId, { status:'error', error:e.message || 'Mint via MetaMask gagal' })
        setStatus({ type:'error', msg:`✗ Mint GAGAL di ${toChain}\nAlasan: ${e.message?.slice(0,200)}\n\nBurn sudah sukses (tx: ${burnTx.slice(0,12)}...).\nHubungi support atau retry bridge manual.`, steps:[...localSteps] })
        throw new Error(e.message || 'Mint via MetaMask gagal')
      }

      localSteps[localSteps.length-1].state='success'
      const explorerUrl = explorerFor(toChain, mintTx)
      localSteps[localSteps.length-1].explorerUrl = explorerUrl
      if (historyId) txHistory.update(historyId, { status:'success', mintTx, mintExplorerUrl:explorerUrl, note:'Bridge completed on EVM destination.' })
      setStatus({ type:'success', msg:`✓ Bridge berhasil! ${amount} ${token} → ${toChain}`, steps:[...localSteps] })
    }

    setAmount('')
    setTimeout(onRefresh,3000); setTimeout(onRefresh,10000)
  }

  // ── Solana → Arc Bridge ──
  const bridgeFromSolana = async (_solWallet?: {address:string;provider:any}|null) => {
    const sw = _solWallet?.provider ? _solWallet : solanaWallet
    if (!sw || !amount || !address) return
    const localSteps: BridgeStep[] = []

    setStep('Mempersiapkan burn di Solana...')
    setStatus({ type:'info', msg:'⏳ Solflare akan popup untuk burn USDC (hanya USDC) di Solana...' })

    try {
      // Burn USDC di Solana via Solflare
      const burnTxHash = await burnSolanaUsdc(amount, address, sw.provider, sw.address)
      const historyId = `bridge-${Date.now()}-${burnTxHash.slice(-6)}`
      localSteps.push({ name:'burn', state:'success', txHash:burnTxHash, explorerUrl:`https://explorer.solana.com/tx/${burnTxHash}?cluster=devnet` })
      txHistory.add({
        id: historyId,
        ts: Date.now(),
        action: 'bridge',
        source: 'web-ui',
        walletSource: 'solana',
        from: 'Solana_Devnet',
        to: 'Arc_Testnet',
        amount,
        token,
        status: 'pending',
        burnTx: burnTxHash,
        burnExplorerUrl: `https://explorer.solana.com/tx/${burnTxHash}?cluster=devnet`,
        srcDomain: SOLANA_CCTP.domain,
        dstDomain: DST_DOMAIN.Arc_Testnet,
        note: 'Solana burn complete. Arc mint pending.',
      })
      setStatus({ type:'info', msg:`✓ Burn sukses di Solana!\n⏳ Menunggu attestation (~20 detik)...`, steps:[...localSteps] })

      // Mint di Arc harus ditandatangani wallet user. Server-signed mint sengaja disabled.
      localSteps.push({ name:'attestation', state:'pending' })
      setStatus({ type:'info', msg:'⏳ Polling attestation dari Solana...', steps:[...localSteps] })
      const maxPolls = 120
      let attData: any = null
      for (let i = 0; i < maxPolls; i++) {
        attData = await safePost(API, '/api/get-attestation', {
          txHash: burnTxHash,
          fromChain: 'Solana_Devnet',
          toChain: 'Arc_Testnet',
          once: true,
        })
        if (attData.success) break
        const statusText = attData.status ? ` (${attData.status})` : ''
        setStatus({ type:'info', msg:`✓ Burn sukses di Solana!\n⏳ Polling attestasi ${i+1}/${maxPolls}${statusText}...`, steps:[...localSteps] })
        await new Promise(r => setTimeout(r, 3000))
      }
      if (!attData?.success) {
        localSteps[localSteps.length-1].state = 'error'
        txHistory.update(historyId, { status:'error', error:attData?.error || 'Attestation timeout dari Solana' })
        throw new Error(attData?.error || 'Attestation timeout dari Solana')
      }
      localSteps[localSteps.length-1].state='success'

      const arcInfo = EVM_CHAINS.find(c=>c.id==='Arc_Testnet')
      if (arcInfo && window.ethereum) {
        try {
          await window.ethereum.request({ method:'wallet_switchEthereumChain', params:[{chainId:arcInfo.chainId}] })
          await new Promise(r=>setTimeout(r,1500))
        } catch(e:any) {
          if ((e.code===4902||e.code===-32603) && arcInfo.addParams) {
            await window.ethereum.request({ method:'wallet_addEthereumChain', params:[arcInfo.addParams] })
            await new Promise(r=>setTimeout(r,3000))
          }
        }
      }

      const recvMsg = attData.message
      const recvAtt = attData.attestation
      if (!recvMsg || !recvAtt || !attData.messageTransmitter) {
        throw new Error('Data mint Arc tidak lengkap dari API attestation.')
      }
      const msgHex = recvMsg.startsWith('0x') ? recvMsg.slice(2) : recvMsg
      const attHex = recvAtt.startsWith('0x') ? recvAtt.slice(2) : recvAtt
      const pad32 = (hex: string) => hex.length % 64 === 0 ? hex : hex.padEnd(Math.ceil(hex.length / 64) * 64, '0')
      const msgLenHex = (msgHex.length / 2).toString(16).padStart(64, '0')
      const attLenHex = (attHex.length / 2).toString(16).padStart(64, '0')
      const msgPadded = pad32(msgHex)
      const attPadded = pad32(attHex)
      const attOffsetBytes = 64 + 32 + msgPadded.length / 2
      const callData = '0x57ecfd28' +
        '0000000000000000000000000000000000000000000000000000000000000040' +
        attOffsetBytes.toString(16).padStart(64, '0') +
        msgLenHex + msgPadded +
        attLenHex + attPadded

      localSteps.push({ name:'mint', state:'pending' })
      setStep('MetaMask: Mint USDC di Arc Testnet...')
      setStatus({ type:'info', msg:'✓ Attestasi siap!\n⏳ MetaMask popup: Mint USDC di Arc Testnet...', steps:[...localSteps] })
      const mintTx = await sendEvmTxBuffered({ from:address, to:attData.messageTransmitter, data:callData })
      localSteps[localSteps.length-1].txHash = mintTx
      setStatus({ type:'info', msg:'⏳ Menunggu mint di Arc Testnet...', steps:[...localSteps] })
      await waitEvmTx(mintTx)
      localSteps[localSteps.length-1].state='success'
      const mintExplorerUrl = explorerFor('Arc_Testnet', mintTx)
      localSteps[localSteps.length-1].explorerUrl = mintExplorerUrl
      txHistory.update(historyId, { status:'success', mintTx, mintExplorerUrl, note:'Bridge completed on Arc Testnet via MetaMask.' })
      setStatus({ type:'success', msg:`✓ Bridge berhasil! ${amount} ${token} Solana → Arc Testnet`, steps:[...localSteps] })
      setAmount('')
      fetchSolanaUsdcBalance(sw.address, sw.provider)
      setTimeout(onRefresh,3000)
      setTimeout(() => fetchSolanaUsdcBalance(sw.address, sw.provider), 3000)
    } catch(e:any) {
      const lastBurn = localSteps.find(s => s.name === 'burn')?.txHash
      if (lastBurn) {
        const rec = txHistory.list().find(r => r.burnTx === lastBurn)
        if (rec) txHistory.update(rec.id, { status:'error', error:e?.message || 'Bridge Solana gagal' })
      }
      setStatus({ type:'error', msg:e?.message||'Bridge Solana gagal', steps:[...localSteps] })
    }
  }

  // ── Browser-compatible helpers ──
  const hexToU8 = (hex: string): Uint8Array => {
    const h = hex.startsWith('0x') ? hex.slice(2) : hex
    const arr = new Uint8Array(h.length / 2)
    for (let i = 0; i < arr.length; i++) arr[i] = parseInt(h.slice(i*2, i*2+2), 16)
    return arr
  }
  const concatU8 = (...arrays: Uint8Array[]): Uint8Array => {
    const total = arrays.reduce((s, a) => s + a.length, 0)
    const out = new Uint8Array(total)
    let offset = 0
    arrays.forEach(a => { out.set(a, offset); offset += a.length })
    return out
  }
  const u32LE = (n: number): Uint8Array => {
    const buf = new Uint8Array(4)
    new DataView(buf.buffer).setUint32(0, n, true)
    return buf
  }
  const u64LE = (n: bigint): Uint8Array => {
    const buf = new Uint8Array(8)
    new DataView(buf.buffer).setBigUint64(0, n, true)
    return buf
  }
  const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
  const evmTokenBalance = async (tokenAddr: string, ownerAddr: string): Promise<bigint> => {
    const data = '0x70a08231' + encAddr(ownerAddr)
    const out = await window.ethereum!.request({ method:'eth_call', params:[{ to: tokenAddr, data }, 'latest'] })
    return BigInt(out || '0x0')
  }
  const evmNativeBalance = async (ownerAddr: string): Promise<bigint> => {
    const out = await window.ethereum!.request({ method:'eth_getBalance', params:[ownerAddr, 'latest'] })
    return BigInt(out || '0x0')
  }
  const toHex = (n: bigint) => `0x${n.toString(16)}`
  const getBufferedEvmFees = async (tx: any, multiplier = 3n) => {
    const out: any = {}
    try {
      const gasHex = await window.ethereum!.request({ method:'eth_estimateGas', params:[tx] })
      out.gas = toHex((BigInt(gasHex) * 13n) / 10n + 10_000n)
    } catch(e) {
      console.warn('eth_estimateGas failed, wallet will estimate:', e instanceof Error ? e.message : String(e))
    }
    try {
      const block = await window.ethereum!.request({ method:'eth_getBlockByNumber', params:['latest', false] })
      const baseFee = block?.baseFeePerGas ? BigInt(block.baseFeePerGas) : 0n
      if (baseFee > 0n) {
        let tip = 0n
        try { tip = BigInt(await window.ethereum!.request({ method:'eth_maxPriorityFeePerGas' })) } catch {}
        const minTip = 1_500_000n
        if (tip < minTip) tip = minTip
        out.maxPriorityFeePerGas = toHex(tip)
        out.maxFeePerGas = toHex(baseFee * multiplier + tip * 2n)
        return out
      }
    } catch(e) {
      console.warn('EIP-1559 fee lookup failed:', e instanceof Error ? e.message : String(e))
    }
    try {
      const gasPrice = BigInt(await window.ethereum!.request({ method:'eth_gasPrice' }))
      out.gasPrice = toHex(gasPrice * multiplier)
    } catch {}
    return out
  }
  const sendEvmTxBuffered = async (tx: any): Promise<string> => {
    const firstFees = await getBufferedEvmFees(tx, INITIAL_FEE_MULTIPLIER)
    try {
      return await window.ethereum!.request({ method:'eth_sendTransaction', params:[{ ...tx, ...firstFees }] })
    } catch(e:any) {
      const msg = e?.message || ''
      if (!/max fee per gas less than block base fee|replacement transaction underpriced|fee/i.test(msg)) throw e
      await new Promise(r => setTimeout(r, 1200))
      const retryFees = await getBufferedEvmFees(tx, MAX_FEE_MULTIPLIER)
      return await window.ethereum!.request({ method:'eth_sendTransaction', params:[{ ...tx, ...retryFees }] })
    }
  }

  // ── Solana burn helper ──
  const burnSolanaUsdc = async (amountInput: string, mintRecipientEvm: string, providerParam?: any, ownerAddress?: string): Promise<string> => {
    const { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram, Keypair } = await import('@solana/web3.js')
    const { createAssociatedTokenAccountInstruction, createTransferInstruction, getAssociatedTokenAddress, TOKEN_PROGRAM_ID } = await import('@solana/spl-token')

    const provider = providerParam ?? solanaWallet?.provider
    if (!provider) throw new Error('Solana wallet tidak terhubung')
    if (!provider.isConnected) await provider.connect()
    const conn = new Connection('https://api.devnet.solana.com', 'confirmed')
    const ownerAddr = ownerAddress ?? solanaWallet?.address
    if (!ownerAddr) throw new Error('Solana address tidak diketahui')
    const owner = new PublicKey(ownerAddr)
    const mint = new PublicKey(SOLANA_CCTP.usdcMint)
    const senderAta = await getAssociatedTokenAddress(mint, owner)
    const treasury = new PublicKey(SOLANA_FEE_TREASURY)
    const treasuryAta = await getAssociatedTokenAddress(mint, treasury)

    // EVM address sebagai bytes32 mintRecipient
    const evmHex = (mintRecipientEvm.startsWith('0x') ? mintRecipientEvm.slice(2) : mintRecipientEvm).toLowerCase().padStart(64, '0')
    const mintRecipientBytes = hexToU8(evmHex)

    const amountLamports = parseUnits(amountInput, 6)
    const feeLamports = (amountLamports * BigInt(Math.max(0, Math.floor(PLATFORM_FEE_BPS)))) / 10000n
    const burnLamports = amountLamports - feeLamports
    if (burnLamports <= 0n) throw new Error('Amount terlalu kecil setelah platform fee')

    // deposit_for_burn Anchor discriminator: sha256("global:deposit_for_burn")[0..8]
    const discriminator = new Uint8Array([215, 60, 61, 46, 114, 55, 128, 176])
    const destCallerBytes = new Uint8Array(32)
    const maxFee = 10n
    const minFinalityThreshold = 2000
    const data = concatU8(
      discriminator,
      u64LE(burnLamports),
      u32LE(26),
      mintRecipientBytes,
      destCallerBytes,
      u64LE(maxFee),
      u32LE(minFinalityThreshold)
    )

    const tmProgram = new PublicKey(SOLANA_CCTP.tokenMessengerProgram)
    const mtProgram = new PublicKey(SOLANA_CCTP.messageTransmitterProgram)

    const [tokenMessengerPDA] = PublicKey.findProgramAddressSync([enc('token_messenger')], tmProgram)
    const [senderAuthorityPDA] = PublicKey.findProgramAddressSync([enc('sender_authority')], tmProgram)
    const [remoteTokenMsgPDA] = PublicKey.findProgramAddressSync([enc('remote_token_messenger'), enc('26')], tmProgram)
    const [tokenMinterPDA] = PublicKey.findProgramAddressSync([enc('token_minter')], tmProgram)
    const [localTokenPDA] = PublicKey.findProgramAddressSync([enc('local_token'), mint.toBytes()], tmProgram)
    const [denylistAccountPDA] = PublicKey.findProgramAddressSync([enc('denylist_account'), owner.toBytes()], tmProgram)
    const [mtPDA] = PublicKey.findProgramAddressSync([enc('message_transmitter')], mtProgram)
    const [tokenMessengerEventAuthority] = PublicKey.findProgramAddressSync([enc('__event_authority')], tmProgram)
    const messageSentEventData = Keypair.generate()

    const ix = new TransactionInstruction({
      programId: tmProgram,
      keys: [
        { pubkey: owner, isSigner: true, isWritable: true },          // owner
        { pubkey: owner, isSigner: true, isWritable: true },          // event_rent_payer
        { pubkey: senderAuthorityPDA, isSigner: false, isWritable: false },
        { pubkey: senderAta, isSigner: false, isWritable: true },
        { pubkey: denylistAccountPDA, isSigner: false, isWritable: false },
        { pubkey: mtPDA, isSigner: false, isWritable: true },
        { pubkey: tokenMessengerPDA, isSigner: false, isWritable: false },
        { pubkey: remoteTokenMsgPDA, isSigner: false, isWritable: false },
        { pubkey: tokenMinterPDA, isSigner: false, isWritable: false },
        { pubkey: localTokenPDA, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: messageSentEventData.publicKey, isSigner: true, isWritable: true },
        { pubkey: mtProgram, isSigner: false, isWritable: false },
        { pubkey: tmProgram, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: tokenMessengerEventAuthority, isSigner: false, isWritable: false },
        { pubkey: tmProgram, isSigner: false, isWritable: false },
      ],
      data: data as any,
    })

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash()
    const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: owner })
    const treasuryAtaExists = await conn.getAccountInfo(treasuryAta).catch(() => null)
    if (!treasuryAtaExists) {
      tx.add(createAssociatedTokenAccountInstruction(owner, treasuryAta, treasury, mint))
    }
    if (feeLamports > 0n) {
      tx.add(createTransferInstruction(senderAta, treasuryAta, owner, feeLamports))
    }
    tx.add(ix)
    tx.partialSign(messageSentEventData)
    const signed = await provider.signTransaction(tx)
    const sig = await conn.sendRawTransaction(
      signed instanceof Uint8Array ? signed : signed.serialize(),
      { skipPreflight: false, preflightCommitment: 'confirmed' }
    )
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
    return sig
  }

  // ── Solana receiveMessage helper ──
  const signSolanaReceiveMessage = async (attestationHex: string, messageHex: string, toAddress: string, providerParam?: any): Promise<string> => {
    const { Connection, PublicKey, TransactionInstruction, SystemProgram, VersionedTransaction, TransactionMessage } = await import('@solana/web3.js')
    const { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = await import('@solana/spl-token')

    const provider = providerParam ?? solanaWallet?.provider
    if (!provider) throw new Error('Solana wallet tidak terhubung')
    try { if (!provider.isConnected) await provider.connect() } catch {}

    const conn = new Connection('https://api.devnet.solana.com', 'confirmed')
    const payerKey = new PublicKey(toAddress)
    const mint = new PublicKey(SOLANA_CCTP.usdcMint)
    const recipientAta = await getAssociatedTokenAddress(mint, payerKey)

    const msgBytes = hexToU8(messageHex)
    const attBytes = hexToU8(attestationHex)

    const MESSAGE_TRANSMITTER_PROGRAM = new PublicKey(SOLANA_CCTP.messageTransmitterProgram)
    const TOKEN_MESSENGER_PROGRAM = new PublicKey(SOLANA_CCTP.tokenMessengerProgram)
    console.log(`[mint] client=${SOLANA_MINT_CLIENT_VERSION}`)

    // ── Parse CCTP message header ──
    // [0-3] version, [4-7] sourceDomain, [8-11] destDomain, [12-19] nonce
    const versionBytes = new DataView(msgBytes.buffer, msgBytes.byteOffset, 4).getUint32(0, false)  // BE
    const sourceDomain = new DataView(msgBytes.buffer, msgBytes.byteOffset + 4, 4).getUint32(0, false)  // BE
    const destDomainRead = new DataView(msgBytes.buffer, msgBytes.byteOffset + 8, 4).getUint32(0, false)  // BE
    const nonce = new DataView(msgBytes.buffer, msgBytes.byteOffset + 12, 8).getBigUint64(0, false)    // BE

    // ── Debug: log message header ──
    console.log(`[mint] msg=${messageHex.slice(0,80)}...`)
    console.log(`[mint] msg version bytes 0-3: ${msgBytes.slice(0,4).join(',')} (u32BE=${versionBytes})`)
    console.log(`[mint] sourceDomain=${sourceDomain} destDomain=${destDomainRead} nonce=${nonce}`)
    console.log(`[mint] msgTotalLen=${msgBytes.length} attLen=${attBytes.length}`)

    // ── MessageTransmitter PDAs ──
    const [messageTransmitterAccount] = PublicKey.findProgramAddressSync(
      [enc('message_transmitter')], MESSAGE_TRANSMITTER_PROGRAM
    )
    // CCTP v2 stores each nonce separately.
    const nonceBuf = new Uint8Array(32)
    nonceBuf.set(msgBytes.slice(12, 44), 0)
    const [usedNoncePDA] = PublicKey.findProgramAddressSync(
      [enc('used_nonce'), nonceBuf],
      MESSAGE_TRANSMITTER_PROGRAM
    )
    // authority_pda: seeds = [b"message_transmitter_authority", receiver.key()]
    const [authorityPda] = PublicKey.findProgramAddressSync(
      [enc('message_transmitter_authority'), TOKEN_MESSENGER_PROGRAM.toBytes()],
      MESSAGE_TRANSMITTER_PROGRAM
    )
    const [eventAuthority] = PublicKey.findProgramAddressSync(
      [enc('__event_authority')], MESSAGE_TRANSMITTER_PROGRAM
    )

    const nonceHex = Array.from(nonceBuf).map(b => b.toString(16).padStart(2, '0')).join('')
    console.log(`[mint] usedNonce seed: used_nonce|nonce=${nonceHex}`)
    console.log(`[mint] usedNonce PDA: ${usedNoncePDA.toBase58()}`)
    console.log(`[mint] authorityPda PDA: ${authorityPda.toBase58()}`)

    // ── TokenMessengerMinterV2 PDAs (remaining accounts for CPI) ──
    const [tokenMessenger] = PublicKey.findProgramAddressSync(
      [enc('token_messenger')], TOKEN_MESSENGER_PROGRAM
    )
    const remoteDomainSeed = enc(sourceDomain.toString())
    const [remoteTokenMessenger] = PublicKey.findProgramAddressSync(
      [enc('remote_token_messenger'), remoteDomainSeed], TOKEN_MESSENGER_PROGRAM
    )
    const [localToken] = PublicKey.findProgramAddressSync(
      [enc('local_token'), mint.toBytes()], TOKEN_MESSENGER_PROGRAM
    )
    const [tokenMinter] = PublicKey.findProgramAddressSync(
      [enc('token_minter')], TOKEN_MESSENGER_PROGRAM
    )
    // CCTP v2 message header is 148 bytes; BurnMessage.burn_token is body[4..36].
    const sourceTokenBytes = msgBytes.slice(152, 184)
    const [tokenPair] = PublicKey.findProgramAddressSync(
      [enc('token_pair'), remoteDomainSeed, sourceTokenBytes], TOKEN_MESSENGER_PROGRAM
    )
    const [custodyTokenAccount] = PublicKey.findProgramAddressSync(
      [enc('custody'), mint.toBytes()], TOKEN_MESSENGER_PROGRAM
    )
    const [tokenProgramEventAuthority] = PublicKey.findProgramAddressSync(
      [enc('__event_authority')], TOKEN_MESSENGER_PROGRAM
    )
    const tokenMessengerInfo = await conn.getAccountInfo(tokenMessenger)
    if (!tokenMessengerInfo?.data || tokenMessengerInfo.data.length < 141) {
      throw new Error('TokenMessenger account tidak valid')
    }
    const feeRecipient = new PublicKey(tokenMessengerInfo.data.slice(109, 141))
    const feeRecipientAta = await getAssociatedTokenAddress(mint, feeRecipient, true)
    console.log(`[mint] tokenPair PDA: ${tokenPair.toBase58()}`)
    console.log(`[mint] feeRecipientAta: ${feeRecipientAta.toBase58()}`)

    // ── Anchor discriminator: sha256("global:receive_message")[0..8] ──
    const discriminator = new Uint8Array([38, 144, 127, 225, 31, 225, 238, 25])
    const data = concatU8(
      discriminator,
      u32LE(msgBytes.length), msgBytes,
      u32LE(attBytes.length), attBytes
    )

    let curBlockhash: string
    let curLastValid: number
    const latestBlock = await conn.getLatestBlockhash('confirmed')
    curBlockhash = latestBlock.blockhash
    curLastValid = latestBlock.lastValidBlockHeight

    // Step 1: Buat ATA di transaksi TERPISAH (pakai VersionedTransaction, hindari signature error #5663012)
    const ataInfo = await conn.getAccountInfo(recipientAta)
    if (!ataInfo) {
      console.log('[mint] Buat ATA dulu...')
      const ataIx = createAssociatedTokenAccountInstruction(
        payerKey, recipientAta, payerKey, mint,
        TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      )
      const ataMsg = new TransactionMessage({ payerKey, recentBlockhash: curBlockhash, instructions: [ataIx] }).compileToV0Message()
      const ataVersionedTx = new VersionedTransaction(ataMsg)
      const ataSigned = await provider.signTransaction(ataVersionedTx)
      const ataSig = await conn.sendRawTransaction(
        ataSigned instanceof Uint8Array ? ataSigned : ataSigned.serialize(),
        { skipPreflight: true, preflightCommitment: 'confirmed' }
      )
      await conn.confirmTransaction({ signature: ataSig, blockhash: curBlockhash, lastValidBlockHeight: curLastValid }, 'confirmed')
      console.log('[mint] ATA created:', ataSig)
      // Refresh blockhash setelah ATA created
      const nextBlock = await conn.getLatestBlockhash('confirmed')
      curBlockhash = nextBlock.blockhash
      curLastValid = nextBlock.lastValidBlockHeight
    }

    // Step 2: receiveMessage — Anchor instruction dengan account list:
    //   Fixed: payer (signer), caller, authority_pda, message_transmitter, used_nonce, receiver, system_program
    //   Remaining accounts: token_messenger_minter, remote_token_messenger, token_minter, local_token,
    //                       mint, recipient_ata, custody_token_account, token_program,
    //                       event_authority, message_transmitter_program
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise(r => setTimeout(r, 1200))
          const freshBlock = await conn.getLatestBlockhash('confirmed')
          curBlockhash = freshBlock.blockhash
          curLastValid = freshBlock.lastValidBlockHeight
        }

        const recvIx = new TransactionInstruction({
          programId: MESSAGE_TRANSMITTER_PROGRAM,
          keys: [
            // ── Fixed accounts (ReceiveMessage Anchor struct) ──
            { pubkey: payerKey, isSigner: true, isWritable: true },      // payer
            { pubkey: payerKey, isSigner: true, isWritable: false },     // caller (Signer in Anchor)
            { pubkey: authorityPda, isSigner: false, isWritable: false }, // authority_pda
            { pubkey: messageTransmitterAccount, isSigner: false, isWritable: false }, // message_transmitter
            { pubkey: usedNoncePDA, isSigner: false, isWritable: true },    // used_nonce
            { pubkey: TOKEN_MESSENGER_PROGRAM, isSigner: false, isWritable: false }, // receiver
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
            { pubkey: eventAuthority, isSigner: false, isWritable: false },
            { pubkey: MESSAGE_TRANSMITTER_PROGRAM, isSigner: false, isWritable: false },
            // ── Remaining accounts (forwarded to TokenMessengerMinterV2 CPI) ──
            { pubkey: tokenMessenger, isSigner: false, isWritable: false },
            { pubkey: remoteTokenMessenger, isSigner: false, isWritable: false },
            { pubkey: tokenMinter, isSigner: false, isWritable: true },
            { pubkey: localToken, isSigner: false, isWritable: true },
            { pubkey: tokenPair, isSigner: false, isWritable: false },
            { pubkey: feeRecipientAta, isSigner: false, isWritable: true },
            { pubkey: recipientAta, isSigner: false, isWritable: true },
            { pubkey: custodyTokenAccount, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: tokenProgramEventAuthority, isSigner: false, isWritable: false },
            { pubkey: TOKEN_MESSENGER_PROGRAM, isSigner: false, isWritable: false },
          ],
          data: data as unknown as Buffer,
        })

        const recvMsg = new TransactionMessage({ payerKey, recentBlockhash: curBlockhash, instructions: [recvIx] }).compileToV0Message()
        const versionedTx = new VersionedTransaction(recvMsg)
        const signed = await provider.signTransaction(versionedTx)
        const sig = await conn.sendRawTransaction(
          signed instanceof Uint8Array ? signed : signed.serialize(),
          { skipPreflight: false, preflightCommitment: 'confirmed' }
        )
        console.log(`[mint] receiveMessage tx sent: ${sig}`)
        const conf = await conn.confirmTransaction({ signature: sig, blockhash: curBlockhash, lastValidBlockHeight: curLastValid }, 'confirmed')
        if (conf.value.err) throw new Error('Transaction failed: ' + JSON.stringify(conf.value.err))
        return sig
      } catch (e: any) {
        let logsText = ''
        try {
          const logs = typeof e?.getLogs === 'function' ? await e.getLogs(conn) : null
          if (logs?.length) logsText = `\n${logs.join('\n')}`
        } catch {}
        console.error('[mint] receiveMessage failed:', e.message, logsText)
        if (logsText && !e.message?.includes('Program log:')) {
          throw new Error(`${e.message}${logsText}`)
        }
        if (attempt === 2) throw e
      }
    }
    throw new Error('receiveMessage failed')
  }

  const waitEvmTx = async (txHash: string) => {
    await new Promise(r=>setTimeout(r,1000))
    for (let i=0;i<40;i++) {
      try {
        const rec = await window.ethereum!.request({method:'eth_getTransactionReceipt',params:[txHash]})
        if (rec?.status==='0x1') return
        if (rec?.status==='0x0') throw new Error('Transaction failed onchain')
      } catch(e:any) { if(e.message?.includes('failed')) throw e }
      await new Promise(r=>setTimeout(r,i<10?1200:2000))
    }
    throw new Error('Transaction timeout')
  }



  const handleBridge = async () => {
    if (!address) return
    if (isNativeBridgeToken) {
      if (!amount) return
      setLoading(true); setStatus(null)
      try {
        await bridgeNativeEvmToArc()
      } catch(e:any) {
        setStatus(prev => ({ type:'error', msg:e?.message||'Native bridge gagal', steps: prev?.steps }))
      }
      setLoading(false); setStep('')
      return
    }
    // Pre-connect Solana wallet — tanpa return, jadi 1x klik langsung bridge
    let _solWallet = solanaWallet
    if ((isFromSolana || isToSolana) && !_solWallet) {
      setStep('🔗 Hubungkan Solana wallet...')
      _solWallet = await connectSolana()
      if (!_solWallet) { setStep(''); return }
    }
    setLoading(true); setStatus(null)
    try {
      if (isFromSolana) await bridgeFromSolana(_solWallet)
      else await bridgeEvm(_solWallet)
    } catch(e:any) {
      setStatus(prev => ({ type:'error', msg:e?.message||'Bridge gagal', steps: prev?.steps }))
    }
    setLoading(false); setStep('')
    setTimeout(onRefresh, 2000) // selalu refresh balance setelah bridge
  }

  const STEP_LABELS: Record<string,string> = {
    'circle-transfer':'0. Circle→MetaMask','approve':'1. Approve',
    'burn':'2. Burn','attestation':'3. Attestation','mint':'4. Mint',
    'fetchattestation':'3. Attestation',
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      {/* Source selector */}
      {!isFromSolana && fromChain === 'Arc_Testnet' && (
        <div>
          <label style={{color:'#64748b',fontSize:13,display:'block',marginBottom:6}}>{t('bridge.from')}</label>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            <button onClick={()=>setSource('circle')} style={{padding:'10px 8px',borderRadius:8,cursor:'pointer',border:source==='circle'?'1px solid rgba(99,102,241,0.75)':'1px solid #1e1e2e',background:source==='circle'?'rgba(99,102,241,0.16)':'rgba(18,18,26,0.8)',color:source==='circle'?'#c7d2fe':'#64748b',fontSize:12,fontWeight:600}}>
              Circle Wallet
              <div style={{fontSize:10,marginTop:2,color:'#94a3b8'}}>{circleB.toFixed(4)} {displayToken}</div>
            </button>
            <button onClick={()=>setSource('eoa')} style={{padding:'10px 8px',borderRadius:8,cursor:'pointer',border:source==='eoa'?'1px solid rgba(245,158,11,0.75)':'1px solid #1e1e2e',background:source==='eoa'?'rgba(245,158,11,0.14)':'rgba(18,18,26,0.8)',color:source==='eoa'?'#fbbf24':'#64748b',fontSize:12,fontWeight:600}}>
              EOA MetaMask
              <div style={{fontSize:10,marginTop:2,color:'#94a3b8'}}>{eoaB.toFixed(4)} {displayToken}</div>
            </button>
          </div>
        </div>
      )}

      {/* Balance */}
      <div className='glass' style={{padding:10,borderRadius:10,fontSize:12}}>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}><span style={{color:'#64748b'}}>🔵 Circle Wallet</span><span style={{color:'#818cf8',fontWeight:600}}>{isNativeBridgeToken ? '-' : circleB.toFixed(4)} {displayToken}</span></div>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}><span style={{color:'#64748b'}}>🟡 MetaMask</span><span style={{color:'#f59e0b',fontWeight:600}}>{isNativeBridgeToken ? 'Use wallet gas balance' : eoaB.toFixed(4)} {displayToken}</span></div>
        {solanaWallet && <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}><span style={{color:'#64748b'}}>🟣 Solana</span><span style={{color:'#a78bfa',fontWeight:600}}>{solanaUsdcBal} USDC</span></div>}
        <div style={{borderTop:'1px solid #1e1e2e',paddingTop:3,display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Total EVM</span><span style={{fontWeight:700}}>{isNativeBridgeToken ? 'Not indexed' : totalB.toFixed(4)} {displayToken}</span></div>
      </div>

      {/* Solana Wallet Card */}
      {(isToSolana || isFromSolana) && (
        <div className='glass' style={{padding:12,borderRadius:12,border:'1px solid rgba(167,139,250,0.3)'}}>
          <div style={{fontWeight:600,fontSize:13,color:'#a78bfa',marginBottom:8}}>🪄 {t('bridge.solanaWallet')}</div>
          {solanaWallet ? (
            <div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                <span style={{color:'#a78bfa',fontFamily:'monospace',fontSize:11}}>{solanaWallet.address.slice(0,8)}...{solanaWallet.address.slice(-6)}</span>
                <button onClick={()=>setSolanaWallet(null)} style={{fontSize:10,background:'rgba(239,68,68,0.1)',color:'#f87171',border:'1px solid rgba(239,68,68,0.3)',padding:'2px 8px',borderRadius:6,cursor:'pointer'}}>{t('wallet.disconnect')}</button>
              </div>
              <div style={{fontSize:12,color:'#64748b'}}>SOL: <span style={{color:'#e2e8f0'}}>-</span> &nbsp; USDC: <span style={{color:'#e2e8f0'}}>{solanaUsdcBal}</span></div>
              <div style={{fontSize:11,color:'#10b981',marginTop:4}}>✓ {t('bridge.solanaRequired')}</div>
              <div style={{fontSize:11,color:'#10b981',marginTop:3}}>✓ {t('bridge.solanaAuto')}</div>
            </div>
          ) : (
            <button onClick={connectSolana} style={{width:'100%',background:'rgba(167,139,250,0.15)',color:'#a78bfa',border:'1px solid rgba(167,139,250,0.4)',padding:'8px',borderRadius:8,cursor:'pointer',fontSize:12,fontWeight:600}}>
              🔗 {t('bridge.connectSolana')}
            </button>
          )}
        </div>
      )}

      {/* From Chain */}
      <div style={{display:'flex',justifyContent:'space-between'}}>
        <label style={{color:'#64748b',fontSize:13}}>{t('bridge.fromChain')}</label>
        <button onClick={()=>setAmount(sourceBalance.toString())} style={{color:'#818cf8',background:'none',border:'none',cursor:'pointer',fontSize:12,padding:0}}>
          {isNativeBridgeToken ? 'Native balance: wallet' : `${t('common.max')}: ${sourceBalance.toFixed(token==='cirBTC'?8:4)} ${displayToken}`}
        </button>
      </div>
      <CompactChainPicker value={fromChain} options={ALL_DST_CHAINS} onChange={setFromChain} />

      <div style={{textAlign:'center'}}>
        <button onClick={()=>{setFromChain(toChain);setToChain(fromChain)}} className='glass' style={{width:36,height:30,padding:0,borderRadius:8,cursor:'pointer',color:'#818cf8',fontSize:15,border:'1px solid #1e1e2e',background:'rgba(18,18,26,0.8)'}}>⇅</button>
      </div>

      {/* To Chain */}
      <div>
        <label style={{color:'#64748b',fontSize:13,display:'block',marginBottom:6}}>{t('bridge.toChain')}</label>
        <CompactChainPicker value={toChain} options={ALL_DST_CHAINS.filter(c=>c.id!==fromChain)} onChange={setToChain} />
      </div>

      {/* Token selection */}
      <div>          <label style={{color:'#64748b',fontSize:13,display:'block',marginBottom:6}}>Token</label>
        <CompactTokenPicker
          value={isNativeBridgeToken ? displayToken : token}
          width={104}
          options={BRIDGE_TOKENS.filter(t=>!(t==='cirBTC' && (isFromSolana||isToSolana||!CCTP_SRC[fromChain]?.cirbtc||!CCTP_SRC[toChain]?.cirbtc)))}
          onChange={t=>{setToken(t);setStatus(null)}}
        />
        {nativeBridgeToken && (
          <button
            type='button'
            onClick={() => {
              setToken(nativeBridgeToken.token)
              setStatus({
                type: nativeRouteLive ? 'info' : 'warning',
                msg: nativeRouteLive
                  ? `${nativeBridgeToken.label} route aktif. ARCOX akan quote swap native ${nativeBridgeToken.symbol} ke USDC, bridge via CCTP, lalu mint USDC di Arc.`
                  : `${nativeBridgeToken.label} belum executable. ${nativeBridgeToken.unavailableReason || 'Router/pool native route belum tersedia untuk chain ini.'}`,
              })
            }}
            style={{marginTop:8,width:'100%',border:'1px solid rgba(245,158,11,0.3)',background:isNativeBridgeToken?'rgba(245,158,11,0.14)':'rgba(15,23,42,0.62)',color:isNativeBridgeToken?'#fbbf24':'#cbd5e1',padding:'9px 10px',borderRadius:8,cursor:'pointer',textAlign:'left',fontSize:12,fontWeight:700}}
          >
            {nativeBridgeToken.label}
            <div style={{fontSize:10,color:'#94a3b8',fontWeight:500,marginTop:2}}>{nativeRouteLive ? 'Live route - quote before bridge' : 'Unavailable - route not verified'} - {nativeBridgeToken.note}</div>
            {!nativeRouteLive && nativeBridgeToken.unavailableReason && (
              <div style={{fontSize:10,color:'#f87171',fontWeight:500,marginTop:3}}>{nativeBridgeToken.unavailableReason}</div>
            )}
          </button>
        )}
      </div>

      {/* Amount */}
      <div>
        <label style={{color:'#64748b',fontSize:13,display:'block',marginBottom:6}}>{t('bridge.amount', { token: displayToken })}</label>
        <input className='input' type='number' placeholder='0.00' value={amount} onChange={e=>setAmount(e.target.value)} />
      </div>

      {/* Info */}
      <div className='glass' style={{padding:10,borderRadius:10,fontSize:12,display:'flex',flexDirection:'column',gap:3}}>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Protocol</span><span>{isNativeBridgeToken ? nativeBridgeExecutable ? 'Native swap + CCTP v2' : 'Native route preview' : `CCTP v2 ${isToSolana||isFromSolana?'Fast Transfer':''}`}</span></div>
        {!isFromSolana && fromChain==='Arc_Testnet'&&<div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>{t('bridge.fundingSource')}</span><span>{source==='circle'?'Circle → EOA → Bridge':'EOA MetaMask'}</span></div>}
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>{t('bridge.totalDebit')}</span><span>{isNativeBridgeToken ? '-' : totalDebit} {displayToken}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>{t('bridge.customFee')}</span><span>{isNativeBridgeToken ? '-' : customFee} {displayToken}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>{t('bridge.cctpFee')}</span><span>{isNativeBridgeToken ? '-' : cctpFee} {displayToken}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Platform fee</span><span style={{color:routerFee==='-'?'#64748b':'#f59e0b'}}>{platformFeeLabel}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Gateway forwarding</span><span style={{color:gatewayForwardingEnabled?'#10b981':'#64748b'}}>{gatewayForwardingEnabled ? `${forwardingFee} ${displayToken}` : 'Belum aktif'}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>{t('bridge.estimatedReceive')}</span><span style={{color:isNativeBridgeToken&&!nativeBridgeExecutable?'#64748b':'#10b981'}}>{isNativeBridgeToken ? nativeBridgeExecutable ? 'Quote on bridge' : 'Unsupported' : est} {isNativeBridgeToken&&nativeBridgeExecutable?'USDC':displayToken}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Settlement</span><span>{fromChain==='Arc_Testnet'?'~30 detik':'~30 detik - 3 menit'}</span></div>
        {!isFromSolana && !isToSolana && <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>MetaMask popup</span><span style={{color:'#10b981'}}>3x (approve + burn + mint)</span></div>}
        {!isFromSolana && isToSolana && <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>MetaMask popup</span><span>2x + Solflare 1x</span></div>}
        {isFromSolana && <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Solflare popup</span><span>1x (burn)</span></div>}
      </div>

      {step && <div style={{padding:8,borderRadius:8,background:'rgba(99,102,241,0.1)',border:'1px solid rgba(99,102,241,0.3)',color:'#818cf8',fontSize:12,textAlign:'center'}}>⏳ {step}</div>}

      {status && (
        <div style={{padding:10,borderRadius:10,fontSize:13,whiteSpace:'pre-line',
          background:status.type==='success'?'rgba(16,185,129,0.1)':status.type==='info'?'rgba(99,102,241,0.1)':status.type==='warning'?'rgba(239,68,68,0.08)':'rgba(239,68,68,0.1)',
          color:status.type==='success'?'#10b981':status.type==='info'?'#818cf8':status.type==='warning'?'#f87171':'#f87171',
          border:status.type==='success'?'1px solid rgba(16,185,129,0.3)':status.type==='info'?'1px solid rgba(99,102,241,0.3)':'1px solid rgba(239,68,68,0.3)'}}>
          <div style={{fontWeight:600,marginBottom:status.steps?.length?6:0}}>{status.msg}</div>
          {status.steps?.map((s,i)=>(
            <div key={i} style={{display:'flex',justifyContent:'space-between',fontSize:11,marginTop:2}}>
              <span style={{color:'#64748b'}}>{STEP_LABELS[s.name]||s.name}</span>
              <div style={{display:'flex',gap:4,alignItems:'center'}}>
                <span style={{color:s.state==='success'?'#10b981':s.state==='pending'?'#f59e0b':'#f87171'}}>{s.state==='success'?'✓':s.state==='pending'?'⏳':'✗'}</span>
                {s.txHash&&<a href={s.explorerUrl||'#'} target='_blank' rel='noreferrer' style={{color:'#818cf8',fontSize:10,fontFamily:'monospace'}}>{s.txHash.slice(0,8)}...→</a>}
              </div>
            </div>
          ))}
        </div>
      )}

      <button onClick={handleBridge} disabled={loading||fromChain===toChain||(!amount)} className='btn btn-primary'>
        {loading ? step||`⏳ ${t('common.processing')}` : isNativeBridgeToken ? nativeBridgeExecutable ? amount ? `Bridge ${amount} ${displayToken} to Arc` : `Bridge ${displayToken} to Arc` : `Native ${displayToken} bridge unavailable` : amount ? `Bridge ${amount} ${displayToken}` : `Bridge ${displayToken}`}
      </button>
      <div style={{fontSize:11,color:'#64748b',textAlign:'center'}}>
        {source==='circle' && fromChain==='Arc_Testnet' ? t('bridge.flowCircle') :
         isToSolana ? t('bridge.flowToSolana') :
         isFromSolana ? t('bridge.flowFromSolana') :
         t('bridge.flowEvm')}
      </div>
    </div>
  )
}
