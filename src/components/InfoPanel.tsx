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
          <a href={`${EXPLORER}/address/${circleWallet.address}`} target='_blank' rel='noreferrer' style={{display:'block',marginTop:8,background:'rgba(16,185,129,0.1)',color:'#10b981',border:'1px solid rgba(16,185,129,0.3)',padding:'6px 0',borderRadius:8,fontSize:12,textDecoration:'none',textAlign:'center'}}>🔍 Lihat di Explorer</a>
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