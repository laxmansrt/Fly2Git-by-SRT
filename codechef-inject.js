// Fly2Git — by SRT
// CodeChef page-context adapter (MAIN world)
//
// Responsibilities:
// 1. Access window.ace to extract solution code from editor ("submit-ide-v2").
// 2. Intercept submission POST requests (/submit) to capture solution_id.
// 3. Poll CodeChef submission result endpoint (/submit?solution_id={id}) until terminal result.
// 4. Verify result_code === "accepted" before emitting.
// 5. Dispatch FLY2GIT_CODECHEF_ACCEPTED to codechef-content.js (ISOLATED world).
// 6. Handle client-side SPA navigation between problems.
//
// SECURITY:
// - Never reads or exposes GitHub tokens, cookies, or authorization headers.
// - Never logs source code.
// - Bounded polling with timeout prevents runaway network requests.

(function () {
  "use strict";

  if (!window.location.hostname.endsWith("codechef.com")) return;
  if (window.__FLY2GIT_CODECHEF_INJECT_INITIALIZED__) return;
  window.__FLY2GIT_CODECHEF_INJECT_INITIALIZED__ = true;

  console.log("[Fly2Git][CodeChef] Adapter loaded");

  var DEBUG = true;

  var activePolls = new Set();
  var lastSubmittedCode = null;
  var lastSubmittedLanguage = null;

  function debug() {
    if (!DEBUG) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[Fly2Git][CodeChef]");
    console.log.apply(console, args);
  }

  // ---------------------------------------------------------------
  // Language Normalization — CodeChef specific
  // ---------------------------------------------------------------
  var CODECHEF_LANG_MAP = {
    // Canonical names & common labels
    python: "python",
    python3: "python",
    "python 3": "python",
    "python 3.8": "python",
    "python 2": "python",
    py: "python",
    pypy: "python",
    pypy3: "python",

    java: "java",
    java8: "java",
    java11: "java",
    java14: "java",
    java17: "java",
    java21: "java",

    c: "c",
    "c (gcc)": "c",
    gcc: "c",

    cpp: "cpp",
    "c++": "cpp",
    "c++14": "cpp",
    "c++17": "cpp",
    "c++20": "cpp",
    c_cpp: "cpp",
    cpp14: "cpp",
    cpp17: "cpp",
    cpp20: "cpp",

    javascript: "javascript",
    js: "javascript",
    nodejs: "javascript",
    "node.js": "javascript",

    typescript: "typescript",
    ts: "typescript",

    csharp: "csharp",
    "c#": "csharp",
    cs: "csharp",

    go: "golang",
    golang: "golang",

    rust: "rust",
    rs: "rust",

    kotlin: "kotlin",
    kt: "kotlin",

    swift: "swift",
    ruby: "ruby",
    rb: "ruby",
    php: "php",
    scala: "scala",

    // CodeChef numeric languageId map
    "116": "python", // Python 3
    "4": "python",   // Python 2
    "10": "java",    // Java
    "11": "c",       // C (gcc)
    "44": "cpp",     // C++14
    "63": "cpp",     // C++17
    "56": "javascript", // Node.js
    "27": "csharp",  // C#
    "114": "golang", // Go
    "93": "rust",    // Rust
    "84": "kotlin",  // Kotlin
    "85": "swift",   // Swift
    "17": "ruby",    // Ruby
    "18": "php",     // PHP
    "22": "scala",   // Scala
  };

  function normalizeCodeChefLanguage(raw) {
    if (!raw || typeof raw !== "string") return null;
    var cleaned = raw
      .trim()
      .toLowerCase()
      .replace(/^ace\/mode\//, "")
      .replace(/\s*\(.*?\)\s*/g, "")
      .trim();
    return CODECHEF_LANG_MAP[cleaned] || CODECHEF_LANG_MAP[raw.trim().toLowerCase()] || null;
  }

  // ---------------------------------------------------------------
  // Problem Metadata Extraction
  // ---------------------------------------------------------------
  function extractProblemMetadata() {
    var pathname = window.location.pathname;
    var contestCode = "PRACTICE";
    var problemCode = null;

    // Pattern 1: /practice/course/.../:contestCode/problems/:problemCode
    // Pattern 2: /:contestCode/problems/:problemCode
    // Pattern 3: /problems/:problemCode
    var problemMatch = pathname.match(/\/problems\/([A-Za-z0-9_-]+)/);
    if (problemMatch) {
      problemCode = problemMatch[1];
      var contestMatch = pathname.match(/\/([A-Za-z0-9_-]+)\/problems\//);
      if (
        contestMatch &&
        contestMatch[1] &&
        contestMatch[1] !== "practice" &&
        contestMatch[1] !== "course" &&
        contestMatch[1] !== "problems"
      ) {
        contestCode = contestMatch[1];
      }
    } else {
      var submitMatch = pathname.match(/\/submit\/([A-Za-z0-9_-]+)/);
      if (submitMatch) {
        problemCode = submitMatch[1];
      }
    }

    if (!problemCode) {
      try {
        var params = new URLSearchParams(window.location.search);
        if (params.has("problemCode")) problemCode = params.get("problemCode");
        if (params.has("contestCode")) contestCode = params.get("contestCode");
      } catch (_) {}
    }

    return {
      contestCode: contestCode || "PRACTICE",
      problemCode: problemCode || null,
      slug: problemCode || null,
    };
  }

  function extractTitle(problemCode) {
    try {
      var h1 = document.querySelector("h1");
      if (h1 && h1.innerText && h1.innerText.trim().length > 0) {
        return h1.innerText.trim();
      }
      var nameEl =
        document.querySelector(".problem-name") ||
        document.querySelector(".problem-title") ||
        document.querySelector(".problem-header");
      if (nameEl && nameEl.innerText && nameEl.innerText.trim().length > 0) {
        return nameEl.innerText.trim();
      }
    } catch (_) {}

    var docTitle = document.title || "";
    var cleaned = docTitle
      .replace(/\|.*$/g, "")
      .replace(/-.*CodeChef.*$/i, "")
      .replace(/Practice Coding Problem.*$/i, "")
      .trim();
    if (cleaned.length > 0) return cleaned;
    return problemCode || "Unknown";
  }

  function extractDifficulty() {
    try {
      var diffEl =
        document.querySelector(".difficulty-rating") ||
        document.querySelector(".difficulty") ||
        document.querySelector("[class*='difficulty']");
      if (diffEl && diffEl.innerText && diffEl.innerText.trim()) {
        var text = diffEl.innerText.trim();
        var num = parseInt(text, 10);
        if (!isNaN(num)) {
          if (num < 1000) return "Easy";
          if (num < 1600) return "Medium";
          return "Hard";
        }
        return text;
      }
    } catch (_) {}
    return "Unknown";
  }

  // ---------------------------------------------------------------
  // Ace Editor Extraction
  // Verified DOM ID: "submit-ide-v2"
  // ---------------------------------------------------------------
  function extractAceCode() {
    try {
      if (typeof window.ace !== "undefined" && typeof window.ace.edit === "function") {
        // Preferred ID: submit-ide-v2
        var el = document.getElementById("submit-ide-v2");
        if (el) {
          var editor = window.ace.edit("submit-ide-v2");
          if (editor && typeof editor.getValue === "function") {
            var val = editor.getValue();
            if (typeof val === "string" && val.trim().length > 0) {
              var mode =
                editor.getSession && editor.getSession().getMode()
                  ? editor.getSession().getMode().$id
                  : null;
              return { code: val, mode: mode };
            }
          }
        }

        // Secondary fallback: query by .ace_editor
        var anyAce = document.querySelector(".ace_editor");
        if (anyAce) {
          var editor2 = window.ace.edit(anyAce);
          if (editor2 && typeof editor2.getValue === "function") {
            var val2 = editor2.getValue();
            if (typeof val2 === "string" && val2.trim().length > 0) {
              var mode2 =
                editor2.getSession && editor2.getSession().getMode()
                  ? editor2.getSession().getMode().$id
                  : null;
              return { code: val2, mode: mode2 };
            }
          }
        }
      }
    } catch (e) {
      debug("Ace editor extraction error:", e.message);
    }
    return null;
  }

  function captureCurrentEditorState() {
    var aceData = extractAceCode();
    if (aceData && aceData.code) {
      lastSubmittedCode = aceData.code;
      if (aceData.mode) {
        lastSubmittedLanguage = normalizeCodeChefLanguage(aceData.mode);
      }
    }
  }

  // ---------------------------------------------------------------
  // Submission Result Detection — Passive Observation
  //
  // CodeChef's own frontend polls for submission results via XHR/fetch.
  // Our network hooks (below) already intercept ALL fetch/XHR traffic.
  // Instead of actively polling (which used wrong endpoints and caused 404s),
  // we store the pending submission context here and let the passive hooks
  // detect the result when CodeChef's own request returns it.
  // ---------------------------------------------------------------
  var pendingSubmissions = {};
  var diagnosticTrafficActive = false;

  var TERMINAL_FAILURES = [
    "wrong_answer",
    "wrong",
    "compilation_error",
    "compile_error",
    "runtime_error",
    "time_limit_exceeded",
    "tle",
    "memory_limit_exceeded",
    "mle",
    "failed",
    "rejected",
    "error",
  ];

  function pollSubmission(contestCode, problemCode, solutionId, capturedCode, capturedLang) {
    var subIdStr = String(solutionId);
    if (activePolls.has(subIdStr)) return;
    activePolls.add(subIdStr);

    debug("Passive observation started for solution", subIdStr);
    debug("Watching CodeChef's own network traffic for result_code");

    // Store context so passive hooks can forward the right code/language
    pendingSubmissions[subIdStr] = {
      contestCode: contestCode,
      problemCode: problemCode,
      capturedCode: capturedCode,
      capturedLang: capturedLang,
      startTime: Date.now(),
    };
    diagnosticTrafficActive = true;

    // Bounded timeout: clean up after 60 seconds if no result observed
    setTimeout(function () {
      if (pendingSubmissions[subIdStr]) {
        debug("Passive observation timed out after 60s for solution", subIdStr);
        delete pendingSubmissions[subIdStr];
        activePolls.delete(subIdStr);
        if (Object.keys(pendingSubmissions).length === 0) {
          diagnosticTrafficActive = false;
        }
      }
    }, 60000);
  }

  // Process a result detected from CodeChef's own traffic
  function processObservedResult(solutionId, data, sourceUrl) {
    var resultCode = String(data.result_code || "").trim().toLowerCase();
    var subIdStr = String(solutionId);

    debug("Observed result for", subIdStr, "→", resultCode, "from URL:", sourceUrl);

    // 1. Accepted
    if (resultCode === "accepted") {
      var pending = pendingSubmissions[subIdStr];
      activePolls.delete(subIdStr);
      delete pendingSubmissions[subIdStr];
      if (Object.keys(pendingSubmissions).length === 0) diagnosticTrafficActive = false;

      debug("Submission ACCEPTED (passive):", subIdStr);
      var meta = extractProblemMetadata();
      handleAcceptedSubmission(
        (pending && pending.contestCode) || meta.contestCode,
        (pending && pending.problemCode) || meta.problemCode,
        subIdStr,
        data,
        (pending && pending.capturedCode) || lastSubmittedCode,
        (pending && pending.capturedLang) || lastSubmittedLanguage
      );
      return;
    }

    // 2. Terminal failure
    if (TERMINAL_FAILURES.indexOf(resultCode) !== -1) {
      activePolls.delete(subIdStr);
      delete pendingSubmissions[subIdStr];
      if (Object.keys(pendingSubmissions).length === 0) diagnosticTrafficActive = false;
      debug("Submission FAILED (passive):", resultCode, subIdStr);
      return;
    }

    // 3. Still processing — do nothing, wait for next CodeChef poll
    debug("Submission still processing:", resultCode, subIdStr);
  }

  // Diagnostic: log traffic safely (no secrets)
  function diagnosticLog(method, url, status, contentType) {
    if (!diagnosticTrafficActive) return;
    // Only log codechef API-like URLs, skip static assets
    if (/\.(js|css|png|jpg|svg|woff|ico)(\?|$)/i.test(url)) return;
    if (/^data:/i.test(url)) return;
    debug("TRAFFIC:", method, url, "→", status, contentType || "");
  }

  // Check if a JSON response body contains result data for a pending submission
  function checkResponseForResult(responseText, sourceUrl) {
    if (!diagnosticTrafficActive) return;
    if (!responseText || typeof responseText !== "string") return;

    try {
      // Quick pre-check: does this response mention any pending solution ID or result_code?
      var hasPendingRef = false;
      var pendingIds = Object.keys(pendingSubmissions);
      for (var i = 0; i < pendingIds.length; i++) {
        if (responseText.indexOf(pendingIds[i]) !== -1) {
          hasPendingRef = true;
          break;
        }
      }
      if (!hasPendingRef && responseText.indexOf("result_code") === -1) return;

      var data = JSON.parse(responseText);
      if (!data || typeof data !== "object") return;

      // Redact sensitive fields before diagnostic logging
      var safePreview = responseText.substring(0, 400)
        .replace(/("?(?:token|cookie|auth|password|secret|key|csrf)[^"]*"?\s*:\s*"?)[^",}\]]+/gi, "$1[REDACTED]");
      debug("DIAGNOSTIC RESULT-LIKE RESPONSE from", sourceUrl, ":", safePreview);

      // Try to match to a pending submission
      var solId = String(data.upid || data.solution_id || data.solutionId || "");
      if (solId && pendingSubmissions[solId] && data.result_code !== undefined) {
        processObservedResult(solId, data, sourceUrl);
        return;
      }

      // Broader match: response has result_code and one of our pending IDs appears in URL
      if (data.result_code !== undefined) {
        for (var j = 0; j < pendingIds.length; j++) {
          if (sourceUrl.indexOf(pendingIds[j]) !== -1) {
            processObservedResult(pendingIds[j], data, sourceUrl);
            return;
          }
        }
      }
    } catch (_) {}
  }

  // ---------------------------------------------------------------
  // Accepted Submission Handler
  // ---------------------------------------------------------------
  function handleAcceptedSubmission(contestCode, problemCode, solutionId, resultData, capturedCode, capturedLang) {
    var meta = extractProblemMetadata();
    var slug = problemCode || meta.problemCode;
    if (!slug) {
      console.warn("[Fly2Git][CodeChef] Problem slug could not be resolved");
      return;
    }

    // Resolve code: prefer captured submission code, fallback to Ace editor value
    var code = capturedCode || lastSubmittedCode;
    if (!code) {
      var aceData = extractAceCode();
      if (aceData && aceData.code) code = aceData.code;
    }

    if (!code || typeof code !== "string" || code.trim().length === 0) {
      console.warn("[Fly2Git][CodeChef] Could not extract solution code");
      return;
    }

    // Resolve language
    var resolvedLang = capturedLang || lastSubmittedLanguage;
    if (!resolvedLang) {
      var ace = extractAceCode();
      if (ace && ace.mode) {
        resolvedLang = normalizeCodeChefLanguage(ace.mode);
      }
    }

    if (!resolvedLang) {
      console.warn("[Fly2Git][CodeChef] Could not normalize submission language");
      return;
    }

    var title = extractTitle(slug);
    var difficulty = extractDifficulty();

    var normalizedPayload = {
      platform: "CodeChef",
      problem: {
        slug: slug,
        title: title,
        difficulty: difficulty,
        url: window.location.href,
      },
      submission: {
        id: String(solutionId),
        status: "Accepted",
        language: resolvedLang,
        code: code,
      },
      metadata: {
        timestamp: Date.now(),
      },
    };

    debug("Normalized submission ready for", solutionId);

    // Forward to codechef-content.js via CustomEvent and window.postMessage
    try {
      window.dispatchEvent(
        new CustomEvent("FLY2GIT_CODECHEF_ACCEPTED", {
          detail: normalizedPayload,
        })
      );
    } catch (_) {}

    try {
      window.postMessage(
        {
          source: "fly2git-codechef",
          type: "ACCEPTED",
          payload: normalizedPayload,
        },
        window.location.origin
      );
    } catch (_) {}
  }

  // ---------------------------------------------------------------
  // Network Interception: Hook window.fetch and XMLHttpRequest
  // Detects POST to /submit or submission requests that produce solution_id
  // ---------------------------------------------------------------
  var SUBMIT_ENDPOINT_PATTERN = /\/(?:api\/ide\/)?submit(?:\/)?(?:\?.*)?$/i;
  var SOLUTION_QUERY_PATTERN = /solution_id=(\d+)/i;
  var UPID_PATH_PATTERN = /\/(\d{7,15})\/?(?:\?.*)?$/;

  // 1. Hook window.fetch
  try {
    var origFetch = window.fetch;
    window.fetch = function () {
      var args = Array.prototype.slice.call(arguments);
      var resource = args[0];
      var config = args[1];
      var url = typeof resource === "string" ? resource : (resource && resource.url) || "";
      var method = (config && config.method ? config.method : "GET").toUpperCase();

      var isSubmitPost = method === "POST" && SUBMIT_ENDPOINT_PATTERN.test(url);
      var capturedCodeAtPost = null;
      var capturedLangAtPost = null;

      if (isSubmitPost) {
        captureCurrentEditorState();
        capturedCodeAtPost = lastSubmittedCode;
        capturedLangAtPost = lastSubmittedLanguage;
        debug("Submission POST detected (fetch)");

        // Try extracting language from request body
        if (config && config.body) {
          try {
            var bodyObj = typeof config.body === "string" ? JSON.parse(config.body) : config.body;
            if (bodyObj && bodyObj.languageId) {
              capturedLangAtPost = normalizeCodeChefLanguage(String(bodyObj.languageId));
            } else if (bodyObj && bodyObj.language) {
              capturedLangAtPost = normalizeCodeChefLanguage(String(bodyObj.language));
            }
          } catch (_) {}
        }
      }

      return origFetch.apply(this, args).then(function (response) {
        try {
          // Diagnostic traffic logging
          var contentType = "";
          try { contentType = response.headers.get("content-type") || ""; } catch (_) {}
          diagnosticLog(method, url, response.status, contentType);

          // Case A: POST /submit response contains solution_id or upid
          if (isSubmitPost && response.ok) {
            response
              .clone()
              .json()
              .then(function (data) {
                var solId = (data && (data.solution_id || data.upid || data.solutionId)) || null;
                if (solId && /^\d+$/.test(String(solId))) {
                  debug("Solution ID extracted from POST response:", solId);
                  var meta = extractProblemMetadata();
                  pollSubmission(
                    meta.contestCode,
                    meta.problemCode,
                    String(solId),
                    capturedCodeAtPost,
                    capturedLangAtPost
                  );
                }
              })
              .catch(function () {});
          }

          // Case B: Query URL containing solution_id=... (CodeChef's own polling)
          var queryMatch = url.match(SOLUTION_QUERY_PATTERN);
          if (queryMatch && queryMatch[1]) {
            var queriedSolId = queryMatch[1];
            if (response.ok) {
              response
                .clone()
                .text()
                .then(function (text) {
                  checkResponseForResult(text, url);
                  // Legacy direct handler as fallback
                  try {
                    var data = JSON.parse(text);
                    if (data && String(data.result_code || "").toLowerCase() === "accepted") {
                      if (!pendingSubmissions[queriedSolId]) {
                        // Not handled by checkResponseForResult, use legacy path
                        var meta = extractProblemMetadata();
                        handleAcceptedSubmission(
                          meta.contestCode,
                          meta.problemCode,
                          queriedSolId,
                          data,
                          lastSubmittedCode,
                          lastSubmittedLanguage
                        );
                      }
                    }
                  } catch (_) {}
                })
                .catch(function () {});
            }
          }

          // Case C: Broad detection — any JSON response that contains result data
          // for a pending submission (catches unknown URL patterns)
          if (response.ok && contentType.indexOf("json") !== -1 && diagnosticTrafficActive) {
            response
              .clone()
              .text()
              .then(function (text) {
                checkResponseForResult(text, url);
              })
              .catch(function () {});
          }
        } catch (_) {}

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
      if (typeof method === "string" && typeof url === "string") {
        this._fly2gitCc = {
          method: method.toUpperCase(),
          url: url,
        };
      }
      return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
      var self = this;
      if (self._fly2gitCc && self._fly2gitCc.method === "POST" && SUBMIT_ENDPOINT_PATTERN.test(self._fly2gitCc.url)) {
        captureCurrentEditorState();
        self._fly2gitCc.capturedCode = lastSubmittedCode;
        self._fly2gitCc.capturedLang = lastSubmittedLanguage;
        debug("Submission POST detected (XHR)");

        if (body) {
          try {
            var bodyObj = typeof body === "string" ? JSON.parse(body) : body;
            if (bodyObj && bodyObj.languageId) {
              self._fly2gitCc.capturedLang = normalizeCodeChefLanguage(String(bodyObj.languageId));
            }
          } catch (_) {}
        }
      }

      self.addEventListener("load", function () {
        if (!self._fly2gitCc) return;
        try {
          // Diagnostic traffic logging
          var xhrContentType = "";
          try { xhrContentType = self.getResponseHeader("content-type") || ""; } catch (_) {}
          diagnosticLog(self._fly2gitCc.method, self._fly2gitCc.url, self.status, xhrContentType);

          if (self.status >= 200 && self.status < 300) {
            // Case A: POST /submit response
            if (self._fly2gitCc.method === "POST" && SUBMIT_ENDPOINT_PATTERN.test(self._fly2gitCc.url)) {
              var data = JSON.parse(self.responseText);
              var solId = (data && (data.solution_id || data.upid || data.solutionId)) || null;
              if (solId && /^\d+$/.test(String(solId))) {
                debug("Solution ID extracted from XHR POST response:", solId);
                var meta = extractProblemMetadata();
                pollSubmission(
                  meta.contestCode,
                  meta.problemCode,
                  String(solId),
                  self._fly2gitCc.capturedCode,
                  self._fly2gitCc.capturedLang
                );
              }
            }

            // Case B: XHR response containing solution_id in URL (CodeChef's own polling)
            var queryMatch = self._fly2gitCc.url.match(SOLUTION_QUERY_PATTERN);
            if (queryMatch && queryMatch[1]) {
              checkResponseForResult(self.responseText, self._fly2gitCc.url);
              // Legacy fallback
              try {
                var data2 = JSON.parse(self.responseText);
                if (data2 && String(data2.result_code || "").toLowerCase() === "accepted") {
                  if (!pendingSubmissions[queryMatch[1]]) {
                    var meta2 = extractProblemMetadata();
                    handleAcceptedSubmission(
                      meta2.contestCode,
                      meta2.problemCode,
                      queryMatch[1],
                      data2,
                      lastSubmittedCode,
                      lastSubmittedLanguage
                    );
                  }
                }
              } catch (_) {}
            }

            // Case C: Broad detection — any JSON XHR response with result data
            if (xhrContentType.indexOf("json") !== -1 && diagnosticTrafficActive) {
              checkResponseForResult(self.responseText, self._fly2gitCc.url);
            }
          }
        } catch (_) {}
      });

      return origSend.apply(this, arguments);
    };
  } catch (xhrErr) {
    debug("Failed to hook XHR:", xhrErr.message);
  }

  // ---------------------------------------------------------------
  // SPA Navigation Watcher
  // ---------------------------------------------------------------
  var lastObservedPath = window.location.pathname;
  setInterval(function () {
    if (window.location.pathname !== lastObservedPath) {
      lastObservedPath = window.location.pathname;
      debug("SPA navigation detected:", lastObservedPath);
      lastSubmittedCode = null;
      lastSubmittedLanguage = null;
    }
  }, 1500);

})();
