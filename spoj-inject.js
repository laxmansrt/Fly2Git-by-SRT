// Fly2Git — by SRT
// SPOJ page-context adapter (MAIN world)
//
// Responsibilities:
// 1. Verify hostname === "www.spoj.com" and singleton guard.
// 2. Extract solution code from CodeMirror v5 (.CodeMirror) with #problem_body textarea and
//    #subm_file file upload fallback.
// 3. Map SPOJ numeric language IDs / option texts to canonical Fly2Git language (reject unknown).
// 4. Capture submission metadata & code before native form POST navigation, passing it
//    to spoj-content.js across the isolated bridge for extension session storage.
//    (ZERO use of window.sessionStorage).
// 5. Detect and suppress active contest contexts with practice-first safety.
//
// SECURITY:
// - Never reads or logs credentials, auth tokens, session secrets, or authorization headers.
// - Never logs complete source code.
// - Zero use of page-level window.sessionStorage for submission staging.
// - Zero aggressive polling against SPOJ.

(function (root) {
  "use strict";

  if (typeof window === "undefined" || !window.location) return;
  if (window.location.hostname !== "www.spoj.com") return;
  if (window.__FLY2GIT_SPOJ_INJECT_INITIALIZED__) return;
  window.__FLY2GIT_SPOJ_INJECT_INITIALIZED__ = true;

  console.log("[Fly2Git][SPOJ] MAIN-world adapter initialized");

  var DEBUG = true;
  var MAX_CODE_LENGTH = 200000;

  function debug() {
    if (!DEBUG) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[Fly2Git][SPOJ]");
    console.log.apply(console, args);
  }

  // ---------------------------------------------------------------
  // 1. Language Mapping & Normalization
  // Verified numeric IDs and compiler strings from SPOJ dropdown & status table
  // ---------------------------------------------------------------
  var SPOJ_NUMERIC_LANG_MAP = Object.freeze({
    "1": "cpp",         // C++ (gcc 8.3)
    "41": "cpp",        // C++ 4.3.2
    "44": "cpp",        // C++14 (gcc 8.3)
    "11": "c",          // C (gcc 8.3)
    "10": "java",       // Java (hotspot 8u112)
    "4": "python",      // Python 2
    "116": "python",    // Python 3 (python 3.8 / 3.x)
    "99": "python",     // PyPy 3
    "112": "javascript",// JavaScript (SpiderMonkey / Node)
    "27": "csharp",     // C# (mono)
    "114": "go",        // Go
    "93": "rust",       // Rust
    "47": "kotlin",     // Kotlin
    "17": "pascal",     // Pascal
    "22": "scala",      // Scala
    "85": "swift",      // Swift
    "29": "php",        // PHP
  });

  var SPOJ_STATUS_CODE_MAP = Object.freeze({
    "CPP": "cpp",
    "CPP14": "cpp",
    "CPP20": "cpp",
    "C++": "cpp",
    "C++14": "cpp",
    "C": "c",
    "C99": "c",
    "JAVA": "java",
    "PYTH 3": "python",
    "PYTHON 3": "python",
    "PYTH3": "python",
    "PYPY3": "python",
    "PYTH": "python",
    "PYTHON": "python",
    "PYPY": "python",
    "JS": "javascript",
    "JS-MONKEY": "javascript",
    "NODEJS": "javascript",
    "CS": "csharp",
    "C#": "csharp",
    "GO": "go",
    "GOLANG": "go",
    "RUST": "rust",
    "KT": "kotlin",
    "KOTLIN": "kotlin",
    "SWIFT": "swift",
    "RUBY": "ruby",
    "PHP": "php",
    "PAS": "pascal",
    "PASCAL": "pascal",
    "SCALA": "scala",
  });

  function normalizeSPOJLanguage(langVal, langText) {
    if (langVal != null) {
      var idStr = String(langVal).trim();
      if (SPOJ_NUMERIC_LANG_MAP[idStr]) {
        return SPOJ_NUMERIC_LANG_MAP[idStr];
      }
      var upperVal = idStr.toUpperCase();
      if (SPOJ_STATUS_CODE_MAP[upperVal]) {
        return SPOJ_STATUS_CODE_MAP[upperVal];
      }
    }

    var text = langText ? String(langText).toLowerCase().trim() : "";
    if (text) {
      var upperText = text.toUpperCase();
      if (SPOJ_STATUS_CODE_MAP[upperText]) {
        return SPOJ_STATUS_CODE_MAP[upperText];
      }
      if (text.indexOf("c++") !== -1 || text.indexOf("g++") !== -1 || text.indexOf("clang++") !== -1) return "cpp";
      if (text.indexOf("python 3") !== -1 || text.indexOf("python3") !== -1 || text.indexOf("pypy3") !== -1) return "python";
      if (text.indexOf("python") !== -1 || text.indexOf("pypy") !== -1) return "python";
      if (text.indexOf("java") !== -1) return "java";
      if (text.indexOf("c#") !== -1 || text.indexOf("csharp") !== -1) return "csharp";
      if (text.indexOf("go (") !== -1 || text.indexOf("golang") !== -1) return "go";
      if (text.indexOf("rust") !== -1) return "rust";
      if (text.indexOf("kotlin") !== -1) return "kotlin";
      if (text.indexOf("typescript") !== -1) return "typescript";
      if (text.indexOf("javascript") !== -1 || text.indexOf("node") !== -1 || text.indexOf("js-monkey") !== -1) return "javascript";
      if (text.indexOf("swift") !== -1) return "swift";
      if (text.indexOf("ruby") !== -1) return "ruby";
      if (text.indexOf("php") !== -1) return "php";
      if (text.indexOf("pascal") !== -1) return "pascal";
      if (text.indexOf("scala") !== -1) return "scala";
      if (text.indexOf("c (") !== -1 || text === "c") return "c";
    }

    return null;
  }

  // ---------------------------------------------------------------
  // 2. Contest Safety Check
  // ---------------------------------------------------------------
  function isSPOJContestContext(pathname) {
    var path = (pathname || window.location.pathname || "").toLowerCase();
    // Standard SPOJ practice routes:
    // /problems/{CODE}/
    // /submit/{CODE}/
    // /status/
    // /status/{CODE},{USER}/
    // /status/{USER}/
    if (path.indexOf("/contest") !== -1) return true;
    
    // Check custom contest cluster routes like /{CONTEST_CODE}/problems/... or /{CONTEST_CODE}/submit/...
    var parts = path.split("/").filter(Boolean);
    if (parts.length >= 2 && (parts[1] === "problems" || parts[1] === "submit")) {
      return true; // e.g. /mycontest/problems/TEST/
    }
    return false;
  }

  // ---------------------------------------------------------------
  // 3. Problem Metadata Extraction
  // ---------------------------------------------------------------
  function getSPOJProblemCode(pathname, form) {
    var path = pathname || window.location.pathname || "";
    var m = path.match(/\/(?:problems|submit)\/([A-Za-z0-9_]+)/i);
    if (m && m[1]) return m[1].toUpperCase();

    var statusMatch = path.match(/\/status\/([A-Za-z0-9_]+)(?:,[^/]*)?/i);
    if (statusMatch && statusMatch[1]) {
      return statusMatch[1].toUpperCase();
    }

    if (form) {
      var hidden = form.querySelector('input[name="problemCode"]');
      if (hidden && hidden.value) {
        return hidden.value.trim().toUpperCase();
      }
    }
    return null;
  }

  function getSPOJProblemTitle(problemCode) {
    try {
      var nameEl = document.getElementById("problem-name");
      if (nameEl && nameEl.textContent) {
        var t = nameEl.textContent.trim();
        if (t) return t;
      }

      var h1 = document.querySelector("h1");
      if (h1 && h1.textContent) {
        var h1Text = h1.textContent.trim();
        // Often formatted as: "TEST - Life, the Universe, and Everything"
        var codePrefixRe = new RegExp("^" + (problemCode || "") + "\\s*-\\s*", "i");
        h1Text = h1Text.replace(codePrefixRe, "").trim();
        if (h1Text) return h1Text;
      }
    } catch (_) {}
    return problemCode || "SPOJ Problem";
  }

  function getSPOJUsername() {
    try {
      // Profile link in header e.g. <a href="/users/SRT/"> or <a href="/myaccount/">
      var userLink = document.querySelector('a[href^="/users/"]');
      if (userLink) {
        var href = userLink.getAttribute("href") || "";
        var m = href.match(/\/users\/([^/]+)\/?/);
        if (m && m[1]) return m[1].trim();
        var txt = userLink.textContent.trim();
        if (txt) return txt;
      }
    } catch (_) {}
    return null;
  }

  // ---------------------------------------------------------------
  // 4. Editor Source Code Extraction
  // Priority: 1. CodeMirror v5, 2. #problem_body, 3. #subm_file, 4. fail safely
  // ---------------------------------------------------------------
  function getSPOJSourceCode(callback) {
    // 1. CodeMirror extraction
    try {
      var cmEl = document.querySelector(".CodeMirror");
      if (cmEl && cmEl.CodeMirror && typeof cmEl.CodeMirror.getValue === "function") {
        var cmVal = cmEl.CodeMirror.getValue();
        if (typeof cmVal === "string" && cmVal.trim().length > 0) {
          if (callback) callback(cmVal);
          return cmVal;
        }
      }
    } catch (_) {}

    // 2. Textarea fallback
    try {
      var ta = document.getElementById("problem_body");
      if (ta && typeof ta.value === "string" && ta.value.trim().length > 0) {
        if (callback) callback(ta.value);
        return ta.value;
      }
    } catch (_) {}

    // 3. File upload check (safe local file read for attached file only)
    try {
      var fileInput = document.getElementById("subm_file");
      if (fileInput && fileInput.files && fileInput.files.length > 0) {
        var file = fileInput.files[0];
        if (file && file.size > 0 && file.size <= MAX_CODE_LENGTH) {
          if (typeof FileReader !== "undefined") {
            var reader = new FileReader();
            reader.onload = function () {
              var result = typeof reader.result === "string" ? reader.result : "";
              if (callback) callback(result);
            };
            reader.onerror = function () {
              if (callback) callback(null);
            };
            reader.readAsText(file);
            return null; // asynchronous resolution via callback
          }
        }
      }
    } catch (_) {}

    if (callback) callback(null);
    return null;
  }

  // ---------------------------------------------------------------
  // 5. Submit Form Interception & Bridge Dispatch
  // ---------------------------------------------------------------
  function initSubmitFormHook() {
    var form = document.getElementById("problem_submit") || document.querySelector('form[action*="/submit/complete/"]');
    if (!form || form.__fly2git_hooked) return;
    form.__fly2git_hooked = true;

    form.addEventListener("submit", function (e) {
      if (isSPOJContestContext(window.location.pathname)) {
        debug("Fly2Git pauses SPOJ syncing during active contests.");
        return;
      }

      var problemCode = getSPOJProblemCode(window.location.pathname, form);
      if (!problemCode) {
        debug("Could not resolve problem code on submit");
        return;
      }

      var langSelect = form.querySelector('select#lang') || form.querySelector('select[name="lang"]');
      var langVal = langSelect ? langSelect.value : null;
      var langText = (langSelect && langSelect.selectedIndex >= 0) ? langSelect.options[langSelect.selectedIndex].text : "";
      var language = normalizeSPOJLanguage(langVal, langText);

      if (!language) {
        debug("Unsupported or unknown SPOJ language rejected safely:", langVal, langText);
        return;
      }

      var title = getSPOJProblemTitle(problemCode);
      var username = getSPOJUsername();
      var problemUrl = "https://www.spoj.com/problems/" + problemCode + "/";

      // Extract code (with synchronous priority and asynchronous FileReader fallback)
      getSPOJSourceCode(function (code) {
        if (!code || typeof code !== "string" || code.trim().length === 0) {
          debug("Submission code was empty or unreadable");
          return;
        }

        if (code.length > MAX_CODE_LENGTH) {
          debug("Submission code exceeds maximum permitted length");
          return;
        }

        var stagingPayload = {
          platform: "spoj",
          problemCode: problemCode,
          title: title,
          url: problemUrl,
          language: language,
          code: code,
          username: username,
          timestamp: Date.now(),
        };

        try {
          window.postMessage(
            {
              source: "FLY2GIT_SPOJ_INJECT",
              type: "FLY2GIT_SPOJ_STAGING",
              payload: stagingPayload,
            },
            window.location.origin
          );
          debug("Dispatched submission staging to content bridge for:", problemCode);
        } catch (err) {
          debug("Failed to dispatch staging payload:", err);
        }
      });
    }, true);
  }

  // Initialize on load and DOM readiness
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSubmitFormHook);
  } else {
    initSubmitFormHook();
  }

  // Export for testing
  var exportsObj = {
    normalizeSPOJLanguage: normalizeSPOJLanguage,
    isSPOJContestContext: isSPOJContestContext,
    getSPOJProblemCode: getSPOJProblemCode,
    getSPOJProblemTitle: getSPOJProblemTitle,
    getSPOJUsername: getSPOJUsername,
    getSPOJSourceCode: getSPOJSourceCode,
    SPOJ_NUMERIC_LANG_MAP: SPOJ_NUMERIC_LANG_MAP,
    SPOJ_STATUS_CODE_MAP: SPOJ_STATUS_CODE_MAP,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exportsObj;
  }
  if (typeof root !== "undefined") {
    root.Fly2GitSPOJInject = exportsObj;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
