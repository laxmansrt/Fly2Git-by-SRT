// Fly2Git — by SRT
// AtCoder page-context adapter (MAIN world)
//
// Responsibilities:
// 1. Verify hostname === "atcoder.jp" and singleton guard.
// 2. Extract solution code from Ace Editor (#editor) with #plain-textarea fallback.
// 3. Map AtCoder LanguageId to canonical Fly2Git language (reject unknown).
// 4. Capture submission metadata & code before native form navigation, passing it
//    to atcoder-content.js across the isolated bridge for extension session storage.
//    (ZERO use of window.sessionStorage).
// 5. Receive active submissionId correlation from atcoder-content.js via
//    FLY2GIT_ATCODER_START_OBSERVING event.
// 6. Passively observe AtCoder's native /status/json polling via non-destructive
//    fetch/XHR hooks (zero active polling).
// 7. Parse judge result (AC -> accepted, terminal failures -> stop tracking).
// 8. Bounded 60s timeout for passive observation.
// 9. Dispatch FLY2GIT_ATCODER_ACCEPTED to atcoder-content.js (ISOLATED world).
//
// SECURITY:
// - Never reads or logs cookies, tokens, CSRF secrets, or authorization headers.
// - Never logs complete source code.
// - Zero use of page-level window.sessionStorage for submission staging.
// - Zero active polling against AtCoder.

