# Fly2Git — Production Deployment & Infrastructure Checklist
============================================================

Release Candidate: `FLY2GIT_BETA_VERSION = 1.1.6-rc.1`
Extension: `1.1.6`
Backend API: `1.1.0`
Date: `2026-10-03`

---

## Production Readiness Matrix

| Component | Status | Verification & Evidence | Notes / Next Action |
|-----------|--------|-------------------------|---------------------|
| **Cloud Run** | `NOT TESTED` | Service not deployed. `run.googleapis.com` API disabled on active GCP project `ai-agent-491719`. | Deploy container image via Cloud Run once billing/API enabled. |
| **DNS** | `FAIL` | `curl -I https://api.fly2git.com/health` returns `curl: (6) Could not resolve host: api.fly2git.com`. | Add DNS A/CNAME record pointing to Cloud Run custom domain mapping. |
| **HTTPS** | `NOT TESTED` | DNS unresolvable; SSL certificate provisioning cannot complete until DNS points to GCP. | Managed Google certificate will auto-provision once DNS propagates. |
| **Secret Manager** | `NOT TESTED` | Production secrets (`GEMINI_API_KEY`, `ENTITLEMENT_SIGNING_SECRET`, etc.) not yet mapped in Secret Manager. | Provision secrets and bind IAM roles to Cloud Run service account. |
| **Gemini** | `NOT TESTED` | `GEMINI_API_KEY` is empty in environment; live Gemini smoke test skipped. | Configure key in Secret Manager and run smoke test with `RUN_AI_LIVE_TESTS=true`. |
| **Database** | `PARTIAL` | Atomic file-based/in-memory persistence verified; Cloud persistent volume/database pending. | Mount Cloud Storage volume or configure managed database for multi-instance persistence. |
| **GitHub** | `PARTIAL` | GitHub App (`Iv23livkIwLTCTML4cDN`) configured for Device Flow. End-to-end live testing pending. | Test live OAuth authorization on production domain. |
| **CORS** | `PASS` | Production mode forbids wildcard `*`; allows `chrome-extension://` and trusted `fly2gitOrigin`. | Verified in `backend/server.js` and automated tests. |
| **Extension** | `PASS` | Configured to `https://api.fly2git.com`. Zero `localhost` or development URLs in release files. | Verified via static audit and test suite. |
| **Telemetry** | `PASS` | Strict 12-event allowlist, user opt-out honored, zero code/prompts/credentials collected. | Verified in `ProductTelemetryService` tests. |
| **Billing** | `PARTIAL` | Stripe provider integration, signature verification, and webhook handlers verified in test suites. | Add production Stripe live keys upon commercial launch. |
| **Rollback** | `PASS` | Version negotiation rejects obsolete clients with HTTP 426 (`CLIENT_VERSION_UNSUPPORTED`). | Verified with `MIN_SUPPORTED_CLIENT_VERSION = 1.0.0`. |
| **Monitoring** | `PASS` | `/health` and `/api/health` endpoints operational; structured logs scrub credentials. | Verified via local smoke test runner. |

---

## Container Audit
- **Base Image**: `node:20-alpine` (Minimal, official security updates)
- **User**: Runs as non-root user `node`
- **Exposed Port**: `8080` (Standard Cloud Run port)
- **Exclusions**: Test files, scratch directories, logs, git metadata, and local data files excluded via `.dockerignore`.
- **Environment**: `NODE_ENV=production` set by default.

---

## Safe Health Endpoint Specification
- `GET /health` & `GET /api/health`
- Returns:
  ```json
  {
    "ok": true,
    "status": "healthy",
    "service": "fly2git-entitlements",
    "version": "1.1.6",
    "apiVersion": "1.1.0",
    "environment": "production",
    "uptime": 120,
    "keyId": "fly2git-ed25519-v1",
    "timestamp": "2026-10-03T09:30:00.000Z"
  }
  ```
- **Security**: Never exposes stack traces, database credentials, internal IPs, or secrets.

---

## Remaining Blockers to `BETA-READY` Status
1. **DNS Resolution**: `api.fly2git.com` must resolve to Google Cloud Run edge.
2. **Cloud Run Deployment**: Container image must be built and deployed.
3. **Secret Manager**: Production `GEMINI_API_KEY` must be provisioned.
