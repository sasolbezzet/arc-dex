# ARC DEX Security & Code Audit Report

**Project:** ARCOX DEX Web UI, API, and MCP Agent
**Auditor:** Codebuff AI Audit
**Date:** June 4, 2026
**Scope:** `src/`, `arcox-agent/`, `arcox-agent/solana-router/`
**Status:** 🔴 **CRITICAL ISSUES FOUND** — immediate action required

---

## Executive Summary

This audit covers the ARCOX DEX frontend (React/Vite), its API integration layer, the terminal MCP agent, and the Solana router program. **7 critical and high-severity issues were identified**, including auth token expiration bugs, replay attacks, economic griefing vectors, and arbitrary file write paths. Several issues have practical exploitability in production.

### Severity Distribution

| Severity | Count | Exploitable? |
|----------|-------|-------------|
| 🔴 Critical | 4 | Yes (3 practical) |
| 🟠 High | 3 | Yes (2 practical) |
| 🟡 Medium | 5 | Partial |
| 🟢 Low | 4 | No / Hardening |

---

## Quick Reference

| File | Description |
|------|-------------|
| [`CRITICAL.md`](./CRITICAL.md) | Critical findings with full exploit vectors |
| [`HIGH.md`](./HIGH.md) | High-severity security & stability issues |
| [`MEDIUM.md`](./MEDIUM.md) | Medium-severity code quality & safety issues |
| [`LOW.md`](./LOW.md) | Low-severity suggestions and hardening |
| [`RECOMMENDATIONS.md`](./RECOMMENDATIONS.md) | Prioritized fix recommendations with code examples |

---

## Top 5 Immediate Actions Required

1. **Fix `readTokenExp` in `src/auth.ts`** — tokens never expire client-side, enabling permanent session hijacking.
2. **Add `nonce` to auth messages** — prevent replay attacks on `/api/auth/session`.
3. **Cap bridge fee retry multiplier** — `6n` retry without cap enables economic griefing.
4. **Sanitize `ARCOX_MCP_DEBUG`** — arbitrary file write via environment variable.
5. **Replace `parseFloat` + `Math.round` with `parseUnits`** — precision loss on `cirBTC` (8 decimals).

---

## Architecture Overview

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│  ARCOX DEX UI   │──────│  Backend API     │──────│  Circle / CCTP  │
│  (React + Vite) │      │  (Node/Express)  │      │  (Bridge/Swap)  │
└─────────────────┘      └──────────────────┘      └─────────────────┘
         │
         │ MetaMask / Solflare
         ▼
┌─────────────────┐      ┌──────────────────┐
│  MCP Agent CLI  │──────│  Solana Router   │
│  (Node + viem)  │      │  (Anchor/Rust)   │
└─────────────────┘      └──────────────────┘
```

---

## Disclaimer

This audit is based on static code analysis and does not include dynamic testing, penetration testing, or formal verification of smart contracts. It should be complemented with independent third-party audits before production deployment of value-at-risk systems.

---

*For detailed findings, navigate to the severity-specific files linked above.*
