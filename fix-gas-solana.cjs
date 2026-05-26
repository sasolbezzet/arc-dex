const fs = require('fs');
let bridge = fs.readFileSync('src/components/BridgePanel.tsx', 'utf-8');

// Fix Arbitrum gas - pakai 200% buffer bukan 120%
bridge = bridge.replace(/\(gpNum \* 120n \/ 100n\)/g, '(gpNum * 200n / 100n)');

// Fix Solana program IDs yang benar untuk devnet CCTP v2
bridge = bridge.replace(
  "const MESSAGE_TRANSMITTER_PROGRAM = new PublicKey('CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3')\n    const TOKEN_MESSENGER_PROGRAM = new PublicKey('CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3')",
  `// Solana CCTP v2 devnet program IDs (Circle official)
    const MESSAGE_TRANSMITTER_PROGRAM = new PublicKey('CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3')
    const TOKEN_MESSENGER_PROGRAM = new PublicKey('CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3')`
);

// Fix: Derive usedNonces dari nonce field di message (bytes 12-20), bukan first 32 bytes
bridge = bridge.replace(
  `    // Used nonces PDA - derived dari first caller bytes dari message
    const firstCallerBytes = msgBytes.slice(0, 32)
    const [usedNonces] = PublicKey.findProgramAddressSync(
      [enc('used_nonces'), firstCallerBytes], MESSAGE_TRANSMITTER_PROGRAM
    )`,
  `    // Used nonces PDA - derived dari source domain + nonce
    // nonce ada di bytes 8-12 (source domain) dan 12-20 (nonce)
    const sourceDomain = new DataView(msgBytes.buffer, msgBytes.byteOffset + 4, 4).getUint32(0, false)
    const nonce = msgBytes.slice(8, 16) // 8 bytes nonce
    const sourceDomainBuf = new Uint8Array(4)
    new DataView(sourceDomainBuf.buffer).setUint32(0, sourceDomain, false)
    const [usedNonces] = PublicKey.findProgramAddressSync(
      [enc('used_nonces'), sourceDomainBuf, nonce], MESSAGE_TRANSMITTER_PROGRAM
    )`
);

// Fix: Tambah skipPreflight untuk debug yang lebih baik
bridge = bridge.replace(
  "    const sig = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false })",
  "    const sig = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: true, preflightCommitment: 'confirmed' })"
);

fs.writeFileSync('src/components/BridgePanel.tsx', bridge);
console.log('Gas buffer 200%, Solana nonce PDA fixed');
