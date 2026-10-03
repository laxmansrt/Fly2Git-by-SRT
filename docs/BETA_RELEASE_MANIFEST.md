# Fly2Git — Beta Release Manifest (v1.1.6-rc.1)

This manifest provides a comprehensive audit of all files in the Fly2Git repository, categorizing each file by its purpose and declaring whether it is **INCLUDED** in the shipped Chrome Extension package or **EXCLUDED** (retained strictly on backend servers, CI/CD, or local development environments).

---

## 1. Extension Distribution Package Boundaries

The extension package shipped to beta testers through Chrome Web Store or developer unpacked loading MUST NOT contain backend services, developer secrets, test files, scratch data, or documentation.

| Path | Purpose | Status |
|------|---------|--------|
| `manifest.json` | Manifest V3 Extension Configuration | **INCLUDED** |
| `background.js` | Service Worker (GitHub Sync, Auth, Alarms) | **INCLUDED** |
| `version.js` | Frozen Release Candidate Version Definition | **INCLUDED** |
| `diagnostics.js` | Safe Scrubbed Diagnostics Generator | **INCLUDED** |
| `sync-notification.js` | Liquid Glass In-Page Sync Toast Notifications | **INCLUDED** |
| `platforms.js` | Platform Detection & Route Configurations | **INCLUDED** |
| `popup.html` | Extension Action Popup UI | **INCLUDED** |
| `popup.js` | Extension Popup Controller & Views | **INCLUDED** |
| `popup.css` | Obsidian / Midnight Titanium Styling | **INCLUDED** |
| `design-tokens.css` | Shared Design Tokens & Theme Variables | **INCLUDED** |
| `content.js` | LeetCode Content Script | **INCLUDED** |
| `inject.js` | LeetCode Page Main-World Interceptor | **INCLUDED** |
| `gfg-content.js` | GeeksforGeeks Content Script | **INCLUDED** |
| `gfg-inject.js` | GeeksforGeeks Page Interceptor | **INCLUDED** |
| `hackerrank-content.js` | HackerRank Content Script | **INCLUDED** |
| `hackerrank-inject.js` | HackerRank Page Interceptor | **INCLUDED** |
| `codechef-content.js` | CodeChef Content Script | **INCLUDED** |
| `codechef-inject.js` | CodeChef Page Interceptor | **INCLUDED** |
| `atcoder-content.js` | AtCoder Content Script | **INCLUDED** |
| `atcoder-inject.js` | AtCoder Page Interceptor | **INCLUDED** |
| `codeforces-content.js` | Codeforces Content Script | **INCLUDED** |
| `codeforces-inject.js` | Codeforces Page Interceptor | **INCLUDED** |
| `spoj-content.js` | SPOJ Content Script | **INCLUDED** |
| `spoj-inject.js` | SPOJ Page Interceptor | **INCLUDED** |
| `icons/*` | Extension Action & Web Store Icons (16, 32, 48, 128) | **INCLUDED** |
| `assets/*` | Extension Platform SVGs and UI Assets | **INCLUDED** |

---

## 2. Excluded Server & Backend Infrastructure

All backend infrastructure runs on server-side runtime environments and is strictly excluded from extension releases:

| Path | Purpose | Status |
|------|---------|--------|
| `backend/server.js` | Express API Gateway & Route Controllers | **EXCLUDED** |
| `backend/config.js` | Backend Central Config & Secret Management | **EXCLUDED** |
| `backend/db/*` | JSON File-Based / SQLite Database & Migrations | **EXCLUDED** |
| `backend/services/*` | Business Logic, Telemetry, Cohorts, AI Services | **EXCLUDED** |
| `backend/providers/*` | Gemini AI, Stripe Billing, GitHub App Providers | **EXCLUDED** |
| `backend/ai/*` | Prompts, Validators & AI Governance Logic | **EXCLUDED** |
| `backend/data/*` | Local development database store | **EXCLUDED** |

---

## 3. Excluded Developer Tooling, Tests & Documentation

Developer tooling, test suites, and internal documentation are never packaged into client distributions:

| Path | Purpose | Status |
|------|---------|--------|
| `test_*.js` (All 30 suites) | Automated Regression & Verification Tests | **EXCLUDED** |
| `docs/*` | Operational Guides, Protocols & Findings | **EXCLUDED** |
| `AUDIT.md` | Security and Architecture Audit Reports | **EXCLUDED** |
| `README.md` | Repository Documentation | **EXCLUDED** |
| `.git/`, `.gitignore` | Version Control Metadata | **EXCLUDED** |
| `scratch/` | Temporary Developer Scratch Files | **EXCLUDED** |
| `.gemini/` | IDE & AI Agent Workspace Artifacts | **EXCLUDED** |

---

## 4. Package Integrity Verification

- Total Client Package Size: < 2.5 MB (unpacked)
- Permissions: Minimum required (`storage`, `alarms`)
- Secrets present: **0** (strictly zero development keys, mock tokens, or AI provider credentials in client bundle)
