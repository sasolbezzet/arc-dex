const fs = require('fs')
const API = 'https://43.163.98.128.nip.io'

// ── types.ts ──
fs.writeFileSync('src/types.ts', `
export interface CircleWallet { id: string; address: string }
export interface Balances { USDC: string; EURC: string; USYC: string }
export type Tab = 'swap' | 'bridge' | 'send' | 'info'
`.trim())

// ── WalletButton.tsx ──
fs.writeFileSync('src/components/WalletButton.tsx', `
import { useState, useEffect } from 'react'
declare global { interface Window { ethereum?: any } }
interface Props { address: string|null; onConnect:(a:string)=>void; onDisconnect:()=>void }
export function WalletButton({ address, onConnect, onDisconnect }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.request({ method: 'eth_accounts' }).then((a: string[]) => { if (a[0]) onConnect(a[0]) })
      window.ethereum.on('accountsChanged', (a: string[]) => { if (a[0]) onConnect(a[0]); else onDisconnect() })
    }
  }, [])
  const connect = async () => {
    setError(''); setLoading(true)
    if (!window.ethereum) { setError('Install MetaMask terlebih dahulu'); setLoading(false); return }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
      onConnect(accounts[0])
    } catch(e:any) { setError(e?.message || 'Gagal connect') }
    setLoading(false)
  }
  if (address) return (
    <div style={{display:'flex',alignItems:'center',gap:8}}>
      <div className='glass' style={{padding:'6px 12px',borderRadius:10,fontSize:12}}>
        <span style={{color:'#64748b'}}>Connected: </span>
        <span style={{color:'#818cf8',fontFamily:'monospace'}}>{address.slice(0,6)}...{address.slice(-4)}</span>
      </div>
      <button onClick={onDisconnect} style={{background:'rgba(239,68,68,0.2)',color:'#f87171',border:'1px solid rgba(239,68,68,0.3)',padding:'6px 12px',borderRadius:10,cursor:'pointer',fontSize:12}}>Disconnect</button>
    </div>
  )
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
      <button onClick={connect} disabled={loading} className='btn btn-primary' style={{width:'auto',padding:'8px 20px',fontSize:13}}>
        {loading ? 'Connecting...' : 'Connect Wallet'}
      </button>
      {error && <span style={{fontSize:11,color:'#f87171',maxWidth:180,textAlign:'right'}}>{error}</span>}
    </div>
  )
}
`.trim())

// ── SwapPanel.tsx ──
fs.writeFileSync('src/components/SwapPanel.tsx', `
import { useState, useEffect, useRef } from 'react'
const API = '${API}'
const TOKENS = ['USDC','EURC']
type Status = { type:'success'|'error'; msg:string; link?:string }
interface Props { address:string|null; circleWallet:{id:string;address:string}|null; balances:Record<string,string>; onRefresh:()=>void }
export function SwapPanel({ address, circleWallet, balances, onRefresh }: Props) {
  const [tokenIn, setTokenIn] = useState('USDC')
  const [tokenOut, setTokenOut] = useState('EURC')
  const [amountIn, setAmountIn] = useState('')
  const [quote, setQuote] = useState<{amountOut:string;fee:string;rate:number}|null>(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<Status|null>(null)
  const debounce = useRef<any>(null)
  const fetchQuote = async (tin:string, tout:string, amt:string) => {
    if (!amt || parseFloat(amt) <= 0) { setQuote(null); return }
    try {
      const r = await fetch(API+'/api/quote', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({tokenIn:tin,tokenOut:tout,amountIn:amt}) })
      const d = await r.json()
      if (d.amountOut) setQuote(d)
    } catch {}
  }
  useEffect(() => {
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => fetchQuote(tokenIn, tokenOut, amountIn), 600)
  }, [tokenIn, tokenOut, amountIn])
  const handleSwap = async () => {
    if (!address || !amountIn || !circleWallet) return
    setLoading(true); setStatus(null)
    try {
      const r = await fetch(API+'/api/swap', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({metamaskAddress:address,tokenIn,tokenOut,amountIn}) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setStatus({ type:'success', msg:\`✓ \${d.result?.amountIn} \${d.result?.tokenIn} → \${d.result?.amountOut} \${d.result?.tokenOut}\`, link:d.result?.explorerUrl })
      setAmountIn(''); setQuote(null)
      setTimeout(onRefresh,3000); setTimeout(onRefresh,8000)
    } catch(e:any) { setStatus({ type:'error', msg:e?.message||'Swap gagal' }) }
    setLoading(false)
  }
  const maxBal = balances[tokenIn] ? parseFloat(balances[tokenIn]).toFixed(4) : '0'
  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
          <label style={{color:'#64748b',fontSize:13}}>Dari</label>
          <button onClick={()=>setAmountIn(maxBal)} style={{color:'#818cf8',background:'none',border:'none',cursor:'pointer',fontSize:12,padding:0}}>Max: {maxBal} {tokenIn}</button>
        </div>
        <div style={{display:'flex',gap:8}}>
          <input className='input' type='number' placeholder='0.00' value={amountIn} onChange={e=>setAmountIn(e.target.value)} />
          <select className='input' value={tokenIn} onChange={e=>{setTokenIn(e.target.value);setQuote(null)}} style={{width:110}}>{TOKENS.map(t=><option key={t}>{t}</option>)}</select>
        </div>
      </div>
      <div style={{textAlign:'center'}}>
        <button onClick={()=>{setTokenIn(tokenOut);setTokenOut(tokenIn);setQuote(null)}} className='glass' style={{padding:'6px 14px',borderRadius:10,cursor:'pointer',color:'#818cf8',fontSize:18,border:'1px solid #1e1e2e',background:'rgba(18,18,26,0.8)'}}>⇅</button>
      </div>
      <div>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
          <label style={{color:'#64748b',fontSize:13}}>Ke</label>
          {quote && <span style={{color:'#10b981',fontSize:12}}>≈ {quote.amountOut} {tokenOut}</span>}
        </div>
        <div style={{display:'flex',gap:8}}>
          <input className='input' type='number' placeholder='estimasi...' value={quote?.amountOut||''} disabled style={{opacity:0.7}} />
          <select className='input' value={tokenOut} onChange={e=>{setTokenOut(e.target.value);setQuote(null)}} style={{width:110}}>{TOKENS.filter(t=>t!==tokenIn).map(t=><option key={t}>{t}</option>)}</select>
        </div>
      </div>
      <div className='glass' style={{padding:10,borderRadius:10,fontSize:12,display:'flex',flexDirection:'column',gap:3}}>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Network</span><span>Arc Testnet</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Fee</span><span>{quote?quote.fee+' USDC':'-'}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Rate</span><span>{quote?\`1 \${tokenIn} = \${quote.rate} \${tokenOut}\`:'-'}</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Wallet</span><span style={{color:'#818cf8',fontFamily:'monospace',fontSize:11}}>{circleWallet?.address.slice(0,8)}...{circleWallet?.address.slice(-6)}</span></div>
      </div>
      {status && <div style={{padding:10,borderRadius:10,fontSize:13,background:status.type==='success'?'rgba(16,185,129,0.1)':'rgba(239,68,68,0.1)',color:status.type==='success'?'#10b981':'#f87171',border:status.type==='success'?'1px solid rgba(16,185,129,0.3)':'1px solid rgba(239,68,68,0.3)'}}>{status.msg}{status.link&&<div style={{marginTop:4}}><a href={status.link} target='_blank' rel='noreferrer' style={{color:'#818cf8',fontSize:11}}>Explorer →</a></div>}</div>}
      {!address ? <div style={{padding:10,borderRadius:10,fontSize:13,background:'rgba(99,102,241,0.1)',color:'#818cf8',border:'1px solid rgba(99,102,241,0.3)',textAlign:'center'}}>Hubungkan wallet di pojok kanan atas</div>
      : <button onClick={handleSwap} disabled={!amountIn||loading||tokenIn===tokenOut} className='btn btn-primary'>{loading?'⏳ Memproses...':amountIn?\`Swap \${amountIn} \${tokenIn} → \${tokenOut}\`:'Swap'}</button>}
    </div>
  )
}
`.trim())

