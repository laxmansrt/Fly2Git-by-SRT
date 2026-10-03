# Fly2Git — Beta Manual Test Plan

## Purpose

Manual verification scenarios for the Fly2Git private beta pilot.
Each scenario documents expected behavior, actual result, and pass/fail status.

> [!IMPORTANT]
> Do NOT fabricate results. Mark "Actual Result" as **PENDING** until a real test is executed.

---

## Scenarios

### A. New User

| Field | Value |
|-------|-------|
| **Precondition** | User has never installed Fly2Git |
| **Steps** | 1. Install extension 2. Open popup 3. Observe welcome screen |
| **Expected** | Welcome message shown, GitHub connect button visible, no errors |
| **Actual Result** | PENDING |
| **Status** | ⬜ PENDING |
| **Notes** | — |

### B. Existing User

| Field | Value |
|-------|-------|
| **Precondition** | User has existing GitHub connection and synced solutions |
| **Steps** | 1. Update extension 2. Open popup 3. Verify session persists |
| **Expected** | Existing session restored, no re-auth required, synced count shown |
| **Actual Result** | PENDING |
| **Status** | ⬜ PENDING |
| **Notes** | — |

### C. GitHub Success

| Field | Value |
|-------|-------|
| **Precondition** | User clicks "Connect GitHub" |
| **Steps** | 1. Click Connect GitHub 2. Authorize via OAuth 3. Return to popup |
| **Expected** | GitHub connected indicator shown, repository selector available |
| **Actual Result** | PENDING |
| **Status** | ⬜ PENDING |
| **Notes** | — |

### D. GitHub Failure

| Field | Value |
|-------|-------|
| **Precondition** | GitHub OAuth endpoint unreachable or user denies access |
| **Steps** | 1. Click Connect GitHub 2. Simulate network failure or deny access |
| **Expected** | Clear error message: "Unable to connect. Try again." No crash. |
| **Actual Result** | PENDING |
| **Status** | ⬜ PENDING |
| **Notes** | — |

### E. First Sync

| Field | Value |
|-------|-------|
| **Precondition** | GitHub connected, platform selected, solution submitted |
| **Steps** | 1. Submit a solution on a coding platform 2. Observe sync |
| **Expected** | Sync notification shown, solution committed to GitHub, telemetry recorded |
| **Actual Result** | PENDING |
| **Status** | ⬜ PENDING |
| **Notes** | — |

### F. Duplicate Sync

| Field | Value |
|-------|-------|
| **Precondition** | Same solution has already been synced |
| **Steps** | 1. Re-submit same solution 2. Observe sync behavior |
| **Expected** | Sync detects duplicate, updates if code changed, skips if identical |
| **Actual Result** | PENDING |
| **Status** | ⬜ PENDING |
| **Notes** | — |

### G. Updated Solution

| Field | Value |
|-------|-------|
| **Precondition** | Solution exists in repo, user resubmits with different code |
| **Steps** | 1. Modify solution 2. Resubmit 3. Observe GitHub commit |
| **Expected** | GitHub file updated, commit message indicates update, analytics records isUpdate |
| **Actual Result** | PENDING |
| **Status** | ⬜ PENDING |
| **Notes** | — |

### H. Identity Mismatch

| Field | Value |
|-------|-------|
| **Precondition** | Platform username differs from GitHub-connected identity |
| **Steps** | 1. Log into a different platform account 2. Submit solution |
| **Expected** | Identity guard detects mismatch, blocks or warns, no silent data merge |
| **Actual Result** | PENDING |
| **Status** | ⬜ PENDING |
| **Notes** | — |

### I. AI Success

| Field | Value |
|-------|-------|
| **Precondition** | User authenticated, AI enabled, quota available |
| **Steps** | 1. Open AI panel 2. Click Analyze/Explain/Hint 3. Observe response |
| **Expected** | AI response displayed within ~5s, no source code in telemetry |
| **Actual Result** | PENDING |
| **Status** | ⬜ PENDING |
| **Notes** | — |

### J. AI Failure

