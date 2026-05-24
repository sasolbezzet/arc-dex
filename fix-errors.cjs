const fs = require('fs');
let bridge = fs.readFileSync('src/components/BridgePanel.tsx', 'utf-8');

// Fix 1: Ganti semua Buffer dengan Web API equivalents
// Buffer.from hex → Uint8Array
bridge = bridge.replace(
  /const msgBytes = Buffer\.from\(att\.message\.startsWith\('0x'\) \? att\.message\.slice\(2\) : att\.message, 'hex'\)/g,
  `const hexToBytes = (hex: string) => { const h = hex.startsWith('0x') ? hex.slice(2) : hex; const arr = new Uint8Array(h.length/2); for(let i=0;i<arr.length;i++) arr[i]=parseInt(h.slice(i*2,i*2+2),16); return arr; }
      const msgBytes = hexToBytes(att.message)`
);
bridge = bridge.replace(
  /const attBytes = Buffer\.from\(attestation\.startsWith\('0x'\) \? attestation\.slice\(2\) : attestation, 'hex'\)/g,
  `const attBytes = hexToBytes(att.attestation)`
);

// Fix 2: Ganti Buffer.concat, Buffer.alloc dengan Uint8Array
bridge = bridge.replace(
  /const msgLenBuf = Buffer\.alloc\(4\); msgLenBuf\.writeUInt32LE\(msgBytes\.length\)/g,
  `const msgLenBuf = new Uint8Array(4); new DataView(msgLenBuf.buffer).setUint32(0, msgBytes.length, true)`
);
bridge = bridge.replace(
  /const attLenBuf = Buffer\.alloc\(4\); attLenBuf\.writeUInt32LE\(attBytes\.length\)/g,
  `const attLenBuf = new Uint8Array(4); new DataView(attLenBuf.buffer).setUint32(0, attBytes.length, true)`
);
bridge = bridge.replace(
  /const data = Buffer\.concat\(\[discriminator, msgLenBuf, msgBytes, attLenBuf, attBytes\]\)/g,
  `const concatArrays = (...arrays: Uint8Array[]) => { const total = arrays.reduce((s,a)=>s+a.length,0); const out = new Uint8Array(total); let offset=0; arrays.forEach(a=>{out.set(a,offset);offset+=a.length}); return out; }
      const data = concatArrays(discriminator, msgLenBuf, msgBytes, attLenBuf, attBytes)`
);

// Fix discriminator lines (Buffer.from hex string)
bridge = bridge.replace(
  /const discriminator = Buffer\.from\(\[216, 249, 210, 149, 228, 210, 244, 218\]\)/g,
  `const discriminator = new Uint8Array([216, 249, 210, 149, 228, 210, 244, 218])`
);
bridge = bridge.replace(
  /const discriminator = Buffer\.from\(\[210, 114, 249, 160, 192, 146, 195, 101\]\)/g,
  `const discriminator = new Uint8Array([210, 114, 249, 160, 192, 146, 195, 101])`
);

// Fix mintRecipient Buffer untuk Solana
bridge = bridge.replace(
  `const mintRecipientBytes = Buffer.alloc(32)
      Buffer.from(evmAddr.toLowerCase().padStart(64,'0').slice(0,64), 'hex').copy(mintRecipientBytes)`,
  `const mintRecipientBytes = new Uint8Array(32)
      const evmHex = evmAddr.toLowerCase().padStart(64,'0').slice(0,64)
      for(let i=0;i<32;i++) mintRecipientBytes[i] = parseInt(evmHex.slice(i*2,i*2+2),16)`
);

// Fix Buffer.alloc(4) untuk domain
bridge = bridge.replace(
  `const destDomainBuf = Buffer.alloc(4)
    destDomainBuf.writeUInt32LE(26)`,
  `const destDomainBuf = new Uint8Array(4); new DataView(destDomainBuf.buffer).setUint32(0, 26, true)`
);
bridge = bridge.replace(
  /const destCallerBuf = Buffer\.alloc\(32\) \/\/ zero = any/g,
  `const destCallerBuf = new Uint8Array(32)`
);

// Fix amount buffer
bridge = bridge.replace(
  `const amountBuf = Buffer.alloc(8)
    amountBuf.writeBigUInt64LE(amountLamports)`,
  `const amountBuf = new Uint8Array(8); new DataView(amountBuf.buffer).setBigUint64(0, amountLamports, true)`
);

// Fix Buffer.from text strings
bridge = bridge.replace(
  /PublicKey\.findProgramAddressSync\(\s*\[Buffer\.from\('([^']+)'\)/g,
  `PublicKey.findProgramAddressSync([new TextEncoder().encode('$1')`
);

// Fix concat arrays untuk burnSolana data
bridge = bridge.replace(
  `const data = Buffer.concat([discriminator, amountBuf, destDomainBuf, mintRecipientBytes, destCallerBuf])`,
  `const concatU8 = (...arrays: Uint8Array[]) => { const total = arrays.reduce((s,a)=>s+a.length,0); const out = new Uint8Array(total); let offset=0; arrays.forEach(a=>{out.set(a,offset);offset+=a.length}); return out; }
    const data = concatU8(discriminator, amountBuf, destDomainBuf, mintRecipientBytes, destCallerBuf)`
);

fs.writeFileSync('src/components/BridgePanel.tsx', bridge);
console.log('Buffer fixes applied');