// ── BridgePanel.tsx ──
fs.writeFileSync('src/components/BridgePanel.tsx', `
import { useState } from 'react'
import { BridgeChain } from '@circle-fin/app-kit'
declare global { interface Window { ethereum?: any } }
const API = '${API}'
const CHAINS = [
  { id: BridgeChain.Arc_Testnet, label: 'Arc Testnet', chainId: '0x4cef52', addParams: { chainId:'0x4cef52', chainName:'Arc Testnet', nativeCurrency:{name:'USDC',symbol:'USDC',decimals:18}, rpcUrls:['https://rpc.testnet.arc.network/'], blockExplorerUrls:['https://testnet.arcscan.app'] } },
  { id: BridgeChain.Ethereum_Sepolia, label: 'Ethereum Sepolia', chainId: '0xaa36a7', addParams: null },
  { id: BridgeChain.Base_Sepolia, label: 'Base Sepolia', chainId: '0x14a34', addParams: null },
  { id: BridgeChain.Arbitrum_Sepolia, label: 'Arbitrum Sepolia', chainId: '0x66eee', addParams: null },
]
const BURN_ABI = '0x8e0250ee'
const ERC20_APPROVE = '0x095ea7b3'
const CCTP_SRC = {
  Arc_Testnet: { tokenMessenger:'0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA', usdc:'0x3600000000000000000000000000000000000000', domain:26 },
  Ethereum_Sepolia: { tokenMessenger:'0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa', usdc:'0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', domain:0 },
  Base_Sepolia: { tokenMessenger:'0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa', usdc:'0x036CbD53842c5426634e7929541eC2318f3dCF7e', domain:6 },
  Arbitrum_Sepolia: { tokenMessenger:'0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa', usdc:'0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', domain:3 },
}
const DST_DOMAIN = { Arc_Testnet:26, Ethereum_Sepolia:0, Base_Sepolia:6, Arbitrum_Sepolia:3 }
function enc256(n: bigint) { return n.toString(16).padStart(64,'0') }
function encAddr(a: string) { return a.slice(2).toLowerCase().padStart(64,'0') }
type BridgeStep = { name:string; state:'pending'|'success'|'error'; txHash?:string; explorerUrl?:string }
type Status = { type:'success'|'error'|'info'; msg:string; steps?:BridgeStep[] }
interface Props { address:string|null; circleWallet:{id:string;address:string}|null; balances:Record<string,string>; eoaBalances:Record<string,string>; onRefresh:()=>void }
export function BridgePanel({ address, circleWallet, balances, eoaBalances, onRefresh }: Props) {
  const [fromChain, setFromChain] = useState('Arc_Testnet')
  const [toChain, setToChain] = useState('Ethereum_Sepolia')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState('')
  const [status, setStatus] = useState<Status|null>(null)
  const circleB = parseFloat(balances.USDC||'0')
  const eoaB = parseFloat(eoaBalances.USDC||'0')
  const totalB = circleB + eoaB
  const fee = amount ? (parseFloat(amount)*0.0001).toFixed(6) : '-'
  const est = amount ? (parseFloat(amount)-parseFloat(fee==='-'?'0':fee)).toFixed(4) : '-'
  const handleBridge = async () => {
    if (!address || !amount || !window.ethereum) return
    setLoading(true); setStatus(null)
    const amtNum = parseFloat(amount)
    const amtMicro = BigInt(Math.round(amtNum*1e6))
    const localSteps: BridgeStep[] = []
    try {
      const srcInfo = CCTP_SRC[fromChain as keyof typeof CCTP_SRC]
      if (!srcInfo) throw new Error('Chain tidak didukung')
      const dstDomain = DST_DOMAIN[toChain as keyof typeof DST_DOMAIN]
      if (dstDomain === undefined) throw new Error('Destination chain tidak didukung')
      // Step 0: Jika dari Arc dan circle punya cukup, EOA tidak
      if (fromChain === 'Arc_Testnet' && circleB >= amtNum && eoaB < amtNum) {
        setStep('Step 1/3: Transfer dari Circle Wallet ke MetaMask...')
        setStatus({ type:'info', msg:'⏳ Mentransfer USDC dari Circle Wallet ke MetaMask...' })
        const r = await fetch(API+'/api/prepare-bridge', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({metamaskAddress:address,amount}) })
        const d = await r.json()
        if (!r.ok) throw new Error(d.error)
        localSteps.push({ name:'circle-transfer', state:'success', txHash:d.txHash, explorerUrl:d.explorerUrl })
        setStatus({ type:'info', msg:'✓ USDC tiba di MetaMask!\\n⏳ Siapkan MetaMask untuk approve...', steps:[...localSteps] })
        await new Promise(r=>setTimeout(r,3000))
      }
      // Switch network
      setStep(fromChain==='Arc_Testnet'?'Step 2/3: Switch ke Arc Testnet...':'Switch network...')
      const fromChainInfo = CHAINS.find(c=>c.id===fromChain)
      if (fromChainInfo) {
        try {
          await window.ethereum.request({ method:'wallet_switchEthereumChain', params:[{chainId:fromChainInfo.chainId}] })
          await new Promise(r=>setTimeout(r,2000))
        } catch(e:any) {
          if ((e.code===4902||e.code===-32603) && fromChainInfo.addParams) {
            await window.ethereum.request({ method:'wallet_addEthereumChain', params:[fromChainInfo.addParams] })
            await new Promise(r=>setTimeout(r,3000))
          } else if (e.code!==4001) console.warn('Switch warning:', e.message)
        }
      }
      // Approve
      setStep('MetaMask: Approve USDC (1/2)...')
      setStatus({ type:'info', msg:'⏳ MetaMask popup 1/2: Approve USDC...', steps:[...localSteps] })
      const approveTx = await window.ethereum.request({ method:'eth_sendTransaction', params:[{ from:address, to:srcInfo.usdc, data:ERC20_APPROVE+encAddr(srcInfo.tokenMessenger)+enc256(amtMicro), gas:'0x186a0' }] })
      localSteps.push({ name:'approve', state:'pending', txHash:approveTx })
      setStatus({ type:'info', msg:'⏳ Menunggu approve dikonfirmasi...', steps:[...localSteps] })
      await new Promise(r=>setTimeout(r,5000))
      for (let i=0;i<30;i++) {
        try { const rec = await window.ethereum.request({method:'eth_getTransactionReceipt',params:[approveTx]}); if(rec?.status==='0x1') break; if(rec?.status==='0x0') throw new Error('Approve failed') } catch(e:any) { if(e.message?.includes('failed')) throw e }
        await new Promise(r=>setTimeout(r,4000))
      }
      localSteps[localSteps.length-1].state='success'
      localSteps[localSteps.length-1].explorerUrl=fromChain==='Arc_Testnet'?\`https://testnet.arcscan.app/tx/\${approveTx}\`:\`https://sepolia.etherscan.io/tx/\${approveTx}\`
      setStatus({ type:'info', msg:'✓ Approve sukses!\\n⏳ MetaMask popup 2/2: Konfirmasi burn...', steps:[...localSteps] })
      // Burn
      setStep('MetaMask: Konfirmasi burn (2/2)...')
      const mintRecipient = encAddr(address)
      const burnData = BURN_ABI+enc256(amtMicro)+enc256(BigInt(dstDomain))+mintRecipient+encAddr(srcInfo.usdc)+enc256(0n)+enc256(0n)+enc256(2000n)
      const burnTx = await window.ethereum.request({ method:'eth_sendTransaction', params:[{ from:address, to:srcInfo.tokenMessenger, data:burnData, gas:'0x493e0' }] })
      localSteps.push({ name:'burn', state:'pending', txHash:burnTx })
      setStatus({ type:'info', msg:'⏳ Menunggu burn dikonfirmasi...', steps:[...localSteps] })
      await new Promise(r=>setTimeout(r,5000))
      for (let i=0;i<30;i++) {
        try { const rec = await window.ethereum.request({method:'eth_getTransactionReceipt',params:[burnTx]}); if(rec?.status==='0x1') break; if(rec?.status==='0x0') throw new Error('Burn failed') } catch(e:any) { if(e.message?.includes('failed')) throw e }
        await new Promise(r=>setTimeout(r,4000))
      }
      localSteps[localSteps.length-1].state='success'
      localSteps[localSteps.length-1].explorerUrl=fromChain==='Arc_Testnet'?\`https://testnet.arcscan.app/tx/\${burnTx}\`:\`https://sepolia.etherscan.io/tx/\${burnTx}\`
      // Mint via backend
      setStep('Step 3/3: Menunggu attestation Circle (~20 detik)...')
      localSteps.push({ name:'attestation', state:'pending' })
      setStatus({ type:'info', msg:'✓ Burn sukses!\\n⏳ Menunggu attestation dari Circle...', steps:[...localSteps] })
      const mintResp = await fetch(API+'/api/mint-cctp', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({burnTxHash:burnTx,fromChain,toChain,toAddress:address}) })
      const mintData = await mintResp.json()
      if (!mintResp.ok || !mintData.success) throw new Error(mintData.error||'Mint gagal')
      localSteps[localSteps.length-1].state='success'
      localSteps.push({ name:'mint', state:'success', txHash:mintData.txHash, explorerUrl:mintData.explorerUrl })
      setStatus({ type:'success', msg:\`✓ Bridge berhasil! \${amount} USDC → \${toChain}\`, steps:[...localSteps] })
      setAmount('')
      setTimeout(onRefresh,3000); setTimeout(onRefresh,10000)
    } catch(e:any) {
      setStatus({ type:'error', msg:e?.message||'Bridge gagal', steps:[...localSteps] })
    }
    setLoading(false); setStep('')
  }
  const STEP_LABELS: Record<string,string> = { 'circle-transfer':'0. Circle→MetaMask', approve:'1. Approve USDC', burn:'2. Burn', attestation:'3. Attestation', mint:'4. Mint' }
  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div className='glass' style={{padding:10,borderRadius:10,fontSize:12}}>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}><span style={{color:'#64748b'}}>🔵 Circle Wallet</span><span style={{color:'#818cf8',fontWeight:600}}>{circleB.toFixed(4)} USDC</span></div>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}><span style={{color:'#64748b'}}>🟡 MetaMask</span><span style={{color:'#f59e0b',fontWeight:600}}>{eoaB.toFixed(4)} USDC</span></div>
        <div style={{borderTop:'1px solid #1e1e2e',paddingTop:3,display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Total</span><span style={{fontWeight:700}}>{totalB.toFixed(4)} USDC</span></div>
      </div>
      <div style={{display:'flex',justifyContent:'space-between'}}>
        <label style={{color:'#64748b',fontSize:13}}>Dari Chain</label>
        <button onClick={()=>setAmount(totalB.toFixed(4))} style={{color:'#818cf8',background:'none',border:'none',cursor:'pointer',fontSize:12,padding:0}}>Max: {totalB.toFixed(4)}</button>
      </div>
      <select className='input' value={fromChain} onChange={e=>setFromChain(e.target.value)}>{CHAINS.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select>
      <div style={{textAlign:'center'}}><button onClick={()=>{setFromChain(toChain);setToChain(fromChain)}} className='glass' style={{padding:'6px 14px',borderRadius:10,cursor:'pointer',color:'#818cf8',fontSize:18,border:'1px solid #1e1e2e',background:'rgba(18,18,26,0.8)'}}>⇅</button></div>
      <div><label style={{color:'#64748b',fontSize:13,display:'block',marginBottom:6}}>Ke Chain</label>
        <select className='input' value={toChain} onChange={e=>setToChain(e.target.value)}>{CHAINS.filter(c=>c.id!==fromChain).map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select>
      </div>
      <div><label style={{color:'#64748b',fontSize:13,display:'block',marginBottom:6}}>Jumlah USDC</label>
        <input className='input' type='number' placeholder='0.00' value={amount} onChange={e=>setAmount(e.target.value)} />
      </div>
      <div className='glass' style={{padding:10,borderRadius:10,fontSize:12,display:'flex',flexDirection:'column',gap:3}}>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Protocol</span><span>CCTP v2 Direct</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Fee</span><span>{fee} USDC</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Estimasi diterima</span><span style={{color:'#10b981'}}>{est} USDC</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>MetaMask popup</span><span style={{color:'#10b981'}}>✓ 2x (approve + burn)</span></div>
      </div>
      {step && <div style={{padding:8,borderRadius:8,background:'rgba(99,102,241,0.1)',border:'1px solid rgba(99,102,241,0.3)',color:'#818cf8',fontSize:12,textAlign:'center'}}>⏳ {step}</div>}
      {status && (
        <div style={{padding:10,borderRadius:10,fontSize:13,whiteSpace:'pre-line',background:status.type==='success'?'rgba(16,185,129,0.1)':status.type==='info'?'rgba(99,102,241,0.1)':'rgba(239,68,68,0.1)',color:status.type==='success'?'#10b981':status.type==='info'?'#818cf8':'#f87171',border:status.type==='success'?'1px solid rgba(16,185,129,0.3)':status.type==='info'?'1px solid rgba(99,102,241,0.3)':'1px solid rgba(239,68,68,0.3)'}}>
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
      <button onClick={handleBridge} disabled={!amount||loading||fromChain===toChain||!address} className='btn btn-primary'>
        {loading?step||'⏳ Memproses...':amount?\`Bridge \${amount} USDC\`:'Bridge USDC'}
      </button>
      <div style={{fontSize:11,color:'#64748b',textAlign:'center'}}>Bridge via CCTP v2. MetaMask popup 2x untuk konfirmasi.</div>
    </div>
  )
}
`.trim())

