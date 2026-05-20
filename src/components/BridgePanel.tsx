import { useState } from 'react'
import { BridgeChain } from '@circle-fin/app-kit'
declare global { interface Window { ethereum?: any } }
const API = 'https://43.163.98.128.nip.io'
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
export function BridgePanel({ address, circleWallet: _circleWallet, balances, eoaBalances, onRefresh }: Props) {
  // Use _circleWallet to avoid unused variable warning
  void _circleWallet
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
        setStatus({ type:'info', msg:'✓ USDC tiba di MetaMask!\n⏳ Siapkan MetaMask untuk approve...', steps:[...localSteps] })
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
      localSteps[localSteps.length-1].explorerUrl=fromChain==='Arc_Testnet'?`https://testnet.arcscan.app/tx/${approveTx}`:`https://sepolia.etherscan.io/tx/${approveTx}`
      setStatus({ type:'info', msg:'✓ Approve sukses!\n⏳ MetaMask popup 2/2: Konfirmasi burn...', steps:[...localSteps] })
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
      localSteps[localSteps.length-1].explorerUrl=fromChain==='Arc_Testnet'?`https://testnet.arcscan.app/tx/${burnTx}`:`https://sepolia.etherscan.io/tx/${burnTx}`
      // Mint via backend
      setStep('Step 3/3: Menunggu attestation Circle (~20 detik)...')
      localSteps.push({ name:'attestation', state:'pending' })
      setStatus({ type:'info', msg:'✓ Burn sukses!\n⏳ Menunggu attestation dari Circle...', steps:[...localSteps] })
      const mintResp = await fetch(API+'/api/mint-cctp', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({burnTxHash:burnTx,fromChain,toChain,toAddress:address}) })
      const mintData = await mintResp.json()
      if (!mintResp.ok || !mintData.success) throw new Error(mintData.error||'Mint gagal')
      localSteps[localSteps.length-1].state='success'
      localSteps.push({ name:'mint', state:'success', txHash:mintData.txHash, explorerUrl:mintData.explorerUrl })
      setStatus({ type:'success', msg:`✓ Bridge berhasil! ${amount} USDC → ${toChain}`, steps:[...localSteps] })
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
        {loading?step||'⏳ Memproses...':amount?`Bridge ${amount} USDC`:'Bridge USDC'}
      </button>
      <div style={{fontSize:11,color:'#64748b',textAlign:'center'}}>Bridge via CCTP v2. MetaMask popup 2x untuk konfirmasi.</div>
    </div>
  )
}