/* eslint-disable */
import { useState, useEffect } from 'react'
import { bridgeWithAppKit } from '../appKit'
// import { BridgeChain } from '@circle-fin/app-kit' // unused import disabled
declare global { interface Window { ethereum?: any; solana?: any; solflare?: any; phantom?: { solana?: any } } }

const API = 'https://43.163.98.128.nip.io'

const EVM_CHAINS = [
  { id: 'Arc_Testnet', label: 'Arc Testnet', chainId: '0x4cef52', addParams: { chainId:'0x4cef52', chainName:'Arc Testnet', nativeCurrency:{name:'USDC',symbol:'USDC',decimals:18}, rpcUrls:['https://rpc.testnet.arc.network/'], blockExplorerUrls:['https://testnet.arcscan.app'] } },
  { id: 'Ethereum_Sepolia', label: 'Ethereum Sepolia', chainId: '0xaa36a7', addParams: null },
  { id: 'Base_Sepolia', label: 'Base Sepolia', chainId: '0x14a34', addParams: null },
  { id: 'Arbitrum_Sepolia', label: 'Arbitrum Sepolia', chainId: '0x66eee', addParams: null },
]
const SOLANA_CHAIN = { id: 'Solana_Devnet', label: 'Solana Devnet (Solana)' }
const ALL_DST_CHAINS = [...EVM_CHAINS, SOLANA_CHAIN]

// CCTP source config
const CCTP_SRC: Record<string,{tokenMessenger:string;usdc:string;domain:number}> = {
  Arc_Testnet: { tokenMessenger:'0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA', usdc:'0x3600000000000000000000000000000000000000', domain:26 },
  Ethereum_Sepolia: { tokenMessenger:'0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa', usdc:'0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', domain:0 },
  Base_Sepolia: { tokenMessenger:'0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa', usdc:'0x036CbD53842c5426634e7929541eC2318f3dCF7e', domain:6 },
  Arbitrum_Sepolia: { tokenMessenger:'0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa', usdc:'0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', domain:3 },
}
const DST_DOMAIN: Record<string,number> = { Arc_Testnet:26, Ethereum_Sepolia:0, Base_Sepolia:6, Arbitrum_Sepolia:3, Solana_Devnet:1 }
// Solana CCTP burn config
const SOLANA_CCTP = {
  usdcMint: 'G247gygHjYkwn9wECFrzzfuJxyDYpGXt9xFP6Q3FVSr5',
  tokenMessengerProgram: 'CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3',
  messageTransmitterProgram: 'CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3',
  domain: 1,
}