// ── SendPanel.tsx ──
fs.writeFileSync('src/components/SendPanel.tsx', `
import { useState } from 'react'
const API = '${API}'
const TOKENS = ['USDC','EURC','USYC']
type Status = { type:'success'|'error'; msg:string; link?:string }
interface Props { address:string|null; circleWallet:{id:string;address:string}|null; balances:Record<string,string>; eoaBalances:Record<string,string>; onRefresh:()=>void }
export function SendPanel({ address, circleWallet, balances, eoaBalances, onRefresh }: Props) {
  const [source, setSource] = useState<'circle'|'eoa'>('circle')
  const [token, setToken] = useState('USDC')
  const [amount, setAmount] = useState('')
  const [toAddress, setToAddress] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<Status|null>(null)
  const activeBal = source==='circle' ? balances : eoaBalances
  const maxBal = activeBal[token] ? parseFloat(activeBal[token]).toFixed(6) : '0'
  const handleSend = async () => {
    if (!address || !amount || !toAddress || !circleWallet) return
    if (!toAddress.startsWith('0x') || toAddress.length!==42) { setStatus({type:'error',msg:'Alamat tidak valid'}); return }
    setLoading(true); setStatus(null)
    try {
      const r = await fetch(API+'/api/send', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({metamaskAddress:address,toAddress,amount,token,source}) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setStatus({ type:'success', msg:\`✓ \${amount} \${token} terkirim ke \${toAddress.slice(0,8)}...\`, link:d.result?.explorerUrl })
      setAmount(''); setToAddress('')
      setTimeout(onRefresh,3000)
    } catch(e:any) { setStatus({type:'error',msg:e?.message||'Send gagal'}) }
    setLoading(false)
  }
  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div>
        <label style={{color:'#64748b',fontSize:13,display:'block',marginBottom:6}}>Kirim dari</label>
        <div style={{display:'flex',gap:8}}>
          <button onClick={()=>setSource('circle')} style={{flex:1,padding:'10px 8px',borderRadius:10,border:\`1px solid \${source==='circle'?'rgba(99,102,241,0.5)':'#1e1e2e'}\`,background:source==='circle'?'rgba(99,102,241,0.1)':'transparent',color:source==='circle'?'#818cf8':'#64748b',cursor:'pointer',fontSize:12,fontWeight:600,textAlign:'left'}}>
            <div>🔵 Circle Wallet</div>
            <div style={{fontSize:10,marginTop:2,fontFamily:'monospace',color:'#64748b'}}>{circleWallet?.address.slice(0,8)}...{circleWallet?.address.slice(-4)}</div>
            <div style={{color:source==='circle'?'#818cf8':'#64748b',marginTop:2}}>{parseFloat(balances[token]||'0').toFixed(4)} {token}</div>
          </button>
          <button onClick={()=>setSource('eoa')} style={{flex:1,padding:'10px 8px',borderRadius:10,border:\`1px solid \${source==='eoa'?'rgba(245,158,11,0.5)':'#1e1e2e'}\`,background:source==='eoa'?'rgba(245,158,11,0.1)':'transparent',color:source==='eoa'?'#f59e0b':'#64748b',cursor:'pointer',fontSize:12,fontWeight:600,textAlign:'left'}}>
            <div>🟡 MetaMask (EOA)</div>
            <div style={{fontSize:10,marginTop:2,fontFamily:'monospace',color:'#64748b'}}>{address?.slice(0,8)}...{address?.slice(-4)}</div>
            <div style={{color:source==='eoa'?'#f59e0b':'#64748b',marginTop:2}}>{parseFloat(eoaBalances[token]||'0').toFixed(4)} {token}</div>
          </button>
        </div>
      </div>
      <div>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
          <label style={{color:'#64748b',fontSize:13}}>Token & Jumlah</label>
          <button onClick={()=>setAmount(maxBal)} style={{color:source==='circle'?'#818cf8':'#f59e0b',background:'none',border:'none',cursor:'pointer',fontSize:12,padding:0}}>Max: {parseFloat(maxBal).toFixed(4)}</button>
        </div>
        <div style={{display:'flex',gap:8}}>
          <input className='input' type='number' placeholder='0.00' value={amount} onChange={e=>setAmount(e.target.value)} />
          <select className='input' value={token} onChange={e=>setToken(e.target.value)} style={{width:110}}>{TOKENS.map(t=><option key={t}>{t}</option>)}</select>
        </div>
      </div>
      <div>
        <label style={{color:'#64748b',fontSize:13,display:'block',marginBottom:6}}>Alamat Tujuan</label>
        <input className='input' type='text' placeholder='0x...' value={toAddress} onChange={e=>setToAddress(e.target.value)} style={{fontFamily:'monospace',fontSize:12}} />
        <div style={{display:'flex',gap:6,marginTop:6}}>
          {circleWallet&&<button onClick={()=>setToAddress(circleWallet.address)} style={{fontSize:10,background:'rgba(99,102,241,0.1)',color:'#818cf8',border:'1px solid rgba(99,102,241,0.3)',padding:'3px 8px',borderRadius:6,cursor:'pointer'}}>→ Circle Wallet</button>}
          {address&&<button onClick={()=>setToAddress(address)} style={{fontSize:10,background:'rgba(245,158,11,0.1)',color:'#f59e0b',border:'1px solid rgba(245,158,11,0.3)',padding:'3px 8px',borderRadius:6,cursor:'pointer'}}>→ MetaMask</button>}
        </div>
      </div>
      <div className='glass' style={{padding:10,borderRadius:10,fontSize:12,display:'flex',flexDirection:'column',gap:3}}>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Network</span><span>Arc Testnet</span></div>
        <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>Dari</span><span style={{color:source==='circle'?'#818cf8':'#f59e0b',fontFamily:'monospace',fontSize:11}}>{source==='circle'?circleWallet?.address.slice(0,8):address?.slice(0,8)}...{source==='circle'?circleWallet?.address.slice(-6):address?.slice(-4)}</span></div>
      </div>
      {status&&<div style={{padding:10,borderRadius:10,fontSize:13,background:status.type==='success'?'rgba(16,185,129,0.1)':'rgba(239,68,68,0.1)',color:status.type==='success'?'#10b981':'#f87171',border:status.type==='success'?'1px solid rgba(16,185,129,0.3)':'1px solid rgba(239,68,68,0.3)'}}>{status.msg}{status.link&&<div style={{marginTop:4}}><a href={status.link} target='_blank' rel='noreferrer' style={{color:'#818cf8',fontSize:11}}>Explorer →</a></div>}</div>}
      <button onClick={handleSend} disabled={!amount||!toAddress||loading||!circleWallet} className='btn btn-primary'>{loading?'⏳ Mengirim...':amount?\`Kirim \${amount} \${token} dari \${source==='circle'?'Circle':'MetaMask'}\`:'Kirim Token'}</button>
    </div>
  )
}
`.trim())

