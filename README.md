# Fly2Git by SRT

*Solve it. Ship it.*

Automatically syncs your accepted LeetCode solutions to a GitHub repository
you choose — using a **GitHub App with repository-level permissions**, not
account-wide OAuth access. You pick exactly which repo Fly2Git can touch;
it can't see or write to anything else in your GitHub account.

## Why this is different

Most LeetCode→GitHub tools (LeetHub included) authenticate via a classic
GitHub OAuth App, which requests the `repo` scope — access to *every*
repository you own. Fly2Git uses a **GitHub App** instead: when you
install it, GitHub lets you choose "only select repositories," and the
access token Fly2Git receives is scoped to just those repos, enforced by
GitHub itself.

## Architecture

- `inject.js` — runs in LeetCode's page context. It detects accepted
  submissions primarily through LeetCode's GraphQL submission list/detail
  queries, with the legacy REST submit/check flow and Accepted-panel observer
  retained as fallbacks.
- `content.js` — validates the page-world event and relays only the required
  fields to the background worker.
- `background.js` — does the actual sync: duplicate detection, smart
  folder structure, README generation, clean commit messages, GitHub API calls,
  token refresh, and a one-at-a-time sync queue.
- `popup.html` / `popup.js` — the Connect-GitHub flow (Device Flow),
  repository picker, and a recent-syncs log.
- `config.js` — the only file you need to edit before using this unpacked build.

**No backend server is required.** Authentication uses GitHub's OAuth
**Device Flow**, which needs only a public Client ID — no client secret.

## What gets synced

Each accepted solution is written to:

```
<your-repo>/
  LeetCode/
    <Difficulty>/
      <problem-slug>/
        solution.<ext>
        README.md
```

- **Duplicate protection:** if you resubmit a problem with identical code,
  Fly2Git skips the push entirely (no empty commits).
- **Clean commits:** `Add: Two Sum (Easy)` or `Update: Two Sum (Easy)`,
  with language and a link to the problem in the commit body.
- **README generation:** each problem folder gets a short README with
  title, difficulty, link, language, and sync date.

## Setup

### 1. Create the GitHub App

1. Go to <https://github.com/settings/apps/new>
2. **GitHub App name:** `Fly2Git` (or `Fly2Git-yourname` — names must be
   globally unique across GitHub)
3. **Homepage URL:** anything for now (e.g. your GitHub profile)
4. **Callback URL:** not required for Device Flow, but GitHub may require
   a value — `https://github.com` works as a placeholder
