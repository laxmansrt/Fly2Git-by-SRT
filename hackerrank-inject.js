// Fly2Git — by SRT
// HackerRank page-context adapter (MAIN world)
//
// Runs in MAIN world so it can:
// 1. Access window.monaco to extract solution code and language.
// 2. Intercept submission POST requests to capture the submission ID.
// 3. Poll the HackerRank submission status API until a terminal state is reached.
// 4. Dispatch FLY2GIT_HACKERRANK_ACCEPTED to hackerrank-content.js (ISOLATED world)
//    ONLY when the submission is verified as Accepted/Solved.
//
// SECURITY:
// - Never reads or exposes GitHub tokens, cookies, or authorization headers.
// - Never logs full source code.
// - Bounded polling with timeout prevents runaway network requests.

(function () {
  "use strict";

  if (!window.location.hostname.endsWith("hackerrank.com")) return;
  if (window.__FLY2GIT_HACKERRANK_INJECT_INITIALIZED__) return;
  window.__FLY2GIT_HACKERRANK_INJECT_INITIALIZED__ = true;

  console.log("[Fly2Git][HackerRank] Adapter loaded");

  var DEBUG = true;
  var POLL_INITIAL_DELAY_MS = 800;
  var POLL_INTERVAL_MS = 1200;
  var MAX_POLL_ATTEMPTS = 25; // ~30 seconds maximum duration

  var activePolls = new Set();
  var nativeFetch = window.fetch.bind(window);

  function debug() {
    if (!DEBUG) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[Fly2Git][HackerRank]");
    console.log.apply(console, args);
  }

  // ---------------------------------------------------------------
  // Language Normalization — HackerRank specific
  // Maps HackerRank runtime identifiers (e.g. java15, cpp14) to canonical Fly2Git IDs.
  // ---------------------------------------------------------------
  var HACKERRANK_LANG_MAP = {
    // Java
    java: "java",
    java8: "java",
    java11: "java",
    java15: "java",
    java17: "java",
    java21: "java",

    // C++
    cpp: "cpp",
    cpp14: "cpp",
    cpp20: "cpp",
    "c++": "cpp",
    "c++14": "cpp",
    "c++20": "cpp",

    // C
    c: "c",

    // Python
    python: "python",
    python3: "python",
    pypy: "python",
    pypy3: "python",

    // JavaScript / TypeScript
    javascript: "javascript",
    nodejs: "javascript",
    js: "javascript",
    typescript: "typescript",
    ts: "typescript",

    // C#
    csharp: "csharp",
    "c#": "csharp",

    // Go
    go: "golang",
    golang: "golang",

    // Others
    ruby: "ruby",
    swift: "swift",
    swift4: "swift",
    kotlin: "kotlin",
    rust: "rust",
    scala: "scala",
    php: "php",
    perl: "perl",
    r: "r",
  };

  function normalizeHackerRankLanguage(raw) {
    if (!raw || typeof raw !== "string") return null;
    var key = raw.trim().toLowerCase();
    return HACKERRANK_LANG_MAP[key] || null;
  }

  // ---------------------------------------------------------------
  // Monaco Editor Code Extraction
  // HackerRank exposes window.monaco in the MAIN world.
  // ---------------------------------------------------------------
  function extractMonaco() {
    try {
      if (
        typeof window.monaco === "object" &&
        window.monaco.editor &&
        typeof window.monaco.editor.getModels === "function"
      ) {
        var models = window.monaco.editor.getModels();
        if (models && models.length > 0) {
          // Select candidate model, ignoring auxiliary schema or output buffers
          for (var i = 0; i < models.length; i++) {
            var m = models[i];
            var uri = m.uri ? m.uri.toString().toLowerCase() : "";
            if (
              uri.indexOf(".d.ts") === -1 &&
              uri.indexOf("schema.json") === -1 &&
              uri.indexOf("output") === -1
            ) {
              var val = m.getValue();
              if (typeof val === "string" && val.trim().length > 0) {
                return {
                  code: val,
                  language: m.getLanguageId ? m.getLanguageId() : null,
                };
              }
            }
          }
          // Fallback to first non-empty model
          var firstVal = models[0].getValue();
          if (typeof firstVal === "string" && firstVal.trim().length > 0) {
            return {
              code: firstVal,
              language: models[0].getLanguageId ? models[0].getLanguageId() : null,
            };
          }
        }
      }
    } catch (e) {
      debug("Monaco extraction error:", e.message);
    }
    return null;
  }

  // ---------------------------------------------------------------
  // Problem Metadata Extraction
  // ---------------------------------------------------------------
  function extractSlugFromUrl() {
    var match = window.location.pathname.match(/\/challenges\/([^/]+)/);
    return match ? match[1] : null;
  }

  function extractTitleFromPage(modelName) {
    if (modelName && typeof modelName === "string" && modelName.trim()) {
      return modelName.trim();
    }
    var title = document.title || "";
    var pipeIdx = title.indexOf("|");
    if (pipeIdx > 0) {
      title = title.slice(0, pipeIdx).trim();
    }
    return title || extractSlugFromUrl() || "Unknown";
  }

  // ---------------------------------------------------------------
  // Submission Status Polling
  // Polls /rest/contests/{contest}/challenges/{slug}/submissions/{id}
  // until terminal status (Solved / Failed / Timeout).
  // ---------------------------------------------------------------
  function pollSubmission(contestSlug, challengeSlug, submissionId, capturedBody) {
    if (activePolls.has(submissionId)) return;
    activePolls.add(submissionId);

    var pollUrl =
      "/rest/contests/" +
      encodeURIComponent(contestSlug || "master") +
      "/challenges/" +
      encodeURIComponent(challengeSlug) +
      "/submissions/" +
      encodeURIComponent(submissionId);

    var attempts = 0;

    function doPoll() {
      attempts++;
      nativeFetch(pollUrl, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
      })
        .then(function (res) {
          if (!res.ok) {
            throw new Error("HTTP " + res.status);
          }
          return res.json();
        })
        .then(function (data) {
          var model = data && data.model;
          if (!model) {
            throw new Error("Missing submission model in response");
          }

          var status = (model.status || "").toString();
          debug("Submission status", status, "| attempt", attempts);

          if (status.toLowerCase() === "processing") {
            if (attempts >= MAX_POLL_ATTEMPTS) {
              debug("Submission polling timed out after ~30s", submissionId);
              activePolls.delete(submissionId);
              return;
            }
            setTimeout(doPoll, POLL_INTERVAL_MS);
            return;
          }

          // Terminal state reached: determine if Accepted / Solved
          activePolls.delete(submissionId);

          var isSolved =
            model.solved === 1 ||
            model.solved === true ||
            status.toLowerCase() === "accepted" ||
            status.toLowerCase() === "solved";

          if (isSolved) {
            debug("Submission accepted", submissionId);
            handleAcceptedSubmission(model, challengeSlug, capturedBody);
          } else {
            debug("Submission failed", submissionId, "| status:", status);
          }
        })
        .catch(function (err) {
          debug("Polling request failed:", err.message);
          if (attempts < MAX_POLL_ATTEMPTS) {
            setTimeout(doPoll, POLL_INTERVAL_MS);
          } else {
            activePolls.delete(submissionId);
          }
        });
    }

    setTimeout(doPoll, POLL_INITIAL_DELAY_MS);
  }

  // ---------------------------------------------------------------
  // Accepted Submission Handler & Normalization
  // ---------------------------------------------------------------
  function handleAcceptedSubmission(model, challengeSlug, capturedBody) {
    var monacoData = extractMonaco();

    // Prefer Monaco code; fallback to API model code or captured POST body
    var code =
      (monacoData && monacoData.code) ||
      model.code ||
      (capturedBody && capturedBody.code) ||
      "";

    if (!code || typeof code !== "string" || code.trim().length === 0) {
      console.warn("[Fly2Git][HackerRank] Could not extract solution code");
      return;
    }

    // Resolve raw language identifier
    var rawLanguage =
      model.language ||
      (capturedBody && capturedBody.language) ||
      (monacoData && monacoData.language) ||
      "";

    var normalizedLang = normalizeHackerRankLanguage(rawLanguage);
    if (!normalizedLang) {
      console.warn(
        "[Fly2Git][HackerRank] Unsupported or unmapped language:",
        rawLanguage
      );
      return;
    }

    var slug = challengeSlug || model.slug || extractSlugFromUrl();
    if (!slug) {
      console.warn("[Fly2Git][HackerRank] Could not determine problem slug");
      return;
    }

    var title = extractTitleFromPage(model.name);
    var difficulty = model.difficulty_name || model.difficulty || "Unknown";

    var timestamp = Date.now();
    if (typeof model.created_at_epoch === "number") {
      timestamp = model.created_at_epoch * 1000;
    } else if (model.created_at) {
      var parsedTime = new Date(model.created_at).getTime();
      if (!isNaN(parsedTime)) timestamp = parsedTime;
    }

    var normalizedPayload = {
      platform: "HackerRank",
      problem: {
        slug: slug,
        title: title,
        difficulty: difficulty,
        url: window.location.href,
      },
      submission: {
        id: String(model.id),
        status: "Accepted",
        language: normalizedLang,
        code: code,
      },
      metadata: {
        timestamp: timestamp,
      },
    };

    debug("Normalized submission ready", normalizedPayload.submission.id);

    // Forward to hackerrank-content.js via CustomEvent and window.postMessage
    try {
      window.dispatchEvent(
        new CustomEvent("FLY2GIT_HACKERRANK_ACCEPTED", {
          detail: normalizedPayload,
        })
      );
    } catch (_) {}

    try {
      window.postMessage(
        {
          source: "fly2git-hackerrank",
          type: "ACCEPTED",
          payload: normalizedPayload,
        },
        window.location.origin
      );
    } catch (_) {}
  }

  // ---------------------------------------------------------------
  // Network Interception: Hook fetch and XMLHttpRequest
  // Detects POST to /rest/contests/{contest}/challenges/{slug}/submissions
  // ---------------------------------------------------------------
  var SUBMISSION_URL_PATTERN =
    /\/rest\/contests\/([^/]+)\/challenges\/([^/]+)\/submissions(?:\/)?(?:\?.*)?$/;

  // 1. Hook window.fetch
  try {
    var origFetch = window.fetch;
    window.fetch = function () {
      var args = Array.prototype.slice.call(arguments);
      var resource = args[0];
      var config = args[1];
      var url = typeof resource === "string" ? resource : (resource && resource.url) || "";

      var isPost = config && config.method && config.method.toUpperCase() === "POST";
      var match = isPost ? url.match(SUBMISSION_URL_PATTERN) : null;
      var capturedBody = null;

      if (match && config && config.body) {
        try {
          capturedBody = typeof config.body === "string" ? JSON.parse(config.body) : config.body;
          debug("Submission detected (fetch):", match[2]);
        } catch (_) {}
      }

      return origFetch.apply(this, args).then(function (response) {
        if (match && response.ok) {
          response
            .clone()
            .json()
            .then(function (data) {
              if (data && data.model && data.model.id) {
                var contestSlug = match[1];
                var challengeSlug = match[2];
                var submissionId = String(data.model.id);
                debug("Submission created", submissionId);
                pollSubmission(contestSlug, challengeSlug, submissionId, capturedBody);
              }
            })
            .catch(function () {});
        }
        return response;
      });
    };
  } catch (err) {
    debug("Failed to hook fetch:", err.message);
  }

  // 2. Hook XMLHttpRequest
  try {
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      if (typeof method === "string" && method.toUpperCase() === "POST" && typeof url === "string") {
        var match = url.match(SUBMISSION_URL_PATTERN);
        if (match) {
          this._fly2gitHr = {
            contestSlug: match[1],
            challengeSlug: match[2],
          };
        }
      }
      return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
      var self = this;
      if (self._fly2gitHr && body) {
        try {
          self._fly2gitHr.body = typeof body === "string" ? JSON.parse(body) : null;
          debug("Submission detected (XHR):", self._fly2gitHr.challengeSlug);
        } catch (_) {}
      }

      self.addEventListener("load", function () {
        if (self._fly2gitHr && self.status >= 200 && self.status < 300) {
          try {
            var data = JSON.parse(self.responseText);
            if (data && data.model && data.model.id) {
              var subId = String(data.model.id);
              debug("Submission created (XHR)", subId);
              pollSubmission(
                self._fly2gitHr.contestSlug,
                self._fly2gitHr.challengeSlug,
                subId,
                self._fly2gitHr.body
              );
            }
          } catch (_) {}
        }
      });

      return origSend.apply(this, arguments);
    };
  } catch (xhrErr) {
    debug("Failed to hook XHR:", xhrErr.message);
  }

  // ---------------------------------------------------------------
  // DOM Confirmation / Fallback Observation
  // Detects the verified success string "You have successfully solved"
  // and confirms with the submissions API if a submission was missed.
  // ---------------------------------------------------------------
  var lastObservedPath = window.location.pathname;
  var fallbackCheckedIds = new Set();

  function checkDomSuccess() {
    if (!document.body) return;
    var bodyText = (document.body.innerText || "").toLowerCase();
    if (bodyText.indexOf("you have successfully solved") === -1) return;

    var slug = extractSlugFromUrl();
    if (!slug) return;

    // Check recent submission via API
    var recentUrl =
      "/rest/contests/master/challenges/" +
      encodeURIComponent(slug) +
      "/submissions?offset=0&limit=1";

    nativeFetch(recentUrl, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        var models = data && data.models;
        if (models && models.length > 0) {
          var m = models[0];
          var subId = String(m.id);
          if (!fallbackCheckedIds.has(subId) && !activePolls.has(subId)) {
            fallbackCheckedIds.add(subId);
            if (m.solved === 1 || m.solved === true) {
              debug("Fallback DOM success confirmed via API", subId);
              handleAcceptedSubmission(m, slug, null);
            }
          }
        }
      })
      .catch(function () {});
  }

  // Lightweight observer on document.body for success panel
  var domObserver = null;
  function startDomObserver() {
    if (!document.body) {
      setTimeout(startDomObserver, 200);
      return;
    }
    if (domObserver) domObserver.disconnect();
    domObserver = new MutationObserver(function () {
      checkDomSuccess();
    });
    domObserver.observe(document.body, { childList: true, subtree: true });
  }

  // SPA navigation watcher
  setInterval(function () {
    if (window.location.pathname !== lastObservedPath) {
      lastObservedPath = window.location.pathname;
      debug("SPA navigation detected:", lastObservedPath);
      startDomObserver();
    }
  }, 1500);

  if (document.body) {
    startDomObserver();
  } else {
    document.addEventListener("DOMContentLoaded", startDomObserver);
  }
})();
