import { useState } from 'react'

export const TOKEN_META: Record<string,{name:string;color:string;mark:string}> = {
  USDC: { name:'USD Coin', color:'#2775ca', mark:'$' },
  EURC: { name:'Euro Coin', color:'#2348ff', mark:'€' },
  USYC: { name:'Yield Coin', color:'#10b981', mark:'Y' },
  cirBTC: { name:'Circle BTC', color:'#f7931a', mark:'₿' },
}

const CHAIN_META: Record<string,{short:string;color:string;mark:string}> = {
  Arc_Testnet: { short:'Arc', color:'#6366f1', mark:'A' },
  Ethereum_Sepolia: { short:'Ethereum', color:'#627eea', mark:'Ξ' },
  Base_Sepolia: { short:'Base', color:'#0052ff', mark:'B' },
  Arbitrum_Sepolia: { short:'Arbitrum', color:'#28a0f0', mark:'A' },
  Solana_Devnet: { short:'Solana', color:'#14f195', mark:'S' },
}

function CircleMark({ color, mark, size }: { color:string; mark:string; size:number }) {
  return (
    <span style={{width:size,height:size,borderRadius:'50%',background:color,display:'inline-flex',alignItems:'center',justifyContent:'center',color:'white',fontWeight:800,fontSize:size*0.56,lineHeight:1,boxShadow:'inset 0 0 0 2px rgba(255,255,255,0.22)',flexShrink:0}}>
      {mark}
    </span>
  )
}

export function TokenLogo({ token, size = 18 }: { token:string; size?:number }) {
  const meta = TOKEN_META[token] || { color:'#64748b', mark:token.slice(0,1), name:token }
  return <CircleMark color={meta.color} mark={meta.mark} size={size} />
}

function ChainLogo({ chain, size = 18 }: { chain:string; size?:number }) {
  const meta = CHAIN_META[chain] || { color:'#64748b', mark:chain.slice(0,1), short:chain }
  return <CircleMark color={meta.color} mark={meta.mark} size={size} />
}

export function CompactTokenPicker({ value, options, onChange, width = 96 }: { value:string; options:string[]; onChange:(token:string)=>void; width?:number }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{position:'relative',width,flexShrink:0}}>
      <button type='button' onClick={()=>setOpen(v=>!v)} className='input' style={{height:34,width:'100%',padding:'0 7px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:5,cursor:'pointer',fontSize:12}}>
        <span style={{display:'flex',alignItems:'center',gap:6,minWidth:0}}>
          <TokenLogo token={value} size={18} />
          <span style={{fontWeight:700,fontSize:11,whiteSpace:'nowrap'}}>{value}</span>
        </span>
        <span style={{color:'#64748b',fontSize:9}}>⌄</span>
      </button>
      {open && (
        <div className='glass' style={{position:'absolute',right:0,top:38,zIndex:30,width:128,borderRadius:8,border:'1px solid #1e1e2e',padding:4,boxShadow:'0 12px 28px rgba(0,0,0,0.32)'}}>
          {options.map(t=>(
            <button key={t} type='button' onClick={()=>{onChange(t);setOpen(false)}} style={{width:'100%',display:'flex',alignItems:'center',gap:7,padding:'7px 8px',borderRadius:7,border:'none',background:t===value?'rgba(99,102,241,0.16)':'transparent',color:'#e2e8f0',cursor:'pointer',textAlign:'left'}}>
              <TokenLogo token={t} size={20} />
              <span style={{display:'flex',flexDirection:'column',lineHeight:1.1}}>
                <span style={{fontSize:11,fontWeight:700}}>{t}</span>
                <span style={{fontSize:9,color:'#64748b'}}>{TOKEN_META[t]?.name}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function CompactChainPicker({ value, options, onChange }: { value:string; options:Array<{id:string;label:string}>; onChange:(chain:string)=>void }) {
  const [open, setOpen] = useState(false)
  const selected = options.find(c=>c.id===value)
  const meta = CHAIN_META[value] || { short:selected?.label || value, color:'#64748b', mark:value.slice(0,1) }
  return (
    <div style={{position:'relative',width:'100%'}}>
      <button type='button' onClick={()=>setOpen(v=>!v)} className='input' style={{height:36,width:'100%',padding:'0 9px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,cursor:'pointer'}}>
        <span style={{display:'flex',alignItems:'center',gap:7,minWidth:0}}>
          <ChainLogo chain={value} size={19} />
          <span style={{fontWeight:700,fontSize:12,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{meta.short}</span>
        </span>
        <span style={{color:'#64748b',fontSize:10}}>⌄</span>
      </button>
      {open && (
        <div className='glass' style={{position:'absolute',left:0,right:0,top:40,zIndex:30,borderRadius:8,border:'1px solid #1e1e2e',padding:4,boxShadow:'0 12px 28px rgba(0,0,0,0.32)'}}>
          {options.map(c=>(
            <button key={c.id} type='button' onClick={()=>{onChange(c.id);setOpen(false)}} style={{width:'100%',display:'flex',alignItems:'center',gap:8,padding:'7px 9px',borderRadius:7,border:'none',background:c.id===value?'rgba(99,102,241,0.16)':'transparent',color:'#e2e8f0',cursor:'pointer',textAlign:'left'}}>
              <ChainLogo chain={c.id} size={20} />
              <span style={{fontSize:12,fontWeight:650,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
