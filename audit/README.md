# ARC DEX Security & Code Audit Report

**Project:** ARCOX DEX Web UI, API, and MCP Agent
**Auditor:** Codebuff AI Audit
**Date:** June 14, 2026 (delta update to the June 4, 2026 report)
**Scope:** `src/`, `api/`, `arcox-agent/`, `arcox-agent/solana-router/`
**Status:** 🟠 **NEW HIGH-SEVERITY ISSUES** in `api/` (not previously audited). Prior findings still apply.

---

## Executive Summary

The ARCOX DEX stack now consists of three parts: a React/Vite frontend, a Vercel-hosted payments + webhooks API, and a Node-based MCP server that talks to two EVM Solidity routers and a Solana program. The June 4 audit covered the frontend and MCP server. **This delta covers the `api/` directory (which was not previously audited), the rewritten MCP server, and both Solidity routers.**

### Severity Distribution (cumulative)

| Severity | Prior | New (this report) | Total |
|----------|-------|-------------------|-------|
| 🔴 Critical | 4 | 3 | 7 |
| 🟠 High | 3 | 4 | 7 |
| 🟡 Medium | 5 | 7 | 12 |
| 🟢 Low | 4 | 6 | 10 |

### Top Immediate Actions (full list in section 7 of `API-AND-NEW-FINDINGS.md`)

1. **Replace the in-memory payment store** (`api/_arcox-pay-store.mjs`) — all payment state is lost on every Vercel cold start.
2. **Add auth to all `/api/payments/*` GET endpoints** — anyone can read payment records and trigger real NOWPayments invoices.
3. **Implement Circle webhook signature verification** — the current `verifyWebhook=true` branch returns 401 unconditionally, and `verifyWebhook=false` accepts unsigned events.
4. **Stop logging raw webhook bodies** (`api/webhooks/nowpayments.js`, `api/webhooks/circle.js`).
5. **Sign NOWPayments HMAC over the raw body** — the current `stableStringify` re-serialization will not match upstream signatures.

---

## Files in This Folder

| File | Description |
|------|-------------|
| [`API-AND-NEW-FINDINGS.md`](./API-AND-NEW-FINDINGS.md) | **This delta report** (June 14, 2026). Covers `api/`, rewritten `arcox-agent/mcp/server.mjs`, both Solidity routers, deployment scripts. |
| [`CRITICAL.md`](./CRITICAL.md) | Critical findings from the June 4, 2026 audit (still valid). |
| [`HIGH.md`](./HIGH.md) | High-severity findings from the June 4, 2026 audit (still valid; H-003 is now mitigated — see delta). |
| [`MEDIUM.md`](./MEDIUM.md) | Medium-severity findings from the June 4, 2026 audit (still valid). |
| [`LOW.md`](./LOW.md) | Low-severity findings from the June 4, 2026 audit (still valid). |
| [`RECOMMENDATIONS.md`](./RECOMMENDATIONS.md) | Copy-paste-ready fixes for the June 4 findings. Combine with the new fixes in `API-AND-NEW-FINDINGS.md` section 7. |

---

## Architecture Overview

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│  ARCOX DEX UI   │──────│  Vercel /api/*   │──────│  NOWPayments    │
│  (React + Vite) │      │  (Node serverless)│      │  (Payments/IPN) │
└─────────────────┘      └──────────────────┘      └─────────────────┘
         │                         │
         │ MetaMask / Solflare     ▼
         │              ┌──────────────────┐      ┌─────────────────┐
         │              │ Backend at       │──────│ Circle / CCTP   │
         │              │ 43.163.98.128    │      │ (Bridge/Swap)   │
         │              │ (out of repo)    │      │                 │
         │              └──────────────────┘      └─────────────────┘
         │
         ▼
┌─────────────────┐      ┌──────────────────┐
│  MCP Agent CLI  │──────│  Solana Router   │
│  (Node + viem)  │      │  (Anchor/Rust)   │
└─────────────────┘      └──────────────────┘
         │                         │
         ▼                         ▼
   ArcoxRouter.sol    ArcoxNativeSwapBridgeRouter.sol
   (Solidity, EVM)    (Solidity, EVM)
```

The blocks in **bold** are new in this delta report (Vercel /api/*, ArcoxNativeSwapBridgeRouter.sol, and the backend at `43.163.98.128.nip.io` is **out of scope** of the repo).

---

## Disclaimer

This audit is based on static code analysis only. It does not include dynamic testing, penetration testing, or formal verification of smart contracts. It should be complemented with independent third-party audits before production deployment of value-at-risk systems. The backend at `https://43.163.98.128.nip.io` is **not in this repository** and was not audited.

*For the complete picture, read all six documents: `CRITICAL.md`, `HIGH.md`, `MEDIUM.md`, `LOW.md`, `RECOMMENDATIONS.md`, and `API-AND-NEW-FINDINGS.md`.*