(function (root) {
  "use strict";

  if (typeof window === "undefined" || !window.location) return;
  if (window.location.hostname !== "atcoder.jp") return;
  if (window.__FLY2GIT_ATCODER_INJECT_INITIALIZED__) return;
  window.__FLY2GIT_ATCODER_INJECT_INITIALIZED__ = true;

  console.log("[Fly2Git][AtCoder] MAIN-world adapter initialized");

  var DEBUG = true;
  var TRACKING_TIMEOUT_MS = 60000; // 60 seconds max tracking lifetime

  var pendingSubmissions = {}; // submissionId -> pendingContext
  var emittedSubmissionIds = new Set(); // guard against duplicate event emission

  function debug() {
    if (!DEBUG) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[Fly2Git][AtCoder]");
    console.log.apply(console, args);
  }

  // ---------------------------------------------------------------
  // 1. Language Mapping & Normalization
  // Verified numeric IDs from AtCoder live dropdown (Phase 8A)
  // ---------------------------------------------------------------
  var ATCODER_LANGUAGE_MAP = Object.freeze({
    "5002": "c",          // C (GCC 12.2.0)
    "5001": "cpp",        // C++ 20 (gcc 12.2)
    "5004": "cpp",        // C++ 23 (gcc 12.2)
    "5003": "cpp",        // C++ 20 (clang 16.0.6)
    "5005": "java",       // Java (OpenJDK 17)
    "5006": "java",       // Java (OpenJDK 21)
    "5028": "python",     // Python (CPython 3.11.4)
    "5029": "python",     // PyPy 3.10 (7.3.12)
    "5042": "javascript", // JavaScript (Node.js 18.16.1)
    "5043": "typescript", // TypeScript 5.1 (Node.js 18.16.1)
    "5011": "csharp",     // C# 11.0 (.NET 7.0.7)
    "5013": "go",         // Go (go 1.20.6)
    "5017": "rust",       // Rust (rustc 1.70.0)
    "5020": "kotlin",     // Kotlin (Kotlin/JVM 1.8.20)
  });

  function normalizeAtCoderLanguage(langId, aceMode, text) {
    if (langId != null) {
      var idStr = String(langId).trim();
      if (ATCODER_LANGUAGE_MAP[idStr]) {
        return ATCODER_LANGUAGE_MAP[idStr];
      }
    }

    // Supporting evidence check (for future compiler versions if unambiguous)
    var textLower = text ? String(text).toLowerCase().trim() : "";
    var modeLower = aceMode ? String(aceMode).toLowerCase().replace(/^ace\/mode\//, "").trim() : "";

    if (modeLower === "c_cpp" || textLower.indexOf("c++") !== -1) return "cpp";
    if (modeLower === "python" || textLower.indexOf("python") !== -1 || textLower.indexOf("pypy") !== -1) return "python";
    if (modeLower === "java" || textLower.indexOf("java (") !== -1) return "java";
    if (modeLower === "csharp" || textLower.indexOf("c#") !== -1) return "csharp";
    if (modeLower === "golang" || textLower.indexOf("go (") !== -1) return "go";
    if (modeLower === "rust" || textLower.indexOf("rust (") !== -1) return "rust";
    if (modeLower === "kotlin" || textLower.indexOf("kotlin (") !== -1) return "kotlin";
    if (modeLower === "typescript" || textLower.indexOf("typescript") !== -1) return "typescript";
    if (modeLower === "javascript" || textLower.indexOf("javascript") !== -1 || textLower.indexOf("node.js") !== -1) return "javascript";

    // Strict safety requirement: Unknown -> null / reject. Do NOT guess!
    return null;
  }

  // ---------------------------------------------------------------
  // 2. Editor Source Code Extraction
  // Priority: 1. Ace (#editor), 2. #plain-textarea, 3. fail safely
  // ---------------------------------------------------------------
  function getAtCoderSourceCode() {
    try {
      if (typeof window.ace !== "undefined" && typeof window.ace.edit === "function") {
        var editor = window.ace.edit("editor");
        if (editor && typeof editor.getValue === "function") {
          var val = editor.getValue();
          if (typeof val === "string" && val.length > 0) {
            return val;
          }
        }
      }
    } catch (_) {}

    try {
      var plain = document.getElementById("plain-textarea");
      if (plain && typeof plain.value === "string" && plain.value.length > 0) {
        return plain.value;
      }
    } catch (_) {}

    return null;
  }

  // ---------------------------------------------------------------
  // 3. Problem Metadata Extraction
  // ---------------------------------------------------------------
  function extractContestScreenName() {
    if (typeof window.contestScreenName === "string" && window.contestScreenName.trim().length > 0) {
      return window.contestScreenName.trim();
    }
    var pathname = window.location.pathname || "";
    var m = pathname.match(/\/contests\/([^\/\?#]+)/);
    return m ? m[1] : null;
  }

  function extractTaskScreenName(form) {
    if (typeof window.taskScreenName === "string" && window.taskScreenName.trim().length > 0) {
      return window.taskScreenName.trim();
    }
    if (form) {
      var input = form.querySelector('input[name="data.TaskScreenName"]') || form.querySelector('select[name="data.TaskScreenName"]');
      if (input && input.value && input.value.trim().length > 0) {
        return input.value.trim();
      }
    }
    var pathname = window.location.pathname || "";
    var m = pathname.match(/\/tasks\/([^\/\?#]+)/);
    return m ? m[1] : null;
  }

  function extractProblemTitle(taskScreenName) {
    try {
      var heading = document.querySelector("#main-container h2") || document.querySelector("#main-container .h2");
      if (heading && heading.innerText && heading.innerText.trim().length > 0) {
        return heading.innerText.trim();
      }
      var h3 = document.querySelector("#main-container h3") || document.querySelector("#main-container .h3");
      if (h3 && h3.innerText && h3.innerText.trim().length > 0) {
        return h3.innerText.trim();
      }
    } catch (_) {}

    var docTitle = document.title || "";
    var cleaned = docTitle
      .replace(/\s*-\s*AtCoder.*$/i, "")
      .trim();
    if (cleaned.length > 0) return cleaned;

    return taskScreenName || "Unknown";
  }

  function buildProblemUrl(contestScreenName, taskScreenName) {
    if (contestScreenName && taskScreenName) {
      return "https://atcoder.jp/contests/" + contestScreenName + "/tasks/" + taskScreenName;
    }
    return window.location.href;
  }

  // ---------------------------------------------------------------
  // 4. Submission Capture Before Navigation & Isolated Bridge Dispatch
  // Passes data to atcoder-content.js for extension session storage.
  // ZERO use of page window.sessionStorage.
  // ---------------------------------------------------------------
  function captureAndForwardSubmission(form) {
    var contestId = extractContestScreenName();
    var taskId = extractTaskScreenName(form);

    if (!contestId || !taskId) {
      debug("Cannot stage submission: missing contestId or taskId");
      return;
    }

    var code = getAtCoderSourceCode();
    if (!code || typeof code !== "string" || code.trim().length === 0) {
      debug("Cannot stage submission: empty code");
      return;
    }

    if (code.length > 200000) {
      debug("Cannot stage submission: code exceeds 200,000 characters");
      return;
    }

    // Language extraction from form dropdown
    var langSelect = form.querySelector('select[name="data.LanguageId"]') || document.querySelector('#select-lang select.current') || document.querySelector('select[name="data.LanguageId"]');
    var rawLangId = langSelect ? langSelect.value : null;
    var selectedOption = langSelect && langSelect.options && langSelect.selectedIndex >= 0 ? langSelect.options[langSelect.selectedIndex] : null;
    var aceMode = selectedOption ? selectedOption.getAttribute("data-ace-mode") : null;
    var optionText = selectedOption ? selectedOption.text : null;

    var normalizedLang = normalizeAtCoderLanguage(rawLangId, aceMode, optionText);
    if (!normalizedLang) {
      debug("Cannot stage submission: unknown or unmapped language", rawLangId);
      return;
    }

    var title = extractProblemTitle(taskId);
    var url = buildProblemUrl(contestId, taskId);

    var stagingPayload = {
      platform: "atcoder",
      contestId: contestId,
      taskId: taskId,
      language: normalizedLang,
      code: code,
      title: title,
      url: url,
      timestamp: Date.now(),
    };

    debug("Submission captured for task:", taskId, "(language: " + normalizedLang + ")");
    debug("Staging created across bridge (TTL 30s) for task:", taskId);

    // Pass through isolated bridge to atcoder-content.js for extension session storage
    try {
      window.dispatchEvent(
        new CustomEvent("FLY2GIT_ATCODER_STAGE_SUBMISSION", {
          detail: stagingPayload,
        })
      );
    } catch (_) {}

    try {
      window.postMessage(
        {
          source: "fly2git-atcoder",
          type: "STAGE_SUBMISSION",
          payload: stagingPayload,
        },
        window.location.origin
      );
    } catch (_) {}
  }

  // ---------------------------------------------------------------
  // 5. Active Pending Submission Registration & Timeout
  // ---------------------------------------------------------------
  function registerPendingSubmission(submissionId, data) {
    if (!submissionId || !data) return;
    var subIdStr = String(submissionId);
    if (pendingSubmissions[subIdStr]) return;

    pendingSubmissions[subIdStr] = {
      contestId: data.contestId,
      taskId: data.taskId,
      language: data.language,
      code: data.code,
      title: data.title,
      url: data.url,
      timestamp: data.timestamp || Date.now(),
      startTime: Date.now(),
    };

    debug("Registered pending submission context for", subIdStr);

    // Bounded lifetime: 60s hard timeout
    setTimeout(function () {
      if (pendingSubmissions[subIdStr]) {
        debug("Passive observation timed out after 60s for submission", subIdStr);
        delete pendingSubmissions[subIdStr];
      }
    }, TRACKING_TIMEOUT_MS);
  }

  // ---------------------------------------------------------------
  // 6. Result Evaluation & Event Dispatch
  // ---------------------------------------------------------------
  var TERMINAL_FAILURE_REGEX = /\b(WA|TLE|MLE|RE|CE|OLE|IE)\b|label-warning|Wrong Answer|Time Limit Exceeded|Memory Limit Exceeded|Runtime Error|Compilation Error|Output Limit Exceeded|Internal Error/i;
  var ACCEPTED_REGEX = /\bAC\b|label-success|Accepted/i;
  var WAITING_REGEX = /\bWJ\b|waiting-judge|\d+\s*\/\s*\d+/i;

  function handleResultHtml(submissionId, html, score) {
    var subIdStr = String(submissionId);
    var pending = pendingSubmissions[subIdStr];
    if (!pending) return;

    var content = String(html || "");

    // 1. Accepted
    if (ACCEPTED_REGEX.test(content) && !WAITING_REGEX.test(content)) {
      debug("Submission verdict: Accepted (AC) for:", subIdStr);
      delete pendingSubmissions[subIdStr];
      dispatchAcceptedSubmission(subIdStr, pending);
      return;
    }

    // 2. Terminal Failure
    if (TERMINAL_FAILURE_REGEX.test(content) && !WAITING_REGEX.test(content)) {
      debug("Submission TERMINAL FAILURE for:", subIdStr, "— stopping observation");
      delete pendingSubmissions[subIdStr];
      return;
    }

    // 3. Waiting / Judging in progress (WJ) -> continue passive observation
    debug("Submission still judging (WJ) for:", subIdStr);
  }

  function dispatchAcceptedSubmission(submissionId, pending) {
    if (emittedSubmissionIds.has(submissionId)) {
      debug("Duplicate accepted emission prevented for", submissionId);
      return;
    }
    emittedSubmissionIds.add(submissionId);

    // Keep bounded set
    if (emittedSubmissionIds.size > 100) {
      emittedSubmissionIds.delete(emittedSubmissionIds.values().next().value);
    }

    var normalizedPayload = {
      platform: "atcoder",
      problem: {
        slug: pending.taskId,
        title: pending.title || pending.taskId,
        difficulty: null,
        url: pending.url,
      },
      submission: {
        id: String(submissionId),
        status: "Accepted",
        language: pending.language,
        code: pending.code,
      },
      metadata: {
        timestamp: Date.now(),
      },
    };

    debug("Emitting FLY2GIT_ATCODER_ACCEPTED for submission:", submissionId);

    // Dual-channel dispatch: CustomEvent and window.postMessage
    try {
      window.dispatchEvent(
        new CustomEvent("FLY2GIT_ATCODER_ACCEPTED", {
          detail: normalizedPayload,
        })
      );
    } catch (_) {}

    try {
      window.postMessage(
        {
          source: "fly2git-atcoder",
          type: "ACCEPTED",
          payload: normalizedPayload,
        },
        window.location.origin
      );
    } catch (_) {}
  }

  // ---------------------------------------------------------------
  // 7. Passive Result Observation (Network Hooks)
  // Non-destructively inspects AtCoder's OWN /status/json traffic
  // NO active polling requests generated by Fly2Git
  // ---------------------------------------------------------------
  var STATUS_JSON_REGEX = /\/contests\/[^\/]+\/submissions\/me\/status\/json|\/submissions\/status\/json/i;

  function checkStatusResponse(responseText, url) {
    if (!responseText || typeof responseText !== "string") return;
    if (Object.keys(pendingSubmissions).length === 0) return;

    try {
      var data = JSON.parse(responseText);
      if (!data || typeof data !== "object" || !data.Result) return;

      var resultObj = data.Result;
      var activeIds = Object.keys(pendingSubmissions);

      for (var i = 0; i < activeIds.length; i++) {
        var sid = activeIds[i];
        if (resultObj[sid]) {
          debug("Native /status/json response observed for submission:", sid);
          var entry = resultObj[sid];
          var html = entry.Html || (typeof entry === "string" ? entry : "");
          handleResultHtml(sid, html, entry.Score);
        }
      }
    } catch (_) {}
  }

  // Hook window.fetch
  try {
    var origFetch = window.fetch;
    window.fetch = function () {
      var args = Array.prototype.slice.call(arguments);
      var resource = args[0];
      var config = args[1];
      var url = typeof resource === "string" ? resource : (resource && resource.url) || "";
      var method = (config && config.method ? config.method : "GET").toUpperCase();

      var isStatusJson = method === "GET" && STATUS_JSON_REGEX.test(url);

      return origFetch.apply(this, args).then(function (response) {
        if (isStatusJson && response && response.ok) {
          try {
            response
              .clone()
              .text()
              .then(function (text) {
                checkStatusResponse(text, url);
              })
              .catch(function () {});
          } catch (_) {}
        }
        return response;
      });
    };
  } catch (e) {
    debug("Failed to hook fetch:", e.message);
  }

  // Hook XMLHttpRequest
  try {
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      if (typeof method === "string" && typeof url === "string") {
        this._fly2gitAtCoder = {
          method: method.toUpperCase(),
          url: url,
        };
      }
      return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
      var self = this;
      self.addEventListener("load", function () {
        if (!self._fly2gitAtCoder) return;
        if (self._fly2gitAtCoder.method === "GET" && STATUS_JSON_REGEX.test(self._fly2gitAtCoder.url)) {
          if (self.status >= 200 && self.status < 300) {
            checkStatusResponse(self.responseText, self._fly2gitAtCoder.url);
          }
        }
      });
      return origSend.apply(this, arguments);
    };
  } catch (e) {
    debug("Failed to hook XHR:", e.message);
  }

  // ---------------------------------------------------------------
  // 8. Event Listeners & Bridge Coordination
  // ---------------------------------------------------------------
  // Listen for form submit before native MPA navigation
  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (!form || !form.classList || !form.classList.contains("form-code-submit")) return;
    captureAndForwardSubmission(form);
  }, true);

  // Listen for correlated submission notifications from atcoder-content.js
  window.addEventListener("FLY2GIT_ATCODER_START_OBSERVING", function (event) {
    if (!event || !event.detail) return;
    var data = event.detail;
    if (data && data.submissionId) {
      registerPendingSubmission(data.submissionId, data);
    }
  });

  window.addEventListener("message", function (event) {
    if (event.source !== window || event.origin !== "https://atcoder.jp") return;
    var d = event.data;
    if (d && d.source === "fly2git-atcoder" && d.type === "START_OBSERVING") {
      var p = d.payload;
      if (p && p.submissionId) {
        registerPendingSubmission(p.submissionId, p);
      }
    }
  });

  // Export helpers for unit testing if running under Node
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      ATCODER_LANGUAGE_MAP: ATCODER_LANGUAGE_MAP,
      normalizeAtCoderLanguage: normalizeAtCoderLanguage,
      getAtCoderSourceCode: getAtCoderSourceCode,
      extractContestScreenName: extractContestScreenName,
      extractTaskScreenName: extractTaskScreenName,
      extractProblemTitle: extractProblemTitle,
      buildProblemUrl: buildProblemUrl,
      handleResultHtml: handleResultHtml,
      registerPendingSubmission: registerPendingSubmission,
      pendingSubmissions: pendingSubmissions,
      emittedSubmissionIds: emittedSubmissionIds,
      STATUS_JSON_REGEX: STATUS_JSON_REGEX,
      TRACKING_TIMEOUT_MS: TRACKING_TIMEOUT_MS,
    };
  }

})(typeof globalThis !== "undefined" ? globalThis : this);