// ── InfoPanel.tsx ──
fs.writeFileSync('src/components/InfoPanel.tsx', `
import { useState } from 'react'
const EXPLORER = 'https://testnet.arcscan.app'
interface Props { address:string|null; circleWallet:{id:string;address:string}|null; balances:Record<string,string>; eoaBalances:Record<string,string>; onRefresh:()=>void }
export function InfoPanel({ address, circleWallet, balances, eoaBalances, onRefresh }: Props) {
  const [copied, setCopied] = useState<string|null>(null)
  const copy = (text:string, key:string) => { navigator.clipboard.writeText(text); setCopied(key); setTimeout(()=>setCopied(null),2000) }
  const tokens = [
    { sym:'USDC', name:'USD Coin', color:'#2775ca', circleBal:balances.USDC||'0', eoaBal:eoaBalances.USDC||'0', dec:4 },
    { sym:'EURC', name:'Euro Coin', color:'#1a3cff', circleBal:balances.EURC||'0', eoaBal:eoaBalances.EURC||'0', dec:4 },
    { sym:'USYC', name:'US Yield Coin', color:'#10b981', circleBal:balances.USYC||'0', eoaBal:eoaBalances.USYC||'0', dec:6 },
  ]
  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      {circleWallet&&(
        <div className='glass' style={{borderRadius:12,padding:14}}>
          <div style={{fontWeight:600,fontSize:14,marginBottom:10,color:'#e2e8f0'}}>🔵 Circle Wallet</div>
          <div style={{fontSize:11,color:'#64748b',marginBottom:4}}>Address</div>
          <div style={{color:'#818cf8',fontFamily:'monospace',fontSize:11,wordBreak:'break-all',background:'rgba(99,102,241,0.1)',padding:'8px',borderRadius:8,marginBottom:8}}>{circleWallet.address}</div>
          <div style={{fontSize:11,color:'#64748b',marginBottom:4}}>Wallet ID (Console Faucet)</div>
          <div style={{color:'#f59e0b',fontFamily:'monospace',fontSize:11,background:'rgba(245,158,11,0.1)',padding:'8px',borderRadius:8,marginBottom:8}}>{circleWallet.id}</div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={()=>copy(circleWallet.address,'addr')} style={{flex:1,background:'rgba(99,102,241,0.2)',color:'#818cf8',border:'1px solid rgba(99,102,241,0.3)',padding:'6px 0',borderRadius:8,cursor:'pointer',fontSize:12}}>{copied==='addr'?'✓ Disalin!':'📋 Salin Address'}</button>
            <button onClick={()=>copy(circleWallet.id,'id')} style={{flex:1,background:'rgba(245,158,11,0.1)',color:'#f59e0b',border:'1px solid rgba(245,158,11,0.3)',padding:'6px 0',borderRadius:8,cursor:'pointer',fontSize:12}}>{copied==='id'?'✓ Disalin!':'📋 Salin ID'}</button>
          </div>
          <a href={\`\${EXPLORER}/address/\${circleWallet.address}\`} target='_blank' rel='noreferrer' style={{display:'block',marginTop:8,background:'rgba(16,185,129,0.1)',color:'#10b981',border:'1px solid rgba(16,185,129,0.3)',padding:'6px 0',borderRadius:8,fontSize:12,textDecoration:'none',textAlign:'center'}}>🔍 Lihat di Explorer</a>
        </div>
      )}
      {address&&(
        <div className='glass' style={{borderRadius:12,padding:14}}>
          <div style={{fontWeight:600,fontSize:14,marginBottom:10,color:'#e2e8f0'}}>🟡 MetaMask (EOA)</div>
          <div style={{color:'#f59e0b',fontFamily:'monospace',fontSize:11,wordBreak:'break-all',background:'rgba(245,158,11,0.1)',padding:'8px',borderRadius:8,marginBottom:8}}>{address}</div>
          <div style={{display:'flex',flexDirection:'column',gap:4,fontSize:13}}>
            {Object.entries(eoaBalances).map(([sym,bal])=>(
              <div key={sym} style={{display:'flex',justifyContent:'space-between'}}><span style={{color:'#64748b'}}>{sym}</span><span style={{fontFamily:'monospace'}}>{parseFloat(bal).toFixed(4)}</span></div>
            ))}
          </div>
        </div>
      )}
      <div className='glass' style={{borderRadius:12,padding:14}}>
        <div style={{fontWeight:600,fontSize:14,marginBottom:10,color:'#e2e8f0'}}>💰 Semua Balance</div>
        {tokens.map(t=>(
          <div key={t.sym} style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <div style={{width:32,height:32,borderRadius:'50%',background:t.color,display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontWeight:'bold',fontSize:11}}>{t.sym.slice(0,2)}</div>
              <div><div style={{color:'#e2e8f0',fontSize:13,fontWeight:600}}>{t.sym}</div><div style={{color:'#64748b',fontSize:11}}>{t.name}</div></div>
            </div>
            <div style={{textAlign:'right',fontSize:12}}>
              <div style={{color:'#818cf8'}}>Circle: {parseFloat(t.circleBal).toFixed(t.dec)}</div>
              <div style={{color:'#f59e0b'}}>EOA: {parseFloat(t.eoaBal).toFixed(t.dec)}</div>
              <div style={{color:'#e2e8f0',fontWeight:600}}>Total: {(parseFloat(t.circleBal)+parseFloat(t.eoaBal)).toFixed(t.dec)}</div>
            </div>
          </div>
        ))}
        <button onClick={onRefresh} style={{width:'100%',background:'rgba(99,102,241,0.1)',color:'#818cf8',border:'1px solid rgba(99,102,241,0.3)',padding:'8px',borderRadius:8,cursor:'pointer',fontSize:12}}>↻ Refresh Balance</button>
      </div>
      <div className='glass' style={{borderRadius:12,padding:14}}>
        <div style={{fontWeight:600,fontSize:14,marginBottom:10,color:'#e2e8f0'}}>🌐 Arc Testnet</div>
        {[['Chain ID','5042002'],['Finality','⚡ Sub-second'],['Gas token','USDC'],['RPC','rpc.testnet.arc.network']].map(([k,v])=>(
          <div key={k} style={{display:'flex',justifyContent:'space-between',fontSize:13,marginBottom:4}}><span style={{color:'#64748b'}}>{k}</span><span style={{color:v.startsWith('⚡')?'#10b981':'#e2e8f0',fontSize:12}}>{v}</span></div>
        ))}
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        <a href='https://faucet.circle.com/' target='_blank' rel='noreferrer' style={{display:'flex',alignItems:'center',gap:10,background:'rgba(16,185,129,0.1)',border:'1px solid rgba(16,185,129,0.3)',borderRadius:12,padding:'12px 14px',color:'#10b981',textDecoration:'none',fontSize:13}}>
          <span style={{fontSize:20}}>🚰</span><div><div style={{fontWeight:600}}>Circle Faucet (USDC/EURC)</div><div style={{fontSize:11,opacity:0.8}}>faucet.circle.com</div></div><span style={{marginLeft:'auto'}}>→</span>
        </a>
        <a href='https://console.circle.com/faucet' target='_blank' rel='noreferrer' style={{display:'flex',alignItems:'center',gap:10,background:'rgba(245,158,11,0.1)',border:'1px solid rgba(245,158,11,0.3)',borderRadius:12,padding:'12px 14px',color:'#f59e0b',textDecoration:'none',fontSize:13}}>
          <span style={{fontSize:20}}>⛽</span><div><div style={{fontWeight:600}}>Console Faucet (Native Gas)</div><div style={{fontSize:11,opacity:0.8}}>Gunakan Wallet ID</div></div><span style={{marginLeft:'auto'}}>→</span>
        </a>
      </div>
    </div>
  )
}
`.trim())

