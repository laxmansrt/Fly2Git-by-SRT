// Fly2Git — Release Candidate Version Definition (Phase 20)
// Frozen version configuration for beta release candidate and pilot operations.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Fly2GitVersion = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const FLY2GIT_BETA_VERSION = "1.1.6-rc.1";
  const EXTENSION_VERSION = "1.1.6";
  const BACKEND_API_VERSION = "1.1.0";
  const AI_CONFIG_VERSION = "1.5.0";

  return {
    FLY2GIT_BETA_VERSION,
    EXTENSION_VERSION,
    BACKEND_API_VERSION,
    AI_CONFIG_VERSION,
  };
});