| Field | Value |
|-------|-------|
| **Precondition** | AI backend unavailable or quota exhausted |
| **Steps** | 1. Trigger AI feature 2. Observe error state |
| **Expected** | User-friendly error: "AI unavailable. Try again later." Sync unaffected. |
| **Actual Result** | PENDING |
| **Status** | ⬜ PENDING |
| **Notes** | — |

### K. Analytics

| Field | Value |
|-------|-------|
| **Precondition** | User has synced at least 3 solutions |
| **Steps** | 1. Open Analytics view 2. Observe charts and data |
| **Expected** | Analytics display platform breakdown, language distribution, timeline |
| **Actual Result** | PENDING |
| **Status** | ⬜ PENDING |
| **Notes** | — |

### L. Coding Journey

| Field | Value |
|-------|-------|
| **Precondition** | User has synced solutions across multiple weeks |
| **Steps** | 1. Open Coding Journey view 2. Observe journey timeline |
| **Expected** | Journey shows weekly progression, pattern detection, exploration candidates |
| **Actual Result** | PENDING |
| **Status** | ⬜ PENDING |
| **Notes** | — |

### M. Notifications

| Field | Value |
|-------|-------|
| **Precondition** | User submits a solution that triggers sync |
| **Steps** | 1. Submit solution 2. Observe Liquid Glass notification |
| **Expected** | Sync notification appears, shows platform/status, auto-dismisses |
| **Actual Result** | PENDING |
| **Status** | ⬜ PENDING |
| **Notes** | — |

### N. Logout / Login

| Field | Value |
|-------|-------|
| **Precondition** | User is logged in |
| **Steps** | 1. Logout 2. Verify session cleared 3. Login again 4. Verify session restored |
| **Expected** | Clean logout, all session keys cleared, re-auth works without errors |
| **Actual Result** | PENDING |
| **Status** | ⬜ PENDING |
| **Notes** | — |

### O. Network Offline / Online

| Field | Value |
|-------|-------|
| **Precondition** | User is authenticated |
| **Steps** | 1. Disconnect network 2. Attempt sync 3. Reconnect 4. Retry sync |
| **Expected** | Graceful offline error, no crash, sync succeeds after reconnect |
| **Actual Result** | PENDING |
| **Status** | ⬜ PENDING |
| **Notes** | — |

### P. Basic User

| Field | Value |
|-------|-------|
| **Precondition** | User on Basic plan (2 platform slots) |
| **Steps** | 1. Attempt to add 3rd platform 2. Observe limitation message |
| **Expected** | Clear upgrade prompt, no silent failure, existing platforms functional |
| **Actual Result** | PENDING |
| **Status** | ⬜ PENDING |
| **Notes** | — |

### Q. Pro User

| Field | Value |
|-------|-------|
| **Precondition** | User on Pro plan (all platforms) |
| **Steps** | 1. Add all 7 platforms 2. Verify sync works on each |
| **Expected** | All platforms accessible, sync works, analytics updated for all |
| **Actual Result** | PENDING |
| **Status** | ⬜ PENDING |
| **Notes** | — |

---

## Summary

| Scenario | Status |
|----------|--------|
| A. New User | ⬜ PENDING |
| B. Existing User | ⬜ PENDING |
| C. GitHub Success | ⬜ PENDING |
| D. GitHub Failure | ⬜ PENDING |
| E. First Sync | ⬜ PENDING |
| F. Duplicate Sync | ⬜ PENDING |
| G. Updated Solution | ⬜ PENDING |
| H. Identity Mismatch | ⬜ PENDING |
| I. AI Success | ⬜ PENDING |
| J. AI Failure | ⬜ PENDING |
| K. Analytics | ⬜ PENDING |
| L. Coding Journey | ⬜ PENDING |
| M. Notifications | ⬜ PENDING |
| N. Logout / Login | ⬜ PENDING |
| O. Network Offline / Online | ⬜ PENDING |
| P. Basic User | ⬜ PENDING |
| Q. Pro User | ⬜ PENDING |

> [!CAUTION]
> All scenarios are currently PENDING. Real user validation has NOT occurred. These results must only be filled in during actual testing with real users or controlled QA sessions.