// ── OnboardingPanel.tsx ──
fs.writeFileSync('src/components/OnboardingPanel.tsx', `
interface Props { circleWallet:{id:string;address:string}|null; onRefresh:()=>void }
export function OnboardingPanel({ circleWallet, onRefresh }: Props) {
  return (
    <div className='glass' style={{borderRadius:20,padding:24}}>
      <div style={{textAlign:'center',marginBottom:20}}>
        <div style={{fontSize:48,marginBottom:8}}>💰</div>
        <h2 style={{color:'#e2e8f0',fontWeight:'bold',fontSize:18,marginBottom:4}}>Fund Circle Wallet Kamu</h2>
        <p style={{color:'#64748b',fontSize:13}}>Transfer USDC ke alamat Circle Wallet untuk mulai trading</p>
      </div>
      {circleWallet&&(
        <div>
          <div style={{background:'rgba(99,102,241,0.1)',border:'1px solid rgba(99,102,241,0.3)',borderRadius:12,padding:14,marginBottom:14}}>
            <div style={{color:'#64748b',fontSize:11,marginBottom:6}}>Circle Wallet Address (Arc Testnet)</div>
            <div style={{color:'#818cf8',fontFamily:'monospace',fontSize:12,wordBreak:'break-all',fontWeight:600,marginBottom:10}}>{circleWallet.address}</div>
            <button onClick={()=>navigator.clipboard.writeText(circleWallet.address)} style={{width:'100%',background:'rgba(99,102,241,0.2)',color:'#818cf8',border:'1px solid rgba(99,102,241,0.3)',padding:'8px',borderRadius:8,cursor:'pointer',fontSize:12}}>📋 Salin Alamat</button>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:14}}>
            <a href='https://faucet.circle.com/' target='_blank' rel='noreferrer' style={{display:'flex',alignItems:'center',gap:10,background:'rgba(16,185,129,0.1)',border:'1px solid rgba(16,185,129,0.3)',borderRadius:10,padding:'10px 14px',color:'#10b981',textDecoration:'none',fontSize:13}}>
              <span style={{fontSize:20}}>🚰</span><div><div style={{fontWeight:600}}>Circle Faucet</div><div style={{fontSize:11,opacity:0.8}}>Pilih ARC Testnet → USDC</div></div><span style={{marginLeft:'auto'}}>→</span>
            </a>
          </div>
          <button onClick={onRefresh} style={{width:'100%',background:'#4f46e5',color:'white',border:'none',padding:'12px',borderRadius:12,cursor:'pointer',fontWeight:600,fontSize:14}}>✓ Sudah Transfer, Cek Balance</button>
        </div>
      )}
    </div>
  )
}
`.trim())

