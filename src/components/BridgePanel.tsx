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
  messageTransmitterProgram: 'CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd',
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
      const mintResp = await fetch(API+'/api/mint-cctp-solana', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({burnTxHash:burnTx,toAddress:solanaWallet!.address,fromChain}) })
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
      // Gunakan AppKit retry — Circle SDK handle attestation + mint internal (jauh lebih cepat)
      localSteps[localSteps.length-1].state='success'
      setStep('AppKit: memproses mint di destination...')
      setStatus({ type:'info', msg:'✓ Burn sukses!\\n⏳ AppKit memproses attestation + mint di '+toChain+'...', steps:[...localSteps] })

      // Panggil backend mint-via-appkit yang pakai kit.retry() — 3 attempts
      for (let mintRetry = 0; mintRetry < 3; mintRetry++) {
        setStep(`AppKit: mint di ${toChain} (percobaan ${mintRetry+1}/3)...`)
        const mintResp = await fetch(API+'/api/mint-via-appkit', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({burnTxHash:burnTx,fromChain,toChain,toAddress:address,amount})
        })
        const mintData = await mintResp.json()
        if (mintResp.ok && mintData.success) {
          localSteps.push({ name:'mint', state:'success', txHash:mintData.txHash, explorerUrl:mintData.explorerUrl })
          setStatus({ type:'success', msg:`✓ Bridge berhasil! ${amount} USDC → ${toChain}`, steps:[...localSteps] })
          setAmount('')
          setTimeout(onRefresh,3000); setTimeout(onRefresh,10000)
          return
        }
        if (mintRetry < 2) {
          setStatus({ type:'info', msg:`⏳ AppKit retry ${mintRetry+2}/3...`, steps:[...localSteps] })
          await new Promise(r=>setTimeout(r,10000))
        } else {
          // Fallback ke mint-direct (attestation + receiveMessage via backend)
          setStep('Fallback: mint via backend /api/mint-direct...')
          setStatus({ type:'info', msg:'⏳ AppKit gagal, fallback ke mint-direct backend...', steps:[...localSteps] })
          localSteps.push({ name:'mint-manual', state:'pending' })
          const fallbackResp = await fetch(API+'/api/mint-direct', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({burnTxHash:burnTx,fromChain,toChain,toAddress:address})
          })
          const fallbackData = await fallbackResp.json()
          if (!fallbackResp.ok || !fallbackData.success) {
            throw new Error(fallbackData.error || 'Fallback mint gagal')
          }
          localSteps[localSteps.length-1].state = 'success'
          localSteps[localSteps.length-1].txHash = fallbackData.txHash
          localSteps[localSteps.length-1].explorerUrl = fallbackData.explorerUrl
          setStatus({ type:'success', msg:`✓ Bridge (fallback) berhasil! ${amount} USDC → ${toChain}`, steps:[...localSteps] })
        }
      }
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

    // deposit_for_burn Anchor discriminator: sha256("global:deposit_for_burn")[0..8]
    const discriminator = new Uint8Array([215, 60, 61, 46, 114, 55, 128, 176])
    const destCallerBytes = new Uint8Array(32)
    const data = concatU8(discriminator, u64LE(amountLamports), u32LE(26), mintRecipientBytes, destCallerBytes)

    const tmProgram = new PublicKey(SOLANA_CCTP.tokenMessengerProgram)
    const mtProgram = new PublicKey('CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd')

    const [tmMinterPDA] = PublicKey.findProgramAddressSync([enc('token_messenger_minter')], tmProgram)
    const domainBuf = new Uint8Array(4); new DataView(domainBuf.buffer).setUint32(0, 26, false) // BE — matches Anchor dest_domain.to_be_bytes()
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
    const { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram, VersionedTransaction } = await import('@solana/web3.js')
    const { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = await import('@solana/spl-token')

    const provider = solanaWallet!.provider
    try { if (!provider.isConnected) await provider.connect() } catch {}

    const conn = new Connection('https://api.devnet.solana.com', 'confirmed')
    const payerKey = new PublicKey(toAddress)
    const mint = new PublicKey(SOLANA_CCTP.usdcMint)
    const recipientAta = await getAssociatedTokenAddress(mint, payerKey)

    const msgBytes = hexToU8(messageHex)
    const attBytes = hexToU8(attestationHex)

    // Solana CCTP v2 devnet program IDs (Circle official)
    const MESSAGE_TRANSMITTER_PROGRAM = new PublicKey('CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd')
    const TOKEN_MESSENGER_PROGRAM = new PublicKey('CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3')

    // ── Parse CCTP message header ──
    // [0-3] version, [4-7] sourceDomain, [8-11] destDomain, [12-19] nonce
    const sourceDomain = new DataView(msgBytes.buffer, msgBytes.byteOffset + 4, 4).getUint32(0, false)  // BE
    const nonce = new DataView(msgBytes.buffer, msgBytes.byteOffset + 12, 8).getBigUint64(0, false)    // BE

    const sourceDomainBuf = new Uint8Array(4)
    new DataView(sourceDomainBuf.buffer).setUint32(0, sourceDomain, false) // BE for remote_token_messenger PDA

    // nonce dalam little-endian untuk used_nonce PDA seed
    const nonceLE = new Uint8Array(8)
    new DataView(nonceLE.buffer).setBigUint64(0, nonce, true) // LE

    // ── MessageTransmitter PDAs ──
    const [messageTransmitterAccount] = PublicKey.findProgramAddressSync(
      [enc('message_transmitter')], MESSAGE_TRANSMITTER_PROGRAM
    )
    // used_nonce: seeds = [b"used_nonce", nonce.to_le_bytes()]
    const [usedNonce] = PublicKey.findProgramAddressSync(
      [enc('used_nonce'), nonceLE], MESSAGE_TRANSMITTER_PROGRAM
    )
    // authority_pda: seeds = [b"message_transmitter_authority", receiver.key()]
    const [authorityPda] = PublicKey.findProgramAddressSync(
      [enc('message_transmitter_authority'), TOKEN_MESSENGER_PROGRAM.toBytes()], MESSAGE_TRANSMITTER_PROGRAM
    )
    // event_authority: seeds = [b"__event_authority"] — needed for CPI to TokenMessenger
    const [eventAuthority] = PublicKey.findProgramAddressSync(
      [enc('__event_authority')], MESSAGE_TRANSMITTER_PROGRAM
    )

    console.log(`[mint] sourceDomain=${sourceDomain} nonce=${nonce}`)
    console.log(`[mint] usedNonce PDA: ${usedNonce.toBase58()}`)
    console.log(`[mint] authorityPda PDA: ${authorityPda.toBase58()}`)

    // ── TokenMessenger PDAs (sebagai remaining accounts untuk CPI) ──
    const [tokenMessengerMinter] = PublicKey.findProgramAddressSync(
      [enc('token_messenger_minter')], TOKEN_MESSENGER_PROGRAM
    )
    const [remoteTokenMessenger] = PublicKey.findProgramAddressSync(
      [enc('remote_token_messenger'), sourceDomainBuf], TOKEN_MESSENGER_PROGRAM
    )
    const [localToken] = PublicKey.findProgramAddressSync(
      [enc('local_token'), mint.toBytes()], TOKEN_MESSENGER_PROGRAM
    )
    const [tokenMinter] = PublicKey.findProgramAddressSync(
      [enc('token_minter')], TOKEN_MESSENGER_PROGRAM
    )
    const [custodyTokenAccount] = PublicKey.findProgramAddressSync(
      [enc('custody'), mint.toBytes()], TOKEN_MESSENGER_PROGRAM
    )

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

    // Step 1: Buat ATA di transaksi TERPISAH (hindari signature error #5663012)
    const ataInfo = await conn.getAccountInfo(recipientAta)
    if (!ataInfo) {
      console.log('[mint] Buat ATA dulu...')
      const ataTx = new Transaction({ blockhash: curBlockhash, lastValidBlockHeight: curLastValid, feePayer: payerKey })
      ataTx.add(createAssociatedTokenAccountInstruction(
        payerKey, recipientAta, payerKey, mint,
        TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      ))
      const ataVersioned = VersionedTransaction.deserialize(ataTx.serialize({ requireAllSignatures: false }))
      const ataSigned = await provider.signTransaction(ataVersioned)
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
          const freshBlock = await conn.getLatestBlockhash('confirmed')
          curBlockhash = freshBlock.blockhash
          curLastValid = freshBlock.lastValidBlockHeight
        }

        const tx = new Transaction({ blockhash: curBlockhash, lastValidBlockHeight: curLastValid, feePayer: payerKey })
        tx.add(new TransactionInstruction({
          programId: MESSAGE_TRANSMITTER_PROGRAM,
          keys: [
            // ── Fixed accounts (ReceiveMessage Anchor struct) ──
            { pubkey: payerKey, isSigner: true, isWritable: true },      // payer
            { pubkey: payerKey, isSigner: false, isWritable: false },     // caller (not signer in Anchor)
            { pubkey: authorityPda, isSigner: false, isWritable: true }, // authority_pda
            { pubkey: messageTransmitterAccount, isSigner: false, isWritable: true }, // message_transmitter
            { pubkey: usedNonce, isSigner: false, isWritable: true },    // used_nonce
            { pubkey: TOKEN_MESSENGER_PROGRAM, isSigner: false, isWritable: false }, // receiver
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
            // ── Remaining accounts (forwarded to handle_receive_message CPI) ──
            { pubkey: tokenMessengerMinter, isSigner: false, isWritable: true },
            { pubkey: remoteTokenMessenger, isSigner: false, isWritable: false },
            { pubkey: tokenMinter, isSigner: false, isWritable: true },
            { pubkey: localToken, isSigner: false, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: recipientAta, isSigner: false, isWritable: true },
            { pubkey: custodyTokenAccount, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: eventAuthority, isSigner: false, isWritable: false },
            { pubkey: MESSAGE_TRANSMITTER_PROGRAM, isSigner: false, isWritable: false },
          ],
          data: data as unknown as Buffer,
        }))

        const versionedTx = VersionedTransaction.deserialize(tx.serialize({ requireAllSignatures: false }))
        const signed = await provider.signTransaction(versionedTx)
        const sig = await conn.sendRawTransaction(
          signed instanceof Uint8Array ? signed : signed.serialize(),
          { skipPreflight: false, preflightCommitment: 'confirmed' }
        )
        console.log(`[mint] receiveMessage tx sent (attempt ${attempt+1}): ${sig}`)
        const conf = await conn.confirmTransaction({ signature: sig, blockhash: curBlockhash, lastValidBlockHeight: curLastValid }, 'confirmed')
        if (conf.value.err) throw new Error('Transaction failed: ' + JSON.stringify(conf.value.err))
        return sig
      } catch (e: any) {
        console.error(`[mint] attempt ${attempt+1}/3 failed:`, e.message)
        if (attempt === 2) throw e
        await new Promise(r => setTimeout(r, 2000))
      }
    }
    throw new Error('receiveMessage failed after 3 attempts')
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
      // Gunakan manual CCTP path untuk Solana destination (lebih reliable)
      // bridgeEvm sudah handle isToSolana via mint-cctp-solana backend + frontend sign
      else if (isToSolana) await bridgeEvm()
      else await bridgeEvm()
    } catch(e:any) {
      // Jika manual path gagal, coba AppKit sebagai fallback untuk Solana
      if (isToSolana && !isFromSolana) {
        try {
          setStatus({ type:'info', msg:'⏳ Manual path gagal, mencoba AppKit bridge...' })
          await bridgeToSolanaWithAppKit()
          return
        } catch(e2:any) {
          setStatus({ type:'error', msg:`Bridge gagal (manual + AppKit): ${e2.message?.slice(0,200)}` })
          return
        }
      }
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