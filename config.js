// Fly2Git — by SRT
// Central configuration. This is the ONLY file you need to edit before
// loading/publishing the extension.
//
// Fly2Git authenticates via a GitHub App using OAuth Device Flow, which
// means:
//   - Users install the Fly2Git GitHub App and choose exactly which
//     repositories it can access (repository-level permission, not
//     account-wide access).
//   - No client secret is required, so nothing sensitive needs to be
//     shipped inside the extension or protected by a backend server.
//
// Setup (see README.md for full walkthrough):
//   1. Create a GitHub App at https://github.com/settings/apps/new
//   2. Enable "Device Flow" under the app's settings
//   3. Set repository permission: Contents -> Read and write
//   4. Set "Where can this GitHub App be installed?" per your needs
//   5. Copy the Client ID and the app's URL slug below

const FLY2GIT_CONFIG = {
  // Public Client ID of your GitHub App (safe to ship — not a secret).
  GITHUB_APP_CLIENT_ID: "Iv23livkIwLTCTML4cDN",

  // The slug in your GitHub App's public URL, e.g. for
  // https://github.com/apps/fly2git-by-srt this is "fly2git-by-srt".
  GITHUB_APP_SLUG: "fly2git-by-srt",

  BRAND_NAME: "Fly2Git by SRT",

  // Production backend API URL.
  BACKEND_API_URL: "https://api.fly2git.com",

  // Development diagnostics are disabled in production release.
  DEBUG: false,
};