5. **Webhook:** uncheck "Active" (Fly2Git doesn't need webhooks for V1)
6. **Repository permissions:** set **Contents** to **Read and write**
7. **Where can this GitHub App be installed?** choose based on your
   audience — "Any account" if this is public-facing
8. Click **Create GitHub App**

### 2. Enable Device Flow

On the app's settings page, scroll to **Optional features** and enable
**Device Flow**. This is what lets the extension authenticate without a
backend server.

### 3. Get your Client ID and app slug

- Copy the **Client ID** shown near the top of the app's settings page.
- Note the app's URL slug — visible in the app's public page URL, e.g.
  `https://github.com/apps/fly2git` → slug is `fly2git`.

### 4. Configure the extension

Open `config.js` and fill in:

```js
GITHUB_APP_CLIENT_ID: "Iv1.xxxxxxxxxxxxxxxx",
GITHUB_APP_SLUG: "fly2git",
```

### 5. Load it in Chrome

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**, select this folder

### 6. Connect and pick a repo

1. Click the Fly2Git icon → **Connect GitHub**
2. Enter the code shown at the GitHub page that opens
3. On GitHub, you'll be prompted to **install** the Fly2Git App and choose
   which repository/repositories it can access — pick your solutions repo
4. Back in the popup, select that repo from the dropdown → **Use this
   repository**

### 7. Solve a problem

Submit an accepted solution on LeetCode. Watch the extension icon for a
green ✓ badge, then check your repo.

## Required Chrome permissions, and why

| Permission | Why it's needed |
|---|---|
| `storage` | Stores your GitHub token, selected repo, and recent-sync log locally in the browser. Nothing here is sent anywhere except to GitHub's own API. |
| `alarms` | Lets the background worker keep checking whether you've authorized GitHub even if you close the popup partway through connecting (see "Known limitations" below for the trade-off this involves). |
| `host_permissions: leetcode.com` | Needed to read the accepted-submission signal from the LeetCode problem page. |
| `host_permissions: api.github.com` | Needed to create/update files and commits in your selected repo. |
| `host_permissions: github.com` | Needed for the Device Flow login endpoints (`/login/device/code`, `/login/oauth/access_token`), which live on `github.com`, not `api.github.com`. This is broader than ideal — Chrome's host-permission model can't scope to just those two paths — but no other `github.com` traffic is made. |

Fly2Git does **not** request `<all_urls>` or any permission beyond the above.

## GitHub App permissions & what repos it can access

The Fly2Git GitHub App requests **Contents: Read and write** on whichever
repositories you explicitly select when installing it. It cannot read or
write any other repository, cannot see your account's other repos, and
cannot access organization settings, other apps, issues, or anything
outside Contents on the repos you chose. This is enforced by GitHub itself,
not by Fly2Git's code — installing the App is where you make that choice,
independent of anything the extension does.

More precisely: *"Fly2Git requests only the GitHub permissions required for
syncing, and can be installed for selected repositories you choose."*

## What data is stored, and where

Everything Fly2Git stores lives in `chrome.storage.local` — scoped to your
browser profile, not synced to any Fly2Git server (there is no Fly2Git
server):

- Your GitHub access token and refresh token (from Device Flow)
- The repository you selected
- A local log of your last 20 syncs (problem name, status, timestamp, and a
  link to the commit) — used only to render the popup's "Recent syncs" list

**Solution code is sent to exactly one place: the GitHub Contents/Git Data
API, for the repository you selected.** It is never sent to any
Fly2Git-operated server, because none exists in this architecture.

## How to disconnect / revoke access

Two independent ways, and you may want both:

1. **In the extension:** open the popup → **Disconnect GitHub**. This
   deletes the stored token and selected repo from `chrome.storage.local`.
2. **On GitHub directly:** go to your GitHub **Settings → Applications →
   Installed GitHub Apps**, find Fly2Git, and uninstall it (or adjust which
   repos it can access). This is the authoritative revocation — it works
   even if the extension itself is misbehaving, uninstalled, or you no
   longer trust it.

## Troubleshooting

- **Badge turns red / nothing syncs:** open the popup — the "Recent syncs"
  list shows the specific error (expired auth, missing permission, rate
  limit, etc.) rather than a generic failure.
- **"GitHub authorization expired"**: click **Disconnect GitHub**, then
  **Connect GitHub** again.
- **A solved problem never triggers a sync:** open the LeetCode tab's
  DevTools console — development diagnostics are enabled in V1.1.6. Look for
  `[Fly2Git][LeetCode]` and `[Fly2Git][Bridge]` messages to see detection,
  GraphQL, and forwarding stages.
- **Repo missing from the picker:** you likely didn't grant Fly2Git access
  to it during GitHub App installation — use the "Grant Fly2Git access to
  more repos" link in the repo-picker view.

## Known limitations (V1)

- **LeetCode's internal API isn't public/documented**, so `inject.js`'s
  GraphQL query names/fields may need small updates if LeetCode changes its
  internal schema. The legacy REST path and Accepted-panel fallback are retained
  to reduce breakage.
- **Difficulty is primarily read from the authenticated submission
  GraphQL response; DOM detection is only a fallback signal.
- **Device Flow polling while the popup is closed is slower, not absent.**
  While the popup is open, authorization is detected within a few seconds.
  If you close the popup before finishing on GitHub, the background worker
  keeps polling via `chrome.alarms`, but Chrome clamps published
  extensions' alarm frequency to a 1-minute minimum — so completing
  authorization can take up to ~1 minute to be picked up, instead of a few
  seconds. Reopening the popup will show "Connected" once it's picked up;
  you do not need to restart the connection process. This is an inherent
  Manifest V3 service-worker constraint, not something fixable without
  introducing a backend.
- **Only LeetCode is supported in V1.** Other platforms are planned for V2,
  behind a `platform/leetcode/` adapter boundary so the GitHub sync engine
  itself stays platform-agnostic.
- **No automated UI tests for `popup.js`/`popup.html`** — see the project's
  test suite for what *is* covered (GitHub error classification, pagination,
  multi-installation handling, the sync engine's duplicate detection and
  single-commit behavior, the `content.js` trust boundary, and the
  submission-ID race fix). Popup behavior was checked manually; a headless
  DOM test would be a reasonable addition before public release.
- **This audit's security fixes reduce risk; they don't eliminate the
  fact that a content script running alongside a page you don't control is
  an inherently smaller trust boundary than a native app.** `content.js`
  now validates origin, source, and every field's type/shape before
  forwarding anything to the background worker — but if LeetCode's own page
  were ever compromised (not something Fly2Git can control), origin
  validation alone wouldn't help, since the malicious script would
  legitimately run at `https://leetcode.com`. This is a limitation of the
  browser-extension model in general, not specific to Fly2Git, and is worth
  understanding rather than assuming away.

## Security considerations

- No GitHub App private key or client secret is bundled in this extension —
  Device Flow doesn't require one. `config.js` only ever holds a public
  Client ID, which is safe to ship/commit.
- `content.js` is the trust boundary between the LeetCode page (untrusted)
  and the background worker (holds your token). It validates
  `event.source`, `event.origin`, and the full shape/type of every field
  before forwarding anything — see "Known limitations" above for what this
  does and doesn't protect against.
- The background worker never inserts LeetCode- or GitHub-derived strings
  into HTML; the popup UI builds all dynamic content via `textContent` and
  `createElement`, not `innerHTML`.

## License

Decide before you publish this publicly — see the project notes on
open-core vs. fully open-source licensing.

## Contributing

Not yet open for external contributions — this is pre-release. Once
published, issues and PRs will be welcome against the LeetCode adapter
(`inject.js`/`content.js`) and the platform-agnostic sync engine
(`background.js`) separately, per the architecture goal of keeping
platform-specific logic isolated from the GitHub sync core.


## v1.1.6 diagnostics
Startup diagnostics use `console.log` so they remain visible under the default Chrome DevTools console levels. The LeetCode page should show `[Fly2Git] v1.1.6 LeetCode detector loaded`.


## v1.1.6 diagnostic change

The LeetCode submission detector uses the `submissionList` GraphQL field and filters accepted submissions client-side. It logs the GraphQL response summary, accepted submission ID, and baseline comparison.