// ── App.tsx ──
fs.writeFileSync('src/App.tsx', `
import { useState, useEffect } from 'react'
import { WalletButton } from './components/WalletButton'
import { SwapPanel } from './components/SwapPanel'
import { BridgePanel } from './components/BridgePanel'
import { SendPanel } from './components/SendPanel'
import { InfoPanel } from './components/InfoPanel'
import { OnboardingPanel } from './components/OnboardingPanel'
const API = 'https://43.163.98.128.nip.io'
const TABS = [{ id:'swap', label:'Swap', icon:'⇄' },{ id:'bridge', label:'Bridge', icon:'⛓' },{ id:'send', label:'Send', icon:'→' },{ id:'info', label:'Info', icon:'ℹ' }]
const EMPTY_BAL = { USDC:'0', EURC:'0', USYC:'0' }
export default function App() {
  const [tab, setTab] = useState('swap')
  const [address, setAddress] = useState<string|null>(null)
  const [circleWallet, setCircleWallet] = useState<{id:string;address:string}|null>(null)
  const [balances, setBalances] = useState<Record<string,string>>({...EMPTY_BAL})
  const [eoaBalances, setEoaBalances] = useState<Record<string,string>>({...EMPTY_BAL})
  const [loadingWallet, setLoadingWallet] = useState(false)
  const fetchCircleBal = async (addr:string) => {
    try {
      const r = await fetch(\`\${API}/api/balance/\${addr}\`)
      if (r.ok) setBalances(await r.json())
    } catch {}
  }
  const fetchEoaBal = async (addr:string) => {
    try {
      const { createPublicClient, http, erc20Abi, formatUnits, defineChain } = await import('viem')
      const arc = defineChain({ id:5042002, name:'Arc Testnet', nativeCurrency:{name:'USDC',symbol:'USDC',decimals:6}, rpcUrls:{default:{http:['https://rpc.testnet.arc.network/']}} })
      const client = createPublicClient({ chain:arc, transport:http() })
      const USDC = '0x3600000000000000000000000000000000000000' as \`0x\${string}\`
      const EURC = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as \`0x\${string}\`
      const [u,e] = await Promise.all([
        client.readContract({ address:USDC, abi:erc20Abi, functionName:'balanceOf', args:[addr as \`0x\${string}\`] }),
        client.readContract({ address:EURC, abi:erc20Abi, functionName:'balanceOf', args:[addr as \`0x\${string}\`] }).catch(()=>0n),
      ])
      setEoaBalances({ USDC:formatUnits(u as bigint,6), EURC:formatUnits(e as bigint,6), USYC:'0' })
    } catch {}
  }
  const refresh = () => { if(circleWallet?.address) fetchCircleBal(circleWallet.address); if(address) fetchEoaBal(address) }
  const handleConnect = async (addr:string) => {
    setAddress(addr); fetchEoaBal(addr); setLoadingWallet(true)
    for (let i=0;i<3;i++) {
      try {
        const r = await fetch(\`\${API}/api/wallet\`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({metamaskAddress:addr}) })
        if (!r.ok) { await new Promise(x=>setTimeout(x,2000)); continue }
        const d = await r.json()
        if (d.success) { setCircleWallet(d.wallet); fetchCircleBal(d.wallet.address); break }
      } catch { await new Promise(x=>setTimeout(x,2000)) }
    }
    setLoadingWallet(false)
  }
  const handleDisconnect = () => { setAddress(null); setCircleWallet(null); setBalances({...EMPTY_BAL}); setEoaBalances({...EMPTY_BAL}) }
  useEffect(() => {
    if (circleWallet?.address) {
      const iv = setInterval(refresh, 15000)
      return () => clearInterval(iv)
    }
  }, [circleWallet, address])
  const hasBalance = parseFloat(balances.USDC||'0')>0 || parseFloat(balances.EURC||'0')>0
  return (
    <div style={{minHeight:'100vh',background:'#0a0a0f'}}>
      <header className='glass' style={{position:'sticky',top:0,zIndex:50,borderBottom:'1px solid #1e1e2e'}}>
        <div style={{maxWidth:1024,margin:'0 auto',padding:'14px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{width:30,height:30,background:'#4f46e5',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontWeight:'bold',fontSize:13}}>A</div>
            <span style={{fontWeight:'bold',color:'#e2e8f0',fontSize:16}}>Arc DEX</span>
            <span style={{fontSize:11,background:'rgba(99,102,241,0.2)',color:'#818cf8',padding:'2px 8px',borderRadius:100,border:'1px solid rgba(99,102,241,0.3)'}}>Testnet</span>
          </div>
          <WalletButton address={address} onConnect={handleConnect} onDisconnect={handleDisconnect} />
        </div>
        {address && circleWallet && (
          <div style={{maxWidth:1024,margin:'0 auto',padding:'0 20px 10px',display:'flex',gap:6,flexWrap:'wrap'}}>
            <div className='glass' style={{padding:'4px 10px',borderRadius:8,fontSize:11}}><span style={{color:'#64748b'}}>MetaMask: </span><span style={{color:'#f59e0b',fontFamily:'monospace'}}>{address.slice(0,6)}...{address.slice(-4)}</span></div>
            <div className='glass' style={{padding:'4px 10px',borderRadius:8,fontSize:11}}><span style={{color:'#64748b'}}>Circle: </span><span style={{color:'#818cf8',fontFamily:'monospace'}}>{circleWallet.address.slice(0,6)}...{circleWallet.address.slice(-4)}</span></div>
            {parseFloat(balances.USDC||'0')>0&&<div className='glass' style={{padding:'4px 10px',borderRadius:8,fontSize:11}}><span style={{color:'#64748b'}}>C-USDC: </span><span style={{color:'#e2e8f0',fontWeight:600}}>{parseFloat(balances.USDC).toFixed(4)}</span></div>}
            {parseFloat(eoaBalances.USDC||'0')>0&&<div className='glass' style={{padding:'4px 10px',borderRadius:8,fontSize:11}}><span style={{color:'#64748b'}}>E-USDC: </span><span style={{color:'#e2e8f0',fontWeight:600}}>{parseFloat(eoaBalances.USDC).toFixed(4)}</span></div>}
            {parseFloat(balances.EURC||'0')>0&&<div className='glass' style={{padding:'4px 10px',borderRadius:8,fontSize:11}}><span style={{color:'#64748b'}}>EURC: </span><span style={{color:'#e2e8f0',fontWeight:600}}>{parseFloat(balances.EURC).toFixed(4)}</span></div>}
          </div>
        )}
      </header>
      <div style={{textAlign:'center',padding:'28px 16px 20px'}}>
        <h1 style={{fontSize:28,fontWeight:'bold',color:'#e2e8f0',marginBottom:8}}>Swap, Bridge & Earn on <span style={{color:'#818cf8'}}>Arc</span></h1>
        <p style={{color:'#64748b',fontSize:13}}>Powered by Circle App Kit · CCTP v2 · USDC-native</p>
      </div>
      <div style={{maxWidth:480,margin:'0 auto',padding:'0 16px 64px'}}>
        {!address ? (
          <div className='glass' style={{borderRadius:20,padding:32,textAlign:'center'}}>
            <div style={{fontSize:48,marginBottom:16}}>👋</div>
            <h2 style={{color:'#e2e8f0',fontWeight:'bold',marginBottom:8}}>Selamat Datang di Arc DEX</h2>
            <p style={{color:'#64748b',fontSize:13,marginBottom:20}}>Connect wallet MetaMask untuk mulai. Circle Wallet akan otomatis dibuat.</p>
            {[['1','Connect MetaMask','Klik Connect Wallet di atas'],['2','Circle Wallet dibuat','Otomatis, tidak perlu setup'],['3','Fund wallet','Transfer USDC ke Circle Wallet'],['4','Mulai trading!','Swap, Bridge, Send USDC']].map(([n,t,d])=>(
              <div key={n} style={{display:'flex',gap:10,alignItems:'flex-start',marginBottom:12,textAlign:'left'}}>
                <div style={{width:26,height:26,borderRadius:'50%',background:'rgba(99,102,241,0.2)',border:'1px solid rgba(99,102,241,0.4)',display:'flex',alignItems:'center',justifyContent:'center',color:'#818cf8',fontWeight:'bold',fontSize:12,flexShrink:0}}>{n}</div>
                <div><div style={{color:'#e2e8f0',fontWeight:600,fontSize:13}}>{t}</div><div style={{color:'#64748b',fontSize:12}}>{d}</div></div>
              </div>
            ))}
          </div>
        ) : loadingWallet ? (
          <div className='glass' style={{borderRadius:20,padding:32,textAlign:'center'}}>
            <div style={{fontSize:32,marginBottom:12}}>⚙️</div>
            <p style={{color:'#818cf8',fontWeight:600}}>Menyiapkan Circle Wallet...</p>
            <p style={{color:'#64748b',fontSize:13,marginTop:8}}>Hanya sekali saat pertama kali connect</p>
          </div>
        ) : !hasBalance ? (
          <OnboardingPanel circleWallet={circleWallet} onRefresh={()=>circleWallet&&fetchCircleBal(circleWallet.address)} />
        ) : (
          <div className='glass' style={{borderRadius:20,overflow:'hidden'}}>
            <div style={{display:'flex',borderBottom:'1px solid #1e1e2e'}}>
              {TABS.map(t=>(
                <button key={t.id} onClick={()=>setTab(t.id)} style={{flex:1,padding:'12px 0',fontSize:12,fontWeight:600,border:'none',cursor:'pointer',background:tab===t.id?'rgba(99,102,241,0.05)':'transparent',color:tab===t.id?'#818cf8':'#64748b',borderBottom:tab===t.id?'2px solid #6366f1':'2px solid transparent'}}>
                  <span style={{marginRight:4}}>{t.icon}</span>{t.label}
                </button>
              ))}
            </div>
            <div style={{padding:20}}>
              {tab==='swap'&&<SwapPanel address={address} circleWallet={circleWallet} balances={balances} onRefresh={refresh} />}
              {tab==='bridge'&&<BridgePanel address={address} circleWallet={circleWallet} balances={balances} eoaBalances={eoaBalances} onRefresh={refresh} />}
              {tab==='send'&&<SendPanel address={address} circleWallet={circleWallet} balances={balances} eoaBalances={eoaBalances} onRefresh={refresh} />}
              {tab==='info'&&<InfoPanel address={address} circleWallet={circleWallet} balances={balances} eoaBalances={eoaBalances} onRefresh={refresh} />}
            </div>
          </div>
        )}
        <p style={{textAlign:'center',fontSize:11,color:'#64748b',marginTop:16}}>Powered by <a href='https://arc.network' style={{color:'#818cf8'}}>Arc Network</a> & <a href='https://developers.circle.com' style={{color:'#818cf8'}}>Circle App Kit</a></p>
      </div>
    </div>
  )
}
`.trim())

console.log('All files generated!')
