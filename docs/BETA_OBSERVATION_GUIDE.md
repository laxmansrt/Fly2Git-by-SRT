# Fly2Git — Beta Observation Protocol & Evaluation Guide

This guide establishes the empirical methodology for observing, analyzing, and documenting user experiences during the Fly2Git Private Beta Pilot.

---

## 1. The Four-Category Observation Protocol

When documenting user interactions, session recordings, or feedback logs, every observation MUST be categorized into one of four distinct categories. **Never blend assumptions with facts.**

### `OBSERVED` — What Actually Happened
- Objective, verifiable facts recorded directly by telemetry or witnessed during live testing sessions.
- *Examples*:
  - "User clicked 'Connect GitHub' at 14:02 UTC; OAuth flow returned error `ERR_ACCESS_DENIED`."
  - "User submitted a Python solution on LeetCode; commit appeared in repo within 1.8 seconds."
  - "User opened the popup 4 times within 10 minutes without clicking any action."

### `REPORTED` — What the User Explicitly Said
- Verbatim statements, bug descriptions, or ratings submitted directly by the user via the feedback form or interview.
- *Examples*:
  - "User stated: 'I couldn't tell if my Codeforces submission went through.'"
  - "User wrote: 'The notification disappeared before I could read the commit link.'"
  - "User reported: 'AI Hint gave an O(N) suggestion that helped me pass the last test case.'"

### `INFERRED` — Reasonable Interpretation
- Working hypotheses and logical deductions derived from observed and reported data, clearly labeled as interpretations.
- *Examples*:
  - "Inference: The user likely did not see the repository picker because it was below the initial scroll fold."
  - "Inference: The user may believe that Basic tier only supports 1 platform instead of 2 due to the phrasing on the slot counter."

### `UNKNOWN` — Not Enough Evidence
- Areas where data is missing, conflicting, or inconclusive. Highlighting gaps prevents premature conclusions.
- *Examples*:
  - "Unknown whether the sync delay was caused by GitHub API rate limits or local network latency."
  - "Unknown why the user did not return on Day 3 (no uninstall event recorded)."

---

## 2. Minimal Product Feedback Questionnaire

Feedback questionnaires must be concise, lightweight, and focused on genuine user friction rather than speculative product design.

### Core Beta Questions:
1. **"Did Fly2Git make syncing your solutions easier?"**
   - Options: *Much easier / Somewhat easier / Neutral / Harder*
2. **"Was anything confusing or difficult to understand during setup?"**
   - Free text (bounded to 500 characters).
3. **"Did you use the AI features (Analyze, Explain, Hint, Coach)? If so, did they provide value?"**
   - Options: *Helpful / Not helpful / Didn't try them*
4. **"What would make you open Fly2Git again tomorrow?"**
   - Short response addressing retention hooks and day-to-day workflow fit.

> **Guideline**: Do NOT ask beta testers to redesign the entire feature set or brainstorm theoretical roadmaps. Focus on real workflow validation.