function enc256(n: bigint) { return n.toString(16).padStart(64,'0') }
function encAddr(a: string) { return a.slice(2).toLowerCase().padStart(64,'0') }

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
  void circleWallet;


  const [fromChain, setFromChain] = useState('Arc_Testnet')

  const [toChain, setToChain] = useState('Ethereum_Sepolia')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState('')
  const [status, setStatus] = useState<Status|null>(null)
  const [solanaWallet, setSolanaWallet] = useState<{address:string;provider:any}|null>(null)
  const [solanaUsdcBal, setSolanaUsdcBal] = useState('0')

  const circleB = parseFloat(balances.USDC||'0')
  const eoaB = parseFloat(eoaBalances.USDC||'0')
  const totalB = circleB + eoaB
  const fee = amount ? (parseFloat(amount)*0.0001).toFixed(6) : '-'
  const est = amount ? (parseFloat(amount)-parseFloat(fee==='-'?'0':fee)).toFixed(4) : '-'
  const isToSolana = toChain === 'Solana_Devnet'
  const isFromSolana = fromChain === 'Solana_Devnet'

  // ── Solana wallet connect ──
  const connectSolana = async () => {
    try {
      const provider = window.solflare || window.solana
      if (!provider) { alert('Install Solflare atau Phantom wallet'); return }
      await provider.connect()
      const addr = provider.publicKey?.toString()
      if (addr) {
        setSolanaWallet({ address: addr, provider })
        // Fetch USDC balance
        fetchSolanaUsdcBalance(addr, provider)
      }
    } catch(e:any) { console.error('Solana connect:', e.message) }
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

  useEffect(() => {
    if (isFromSolana && !solanaWallet) connectSolana()
    if (isToSolana && !solanaWallet) connectSolana()
  }, [fromChain, toChain])

  // ── EVM Bridge (Arc/EVM ↔ EVM) ──
  const bridgeEvm = async () => {
    if (!address || !amount || !window.ethereum) return
    const amtNum = parseFloat(amount)
    const amtMicro = BigInt(Math.round(amtNum*1e6))
    const localSteps: BridgeStep[] = []

    // Step 0: Circle → EOA jika perlu
    if (fromChain === 'Arc_Testnet' && circleB >= amtNum && eoaB < amtNum) {
      setStep('Transfer dari Circle Wallet ke MetaMask...')
      setStatus({ type:'info', msg:'⏳ Mentransfer USDC dari Circle Wallet ke MetaMask...' })
      const r = await fetch(API+'/api/prepare-bridge', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({metamaskAddress:address,amount}) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      localSteps.push({ name:'circle-transfer', state:'success', txHash:d.txHash, explorerUrl:d.explorerUrl })
      setStatus({ type:'info', msg:'✓ USDC di MetaMask!\n⏳ Siapkan approve...', steps:[...localSteps] })
      await new Promise(r=>setTimeout(r,3000))
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

    const srcInfo = CCTP_SRC[fromChain]
    if (!srcInfo) throw new Error('Source chain tidak didukung')
    const dstDomain = DST_DOMAIN[toChain]

    // Approve
    setStep('MetaMask: Approve USDC (1/2)...')
    setStatus({ type:'info', msg:'⏳ MetaMask popup 1/2: Approve USDC...', steps:[...localSteps] })
    const approveTx = await window.ethereum.request({ method:'eth_sendTransaction', params:[{ from:address, to:srcInfo.usdc, data:'0x095ea7b3'+encAddr(srcInfo.tokenMessenger)+enc256(amtMicro), gas:'0x186a0' }] })
    localSteps.push({ name:'approve', state:'pending', txHash:approveTx })
    setStatus({ type:'info', msg:'⏳ Menunggu approve...', steps:[...localSteps] })
    await waitEvmTx(approveTx)
    localSteps[localSteps.length-1].state='success'
    localSteps[localSteps.length-1].explorerUrl=fromChain==='Arc_Testnet'?`https://testnet.arcscan.app/tx/${approveTx}`:`https://sepolia.etherscan.io/tx/${approveTx}`

    // Burn
    setStep('MetaMask: Confirm burn (2/2)...')
    setStatus({ type:'info', msg:'✓ Approve!\n⏳ MetaMask popup 2/2: Burn...', steps:[...localSteps] })

    let burnData: string
    if (isToSolana && solanaWallet) {
      // Encode Solana address sebagai bytes32 untuk mintRecipient
      const { PublicKey } = await import('@solana/web3.js')
      const solPubkey = new PublicKey(solanaWallet.address)
      const solBytes = solPubkey.toBytes()
      const mintRecipient = Array.from(solBytes).map(b=>b.toString(16).padStart(2,'0')).join('').padStart(64,'0')
      burnData = '0x8e0250ee'+enc256(amtMicro)+enc256(BigInt(dstDomain))+mintRecipient+encAddr(srcInfo.usdc)+enc256(0n)+enc256(0n)+enc256(2000n)
    } else {
      burnData = '0x8e0250ee'+enc256(amtMicro)+enc256(BigInt(dstDomain))+encAddr(address)+encAddr(srcInfo.usdc)+enc256(0n)+enc256(0n)+enc256(2000n)
    }

    const burnTx = await window.ethereum.request({ method:'eth_sendTransaction', params:[{ from:address, to:srcInfo.tokenMessenger, data:burnData, gas:'0x493e0' }] })
    localSteps.push({ name:'burn', state:'pending', txHash:burnTx })
    setStatus({ type:'info', msg:'⏳ Menunggu burn...', steps:[...localSteps] })
    await waitEvmTx(burnTx)
    localSteps[localSteps.length-1].state='success'
    localSteps[localSteps.length-1].explorerUrl=fromChain==='Arc_Testnet'?`https://testnet.arcscan.app/tx/${burnTx}`:`https://sepolia.etherscan.io/tx/${burnTx}`

    // Attestation + Mint
    localSteps.push({ name:'attestation', state:'pending' })
    setStatus({ type:'info', msg:'✓ Burn sukses!\n⏳ Menunggu attestation Circle (~20 detik)...', steps:[...localSteps] })
    setStep('Menunggu attestation...')

    if (isToSolana) {
      // Mint di Solana → frontend Solflare yang sign
      const mintResp = await fetch(API+'/api/mint-cctp-solana', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({burnTxHash:burnTx,toAddress:solanaWallet!.address}) })
      const mintData = await mintResp.json()
      if (!mintResp.ok) throw new Error(mintData.error)

      if (mintData.requiresSolanaSign) {
        localSteps[localSteps.length-1].state='success'
        // Sign receiveMessage via Solflare
        setStep('Solflare: Sign receiveMessage di Solana...')
        setStatus({ type:'info', msg:'⏳ Solflare akan popup untuk sign mint di Solana...', steps:[...localSteps] })
        try {
          const solTxHash = await signSolanaReceiveMessage(mintData.attestation, mintData.message, solanaWallet!.address)
          localSteps.push({ name:'mint', state:'success', txHash:solTxHash, explorerUrl:`https://explorer.solana.com/tx/${solTxHash}?cluster=devnet` })
          setStatus({ type:'success', msg:`✓ Bridge berhasil! ${amount} USDC → Solana Devnet`, steps:[...localSteps] })
        } catch(e:any) {
          // Mint manual fallback
          localSteps.push({ name:'mint', state:'error' })
          setStatus({
            type:'warning',
            msg:`✗ Mint GAGAL di Solana Devnet\nstate=error | mint=error\nAlasan: ${e.message?.slice(0,150)}\nBurn tx (USDC sudah di-burn):\n${burnTx.slice(0,40)}...\n\nUSDA Anda di-burn tapi belum di-mint. Hubungi support atau retry mint manual.`,
            steps:[...localSteps]
          })
          return
        }
      }
    } else {
      // Ambil attestation dari backend
      const attResp = await fetch(API+'/api/get-attestation', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({txHash:burnTx,fromChain}) })
      const attData = await attResp.json()
      if (!attResp.ok || !attData.success) throw new Error(attData.error||'Attestation gagal')
      localSteps[localSteps.length-1].state='success'

      // Switch ke destination chain
      const dstChainInfo = EVM_CHAINS.find(c=>c.id===toChain)
      if (dstChainInfo) {
        setStep('Switch ke destination chain...')
        try {
          await window.ethereum.request({ method:'wallet_switchEthereumChain', params:[{chainId:dstChainInfo.chainId}] })
          await new Promise(r=>setTimeout(r,2000))
        } catch(e:any) {
          if ((e.code===4902||e.code===-32603) && dstChainInfo.addParams) {
            await window.ethereum.request({ method:'wallet_addEthereumChain', params:[dstChainInfo.addParams] })
            await new Promise(r=>setTimeout(r,3000))
          }
        }
      }

      // User sign receiveMessage di destination chain (MetaMask popup #3)
      setStep('MetaMask: Konfirmasi mint di destination (3/3)...')
      setStatus({ type:'info', msg:'⏳ MetaMask popup 3/3: Konfirmasi mint USDC di '+toChain+'...', steps:[...localSteps] })

      const DST_TRANSMITTER: Record<string,string> = {
        Arc_Testnet: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
        Ethereum_Sepolia: '0xe737e5cebeeba77efe34d4aa090756590b1ce275',
        Base_Sepolia: '0xe737e5cebeeba77efe34d4aa090756590b1ce275',
        Arbitrum_Sepolia: '0xe737e5cebeeba77efe34d4aa090756590b1ce275',
      }

      // Encode receiveMessage calldata
      const msgHex = attData.message.startsWith('0x') ? attData.message.slice(2) : attData.message
      const attHex = attData.attestation.startsWith('0x') ? attData.attestation.slice(2) : attData.attestation
      const encodeBytes = (hex: string) => {
        const len = (hex.length/2).toString(16).padStart(64,'0')
        const padded = hex.padEnd(Math.ceil(hex.length/64)*64,'0')
        return len + padded
      }
      // receiveMessage(bytes message, bytes attestation) selector = 0x57ecfd28
      // ABI encode: receiveMessage(bytes,bytes)
      // offset1 = 0x40 (64 bytes = setelah 2 offset slots)
      const msgByteLen = msgHex.length/2
      const msgPaddedLen = Math.ceil(msgByteLen/32)*32
      // offset2 = 64 + 32 (len) + msgPaddedLen
      const attOffsetNum = 64 + 32 + msgPaddedLen
      const attOffsetHex = attOffsetNum.toString(16).padStart(64,'0')
      const selector = '0x57ecfd28'
      const calldata = selector + '0000000000000000000000000000000000000000000000000000000000000040' + attOffsetHex + encodeBytes(msgHex) + encodeBytes(attHex)

      // Query gas price untuk mint di destination (EIP-1559 aware)
      let maxFeePerGas = '0x77359400' // fallback ~20 gwei
      let maxPriorityFeePerGas = '0x3b9aca00' // fallback ~1 gwei
      try {
        // Try to get EIP-1559 fee data
        const feeData = await window.ethereum.request({
          method: 'eth_feeHistory',
          params: ['0x1', 'latest', []],
        })
        const baseFee = BigInt(feeData.baseFeePerGas[0])
        // Get suggested priority fee
        const priorityFee = await window.ethereum.request({
          method: 'eth_maxPriorityFeePerGas',
        })
        maxPriorityFeePerGas = '0x' + BigInt(priorityFee).toString(16)
        // maxFeePerGas = baseFee + priorityFee
        maxFeePerGas = '0x' + ((baseFee + BigInt(priorityFee)) * 150n / 100n).toString(16)
      } catch (e) {
        // Fallback to legacy gasPrice if EIP-1559 not supported
        try {
          const gp = await window.ethereum.request({ method: 'eth_gasPrice' })
          maxFeePerGas = '0x' + (BigInt(gp) * 120n / 100n).toString(16)
          maxPriorityFeePerGas = maxFeePerGas // for legacy chains
        } catch (e2) {
          // Keep fallbacks
        }
      }
      const mintTx = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{ from: address, to: DST_TRANSMITTER[toChain], data: calldata, gas: '0x493e0', maxFeePerGas: maxFeePerGas, maxPriorityFeePerGas: maxPriorityFeePerGas }]
      })
      localSteps.push({ name:'mint', state:'pending', txHash:mintTx })
      setStatus({ type:'info', msg:'⏳ Menunggu mint dikonfirmasi...', steps:[...localSteps] })
      await waitEvmTx(mintTx)

      const DST_EXPLORER: Record<string,string> = {
        Arc_Testnet: 'https://testnet.arcscan.app/tx/',
        Ethereum_Sepolia: 'https://sepolia.etherscan.io/tx/',
        Base_Sepolia: 'https://sepolia.basescan.org/tx/',
        Arbitrum_Sepolia: 'https://sepolia.arbiscan.io/tx/',
      }
      localSteps[localSteps.length-1].state='success'
      localSteps[localSteps.length-1].explorerUrl=(DST_EXPLORER[toChain]||'')+mintTx
      setStatus({ type:'success', msg:`✓ Bridge berhasil! ${amount} USDC → ${toChain}`, steps:[...localSteps] })
    }

    setAmount('')
    setTimeout(onRefresh,3000); setTimeout(onRefresh,10000)
  }

  // ── Solana → Arc Bridge ──
  const bridgeFromSolana = async () => {
    if (!solanaWallet || !amount || !address) return
    const localSteps: BridgeStep[] = []
    const amtNum = parseFloat(amount)

    setStep('Mempersiapkan burn di Solana...')
    setStatus({ type:'info', msg:'⏳ Solflare akan popup untuk burn USDC di Solana...' })

    try {
      // Burn USDC di Solana via Solflare
      const burnTxHash = await burnSolanaUsdc(amtNum, address)
      localSteps.push({ name:'burn', state:'success', txHash:burnTxHash, explorerUrl:`https://explorer.solana.com/tx/${burnTxHash}?cluster=devnet` })
      setStatus({ type:'info', msg:`✓ Burn sukses di Solana!\n⏳ Menunggu attestation (~20 detik)...`, steps:[...localSteps] })

      // Backend mint di Arc
      localSteps.push({ name:'attestation', state:'pending' })
      setStatus({ type:'info', msg:'⏳ Backend polling attestation dari Solana...', steps:[...localSteps] })
      const mintResp = await fetch(API+'/api/mint-cctp-from-solana', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({burnTxHash,toAddress:address}) })
      const mintData = await mintResp.json()
      if (!mintResp.ok || !mintData.success) throw new Error(mintData.error||'Mint di Arc gagal')
      localSteps[localSteps.length-1].state='success'
      localSteps.push({ name:'mint', state:'success', txHash:mintData.txHash, explorerUrl:mintData.explorerUrl })
      setStatus({ type:'success', msg:`✓ Bridge berhasil! ${amount} USDC Solana → Arc Testnet`, steps:[...localSteps] })
      setAmount('')
      setTimeout(onRefresh,3000)
    } catch(e:any) {
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

  // ── Solana burn helper ──
  const burnSolanaUsdc = async (amtNum: number, mintRecipientEvm: string): Promise<string> => {
    const { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram } = await import('@solana/web3.js')
    const { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } = await import('@solana/spl-token')

    const provider = solanaWallet!.provider
    if (!provider.isConnected) await provider.connect()
    const conn = new Connection('https://api.devnet.solana.com', 'confirmed')
    const owner = new PublicKey(solanaWallet!.address)
    const mint = new PublicKey(SOLANA_CCTP.usdcMint)
    const senderAta = await getAssociatedTokenAddress(mint, owner)

    // EVM address sebagai bytes32 mintRecipient
    const evmHex = (mintRecipientEvm.startsWith('0x') ? mintRecipientEvm.slice(2) : mintRecipientEvm).toLowerCase().padStart(64, '0')
    const mintRecipientBytes = hexToU8(evmHex)

    const amountLamports = BigInt(Math.round(amtNum * 1e6))

    // depositForBurn discriminator
    const discriminator = new Uint8Array([210, 114, 249, 160, 192, 146, 195, 101])
    const destCallerBytes = new Uint8Array(32)
    const data = concatU8(discriminator, u64LE(amountLamports), u32LE(26), mintRecipientBytes, destCallerBytes)

    const tmProgram = new PublicKey(SOLANA_CCTP.tokenMessengerProgram)
    const mtProgram = new PublicKey('CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3')

    const [tmMinterPDA] = PublicKey.findProgramAddressSync([enc('token_messenger_minter')], tmProgram)
    const domainBuf = new Uint8Array(4); new DataView(domainBuf.buffer).setUint32(0, 26, true)
    const [remoteTokenMsgPDA] = PublicKey.findProgramAddressSync([enc('remote_token_messenger'), domainBuf], tmProgram)
    const [tokenMinterPDA] = PublicKey.findProgramAddressSync([enc('token_minter')], tmProgram)
    const [localTokenPDA] = PublicKey.findProgramAddressSync([enc('local_token'), mint.toBytes()], tmProgram)
    const [burnTokenAccPDA] = PublicKey.findProgramAddressSync([enc('burn_token_account'), mint.toBytes()], tmProgram)
    const [mtPDA] = PublicKey.findProgramAddressSync([enc('message_transmitter')], mtProgram)
    const [eventAuthPDA] = PublicKey.findProgramAddressSync([enc('__event_authority')], mtProgram)

    const ix = new TransactionInstruction({
      programId: tmProgram,
      keys: [
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: senderAta, isSigner: false, isWritable: true },
        { pubkey: tmMinterPDA, isSigner: false, isWritable: false },
        { pubkey: remoteTokenMsgPDA, isSigner: false, isWritable: false },
        { pubkey: tokenMinterPDA, isSigner: false, isWritable: true },
        { pubkey: localTokenPDA, isSigner: false, isWritable: true },
        { pubkey: burnTokenAccPDA, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: mtPDA, isSigner: false, isWritable: true },
        { pubkey: eventAuthPDA, isSigner: false, isWritable: true },
        { pubkey: mtProgram, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: data as any,
    })

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash()
    const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: owner })
    tx.add(ix)
    const signed = await provider.signTransaction(tx)
    const sig = await conn.sendRawTransaction(signed.serialize())
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
    return sig
  }

  // ── Solana receiveMessage helper ──
  const signSolanaReceiveMessage = async (attestationHex: string, messageHex: string, toAddress: string): Promise<string> => {
    const { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram } = await import('@solana/web3.js')
    const { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID } = await import('@solana/spl-token')

    // Re-connect Solflare untuk pastikan popup muncul
    const provider = solanaWallet!.provider
    if (!provider.isConnected) await provider.connect()
    const conn = new Connection('https://api.devnet.solana.com', 'confirmed')
    const owner = new PublicKey(toAddress)
    const mint = new PublicKey(SOLANA_CCTP.usdcMint)
    const recipientAta = await getAssociatedTokenAddress(mint, owner)

    const msgBytes = hexToU8(messageHex)
    const attBytes = hexToU8(attestationHex)

    // receiveMessage discriminator
    const discriminator = new Uint8Array([216, 249, 210, 149, 228, 210, 244, 218])
    const data = concatU8(discriminator, u32LE(msgBytes.length), msgBytes, u32LE(attBytes.length), attBytes)

    const mtProgram = new PublicKey('CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3')
    const tmProgram = new PublicKey(SOLANA_CCTP.tokenMessengerProgram)

    const [mtPDA] = PublicKey.findProgramAddressSync([enc('message_transmitter')], mtProgram)
    const [usedNoncesPDA] = PublicKey.findProgramAddressSync([enc('used_nonces'), msgBytes.slice(0, 32)], mtProgram)
    const [tmMinterPDA] = PublicKey.findProgramAddressSync([enc('token_messenger_minter')], tmProgram)
    const [localTokenPDA] = PublicKey.findProgramAddressSync([enc('local_token'), mint.toBytes()], tmProgram)
    const [tokenMinterPDA] = PublicKey.findProgramAddressSync([enc('token_minter')], tmProgram)
    const [custodyAccPDA] = PublicKey.findProgramAddressSync([enc('custody'), mint.toBytes()], tmProgram)
    const [eventAuthPDA] = PublicKey.findProgramAddressSync([enc('__event_authority')], mtProgram)

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash()
    const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: owner })

    const ataInfo = await conn.getAccountInfo(recipientAta)
    if (!ataInfo) {
      tx.add(createAssociatedTokenAccountInstruction(owner, recipientAta, owner, mint))
    }

    tx.add(new TransactionInstruction({
      programId: mtProgram,
      keys: [
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: mtPDA, isSigner: false, isWritable: true },
        { pubkey: usedNoncesPDA, isSigner: false, isWritable: true },
        { pubkey: tmMinterPDA, isSigner: false, isWritable: false },
        { pubkey: localTokenPDA, isSigner: false, isWritable: true },
        { pubkey: tokenMinterPDA, isSigner: false, isWritable: true },
        { pubkey: recipientAta, isSigner: false, isWritable: true },
        { pubkey: custodyAccPDA, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: eventAuthPDA, isSigner: false, isWritable: false },
        { pubkey: tmProgram, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: data as any,
    }))

    const signed = await provider.signTransaction(tx)
    const sig = await conn.sendRawTransaction(signed.serialize())
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
    return sig
  }

  const waitEvmTx = async (txHash: string) => {
    await new Promise(r=>setTimeout(r,5000))
    for (let i=0;i<30;i++) {
      try {
        const rec = await window.ethereum!.request({method:'eth_getTransactionReceipt',params:[txHash]})
        if (rec?.status==='0x1') return
        if (rec?.status==='0x0') throw new Error('Transaction failed onchain')
      } catch(e:any) { if(e.message?.includes('failed')) throw e }
      await new Promise(r=>setTimeout(r,4000))
    }
    throw new Error('Transaction timeout')
  }

  // ── Arc/EVM → Solana via AppKit (SDK Circle handle semua CCTP) ──
  const bridgeToSolanaWithAppKit = async () => {
    if (!address || !amount) return
    const localSteps: BridgeStep[] = []

    // Step 0: Circle → EOA jika perlu
    if (fromChain === 'Arc_Testnet' && circleB >= parseFloat(amount) && eoaB < parseFloat(amount)) {
      setStep('Transfer dari Circle Wallet ke MetaMask...')
      setStatus({ type:'info', msg:'⏳ Mentransfer USDC dari Circle Wallet ke MetaMask...' })
      const r = await fetch(API+'/api/prepare-bridge', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({metamaskAddress:address,amount}) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      localSteps.push({ name:'circle-transfer', state:'success', txHash:d.txHash, explorerUrl:d.explorerUrl })
      setStatus({ type:'info', msg:'✓ USDC di MetaMask!\n⏳ AppKit bridge Arc → Solana...', steps:[...localSteps] })
      await new Promise(r=>setTimeout(r,3000))
    }

    setStep('AppKit: Bridge → Solana Devnet...')
    setStatus({ type:'info', msg:'⏳ AppKit memproses (approve → burn → attestation → mint)...', steps:[...localSteps] })

    try {
      const result: any = await bridgeWithAppKit({
        from: fromChain as any,
        to: 'Solana_Devnet',
        amount,
        speed: 'SLOW',
      })

      const steps: any[] = Array.isArray(result?.steps) ? result.steps : []
      const overallState = result?.state || 'unknown'

      for (const s of steps) {
        const sName = s?.name || 'step'
        const sState: BridgeStep['state'] = s?.state === 'success' ? 'success' : s?.state === 'error' ? 'error' : 'pending'
        const sHash = s?.txHash
        const sExplorer = sHash ? `https://explorer.solana.com/tx/${sHash}?cluster=devnet` : undefined
        localSteps.push({ name: sName.toLowerCase(), state: sState, txHash: sHash, explorerUrl: sExplorer })
      }

      setStatus({ type: overallState === 'success' ? 'success' : overallState === 'error' ? 'error' : 'warning',
        msg: overallState === 'success'
          ? `✓ Bridge berhasil! ${amount} USDC → Solana Devnet`
          : overallState === 'error'
            ? `✗ Bridge gagal: ${steps.find((s:any)=>s?.state==='error')?.errorMessage || 'unknown'}`
            : `⏳ Bridge pending — Forwarder sedang relay mint.\nCek saldo Solana dalam 1-5 menit.`,
        steps: [...localSteps] })

      setAmount('')
      setTimeout(onRefresh, 3000)
    } catch(e: any) {
      setStatus({ type:'error', msg:e?.message||'Bridge gagal', steps:[...localSteps] })
    }
  }

  const handleBridge = async () => {
    if (!address) return
    if (isFromSolana && !solanaWallet) { await connectSolana(); return }
    if (isToSolana && !solanaWallet) { await connectSolana(); return }
    setLoading(true); setStatus(null)
    try {
      if (isFromSolana) await bridgeFromSolana()
      else if (isToSolana) await bridgeToSolanaWithAppKit()
      else await bridgeEvm()
    } catch(e:any) {
      setStatus({ type:'error', msg:e?.message||'Bridge gagal' })
    }
    setLoading(false); setStep('')
  }

  const STEP_LABELS: Record<string,string> = {
    'circle-transfer':'0. Circle→MetaMask','approve':'1. Approve USDC',
    'burn':'2. Burn','attestation':'3. Attestation','mint':'4. Mint',
    'fetchattestation':'3. Attestation',
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      {/* Balance */}
      <div className='glass' style={{padding:10,borderRadius:10,fontSize:12}}>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}><span style={{color:'#64748b'}}>🔵 Circle Wallet</span><span style={{color:'#818cf8',fontWeight:600}}>{circleB.toFixed(4)} USDC</span></div>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}><span style={{color:'#64748b'}}>🟡 MetaMask</span><span style={{color:'#f59e0b',fontWeight:600}}>{eoaB.toFixed(4)} USDC</span></div>
        {solanaWallet && <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}><span style={{color:'#64748b'}}>🟣 Solana</span><span style={{color:'#a78bfa',fontWeight:600}}>{solanaUsdcBal} USDC</span></div>}
        <div style={{borderTop:'1px solid #1e1e2e',paddingTop:3,display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Total EVM</span><span style={{fontWeight:700}}>{totalB.toFixed(4)} USDC</span></div>
      </div>

      {/* Solana Wallet Card */}
      {(isToSolana || isFromSolana) && (
        <div className='glass' style={{padding:12,borderRadius:12,border:'1px solid rgba(167,139,250,0.3)'}}>
          <div style={{fontWeight:600,fontSize:13,color:'#a78bfa',marginBottom:8}}>🪄 Wallet Solana</div>
          {solanaWallet ? (
            <div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                <span style={{color:'#a78bfa',fontFamily:'monospace',fontSize:11}}>{solanaWallet.address.slice(0,8)}...{solanaWallet.address.slice(-6)}</span>
                <button onClick={()=>setSolanaWallet(null)} style={{fontSize:10,background:'rgba(239,68,68,0.1)',color:'#f87171',border:'1px solid rgba(239,68,68,0.3)',padding:'2px 8px',borderRadius:6,cursor:'pointer'}}>Disconnect</button>
              </div>
              <div style={{fontSize:12,color:'#64748b'}}>SOL: <span style={{color:'#e2e8f0'}}>-</span> &nbsp; USDC: <span style={{color:'#e2e8f0'}}>{solanaUsdcBal}</span></div>
              <div style={{fontSize:11,color:'#10b981',marginTop:4}}>✓ Tujuan otomatis: alamat Solflare Anda</div>
            </div>
          ) : (
            <button onClick={connectSolana} style={{width:'100%',background:'rgba(167,139,250,0.15)',color:'#a78bfa',border:'1px solid rgba(167,139,250,0.4)',padding:'8px',borderRadius:8,cursor:'pointer',fontSize:12,fontWeight:600}}>
              🔗 Connect Solflare / Phantom
            </button>
          )}
        </div>
      )}

      {/* From Chain */}
      <div style={{display:'flex',justifyContent:'space-between'}}>
        <label style={{color:'#64748b',fontSize:13}}>Dari Chain</label>
        <button onClick={()=>setAmount(isFromSolana?solanaUsdcBal:totalB.toFixed(4))} style={{color:'#818cf8',background:'none',border:'none',cursor:'pointer',fontSize:12,padding:0}}>
          Max: {isFromSolana ? solanaUsdcBal : totalB.toFixed(4)} USDC
        </button>
      </div>
      <select className='input' value={fromChain} onChange={e=>setFromChain(e.target.value)}>
        {ALL_DST_CHAINS.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
      </select>

      <div style={{textAlign:'center'}}>
        <button onClick={()=>{setFromChain(toChain);setToChain(fromChain)}} className='glass' style={{padding:'6px 14px',borderRadius:10,cursor:'pointer',color:'#818cf8',fontSize:18,border:'1px solid #1e1e2e',background:'rgba(18,18,26,0.8)'}}>⇅</button>
      </div>

      {/* To Chain */}
      <div>
        <label style={{color:'#64748b',fontSize:13,display:'block',marginBottom:6}}>Ke Chain</label>
        <select className='input' value={toChain} onChange={e=>setToChain(e.target.value)}>
          {ALL_DST_CHAINS.filter(c=>c.id!==fromChain).map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>

      {/* Amount */}
      <div>
        <label style={{color:'#64748b',fontSize:13,display:'block',marginBottom:6}}>Jumlah USDC</label>
        <input className='input' type='number' placeholder='0.00' value={amount} onChange={e=>setAmount(e.target.value)} />
      </div>

      {/* Info */}
      <div className='glass' style={{padding:10,borderRadius:10,fontSize:12,display:'flex',flexDirection:'column',gap:3}}>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Protocol</span><span>CCTP v2 {isToSolana||isFromSolana?'Fast Transfer':''}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Estimasi fee maks</span><span>{fee} USDC</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Estimasi diterima</span><span style={{color:'#10b981'}}>{est} USDC</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Settlement</span><span>~{isToSolana||isFromSolana?'8-20':'20-30'} detik</span></div>
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

      <button onClick={handleBridge} disabled={!amount||loading||fromChain===toChain} className='btn btn-primary'>
        {loading ? step||'⏳ Memproses...' : amount ? `Bridge ${amount} USDC` : 'Bridge USDC'}
      </button>
      <div style={{fontSize:11,color:'#64748b',textAlign:'center'}}>
        {isToSolana ? 'Bridge Arc → Solana via Circle CCTP v2. Solflare sign mint.' :
         isFromSolana ? 'Bridge Solana → Arc via Circle CCTP v2. Solflare sign burn.' :
         'Bridge langsung via CCTP v2. MetaMask popup 2x untuk konfirmasi.'}
      </div>
    </div>
  )
}