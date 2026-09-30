// Fly2Git -- by SRT
// LeetCode adapter (v1.1.6)
//
// Detection strategy:
// 1. Primary: observe the Accepted result panel and query LeetCode GraphQL
//    for the newest Accepted submission for the current problem.
// 2. Secondary: poll the same GraphQL submission list while the problem page
//    is open. This catches UI changes where the result panel selector moves.
// 3. Fallback: intercept the legacy REST submit/check flow when available.
//
// No GitHub credentials are handled here.
(function () {
  "use strict";

  if (!window.location.hostname.endsWith("leetcode.com")) return;
  if (window.__FLY2GIT_LEETCODE_INJECT_INITIALIZED__) return;
  window.__FLY2GIT_LEETCODE_INJECT_INITIALIZED__ = true;

  const nativeFetch = window.fetch.bind(window);

  console.log("[Fly2Git] v1.1.6 LeetCode detector loaded", window.location.href);

  var DEBUG = true;
  var POLL_MS = 5000;
  var DETAIL_RETRIES = 8;
  var DETAIL_RETRY_MS = 1200;

  var pendingRest = new Map();
  var emittedSubmissionIds = new Set();
  var initializedBySlug = new Map();
  var lastPath = { value: window.location.pathname };
  var pollTimer = null;
  var acceptedObserver = null;
  var pollInFlight = false;
  var currentSlug = null;

  function log() {
    if (!DEBUG) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[Fly2Git][LeetCode]");
    console.log.apply(console, args);
  }

  function warn() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[Fly2Git][LeetCode]");
    console.warn.apply(console, args);
  }

  function getSlug() {
    var match = window.location.pathname.match(/^\/problems\/([^/]+)/);
    return match ? match[1] : null;
  }

  function getCsrfToken() {
    var match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function graphql(query, variables, operationName) {
    var csrf = getCsrfToken();
    var url = window.location.origin + "/graphql/";

    log("GraphQL request", { operationName: operationName, url: url, variables: variables });

    return new Promise(function (resolve, reject) {
      var headers = {
        "Content-Type": "application/json",
        "Accept": "application/json"
      };
      if (csrf) { headers["x-csrftoken"] = csrf; }

      nativeFetch(url, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        mode: "same-origin",
        headers: headers,
        body: JSON.stringify({ query: query, variables: variables, operationName: operationName })
      }).then(function (response) {
        log("GraphQL HTTP", operationName, response.status);
        return response.text().then(function (text) {
          var json;
          try { json = JSON.parse(text); } catch (e) {
            return reject(new Error("GraphQL returned non-JSON (" + response.status + "): " + text.slice(0, 300)));
          }
          if (!response.ok) {
            return reject(new Error("GraphQL HTTP " + response.status + ": " + text.slice(0, 300)));
          }
          if (json.errors && json.errors.length) {
            return reject(new Error(json.errors.map(function (e) { return e.message; }).join("; ")));
          }
          resolve(json.data);
        });
      }).catch(function (error) {
        warn("GraphQL network request failed", { operationName: operationName, message: error && error.message, url: url });
        reject(error);
      });
    });
  }

  function fetchQuestion(slug) {
    var query = [
      "query questionDetail($titleSlug: String!) {",
      "  question(titleSlug: $titleSlug) {",
      "    questionFrontendId",
      "    title",
      "    titleSlug",
      "    difficulty",
      "  }",
      "}"
    ].join("\n");
    return graphql(query, { titleSlug: slug }, "questionDetail").then(function (data) {
      return (data && data.question) ? data.question : null;
    });
  }

  function fetchLatestAccepted(slug) {
    // Do not rely on LeetCode server-side status filter.
    // Some sessions return empty list even when the page shows Accepted.
    // Fetch recent submissions and filter client-side instead.
    var query = [
      "query submissions($offset: Int!, $limit: Int!, $lastKey: String, $questionSlug: String!) {",
      "  submissionList(offset: $offset, limit: $limit, lastKey: $lastKey, questionSlug: $questionSlug) {",
      "    lastKey",
      "    hasNext",
      "    submissions {",
      "      id",
      "      statusDisplay",
      "      lang",
      "      timestamp",
      "      isPending",
      "    }",
      "  }",
      "}"
    ].join("\n");

    return graphql(query, { offset: 0, limit: 20, lastKey: null, questionSlug: slug }, "submissions")
      .then(function (data) {
        var result = data && data.submissionList;
        var submissions = Array.isArray(result && result.submissions) ? result.submissions : [];

        log("Submission list result", {
          count: submissions.length,
          hasNext: !!(result && result.hasNext),
          latest: submissions[0] || null
        });

        var accepted = null;
        for (var i = 0; i < submissions.length; i++) {
          var s = submissions[i];
          var status = String(s.statusDisplay || "").toLowerCase();
          var pending = String(s.isPending != null ? s.isPending : "").toLowerCase();
          var isActuallyPending = pending === "true" || pending === "pending";
          if (status === "accepted" && !isActuallyPending) {
            accepted = s;
            break;
          }
        }

        log("Latest accepted from GraphQL", accepted ? accepted.id : "none");
        return accepted || null;
      });
  }

  function fetchSubmissionDetails(submissionId) {
    var query = [
      "query submissionDetails($submissionId: Int!) {",
      "  submissionDetails(submissionId: $submissionId) {",
      "    id",
      "    code",
      "    timestamp",
      "    statusCode",
      "    statusDisplay",
      "    lang { name verboseName }",
      "    question {",
      "      questionId",
      "      questionFrontendId",
      "      title",
      "      titleSlug",
      "      difficulty",
      "    }",
      "  }",
      "}"
    ].join("\n");
    return graphql(query, { submissionId: Number(submissionId) }, "submissionDetails")
      .then(function (data) {
        return (data && data.submissionDetails) ? data.submissionDetails : null;
      });
  }

  function waitForSubmissionDetails(submissionId) {
    var attempt = 0;
    function tryOnce() {
      return fetchSubmissionDetails(submissionId).then(function (details) {
        if (details && details.code && details.question) return details;
        attempt++;
        if (attempt >= DETAIL_RETRIES) {
          throw new Error("Submission details are not ready yet.");
        }
        return new Promise(function (resolve) {
          setTimeout(function () { resolve(tryOnce()); }, DETAIL_RETRY_MS);
        });
      }).catch(function (err) {
        attempt++;
        if (attempt >= DETAIL_RETRIES) throw err;
        return new Promise(function (resolve) {
          setTimeout(function () { resolve(tryOnce()); }, DETAIL_RETRY_MS);
        });
      });
    }
    return tryOnce();
  }

  function normalizeLanguage(details, fallback) {
    return (
      (details && details.lang && (details.lang.verboseName || details.lang.name)) ||
      fallback || "unknown"
    ).toLowerCase();
  }

  function normalizeTitle(details, slug) {
    return (
      (details && details.question && details.question.title) ||
      document.title.replace(/\s*-\s*LeetCode.*$/i, "").trim() ||
      slug
    );
  }

  function emitAccepted(submission, slug) {
    var submissionId = String(submission.id);
    if (!submissionId || emittedSubmissionIds.has(submissionId)) {
      return Promise.resolve();
    }

    log("Accepted submission detected", submissionId, slug);

    return waitForSubmissionDetails(submissionId).then(function (details) {
      if (!details || !details.code) {
        throw new Error("Accepted submission has no solution code.");
      }

      emittedSubmissionIds.add(submissionId);
      if (emittedSubmissionIds.size > 100) {
        emittedSubmissionIds.delete(emittedSubmissionIds.values().next().value);
      }

      var question = details.question || {};
      var title = normalizeTitle(details, slug);
      var difficulty = question.difficulty || "Unknown";
      var lang = normalizeLanguage(details, submission.lang);
      var problemSlug = question.titleSlug || slug;

      window.postMessage(
        {
          source: "fly2git-leetcode",
          type: "ACCEPTED",
          payload: {
            lang: lang,
            code: details.code,
            slug: problemSlug,
            title: title,
            difficulty: difficulty,
            url: "https://leetcode.com/problems/" + problemSlug + "/",
            submissionId: submissionId
          }
        },
        window.location.origin
      );

      log("Accepted solution forwarded", { submissionId: submissionId, slug: slug, lang: lang });
    });
  }

  function initializeSlug(slug) {
    if (!slug) return Promise.resolve();
    if (currentSlug !== slug) {
      currentSlug = slug;
      pollInFlight = false;
      log("Problem route", slug);
    }
    return fetchLatestAccepted(slug).then(function (latest) {
      initializedBySlug.set(slug, (latest && latest.id) ? String(latest.id) : null);
      log("Baseline accepted submission", latest ? latest.id : "none");
    }).catch(function (error) {
      warn("Could not initialize GraphQL baseline", error);
    });
  }

  function pollAccepted() {
    var slug = getSlug();
    if (!slug || document.visibilityState === "hidden" || pollInFlight) return;
    pollInFlight = true;

    var p;
    if (slug !== currentSlug) {
      p = initializeSlug(slug);
    } else {
      p = fetchLatestAccepted(slug).then(function (latest) {
        var latestId = (latest && latest.id != null) ? String(latest.id) : null;
        var baseline = initializedBySlug.get(slug);

        log("Submission comparison", { latestId: latestId, baseline: baseline });

        if (!latestId) return;
        if (baseline == null) { initializedBySlug.set(slug, latestId); return; }
        if (latestId !== baseline) {
          initializedBySlug.set(slug, latestId);
          return emitAccepted(latest, slug);
        }
      });
    }

    p.catch(function (error) {
      warn("GraphQL submission poll failed", error);
    }).then(function () {
      pollInFlight = false;
    });
  }

  function checkAcceptedPanel() {
    var panels = document.querySelectorAll("[data-e2e-locator='submission-result']");
    for (var i = 0; i < panels.length; i++) {
      var panel = panels[i];
      if (panel.textContent && panel.textContent.trim() === "Accepted") {
        log("Accepted panel detected");
        pollAccepted();
        return;
      }
    }
  }

  function startObservers() {
    if (!document.body) {
      setTimeout(startObservers, 100);
      return;
    }

    acceptedObserver = new MutationObserver(function () {
      checkAcceptedPanel();
    });
    acceptedObserver.observe(document.body, { childList: true, subtree: true });

    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      if (window.location.pathname !== lastPath.value) {
        lastPath.value = window.location.pathname;
        var slug = getSlug();
        currentSlug = null;
        if (slug) initializeSlug(slug);
      }
      pollAccepted();
    }, POLL_MS);

    var slug = getSlug();
    if (slug) initializeSlug(slug);
    log("LeetCode adapter loaded");
  }

  // Legacy REST fallback. Retained because some LeetCode sessions
  // still expose the old submit/check endpoints.
  try {
    var originalFetch = window.fetch;
    window.fetch = function () {
      var args = Array.prototype.slice.call(arguments);
      var resource = args[0];
      var config = args[1];
      var url = typeof resource === "string" ? resource : ((resource && resource.url) || "");
      var captured = null;

      if (config && config.method === "POST" && url.indexOf("/submit/") !== -1) {
        try {
          var body = JSON.parse(config.body);
          captured = { lang: body.lang || body.lang_slug, code: body.typed_code };
          log("Legacy submit request observed");
        } catch (_) {}
      }

      return originalFetch.apply(this, args).then(function (response) {
        if (captured) {
          response.clone().json().then(function (data) {
            if (data && data.submission_id != null) {
              pendingRest.set(String(data.submission_id), captured);
            }
          }).catch(function () {});
        }

        var checkMatch = url.match(/\/submissions\/detail\/(\d+)\/check\//);
        if (checkMatch) {
          var submissionId = checkMatch[1];
          response.clone().json().then(function (data) {
            if (data && data.state === "SUCCESS" && data.status_msg === "Accepted") {
              var capturedSubmission = pendingRest.get(submissionId);
              if (capturedSubmission) {
                pendingRest.delete(submissionId);
                emitAccepted(
                  { id: submissionId, lang: capturedSubmission.lang, statusDisplay: "Accepted" },
                  getSlug()
                );
              } else {
                pollAccepted();
              }
            }
          }).catch(function () {});
        }

        return response;
      });
    };
  } catch (error) {
    warn("Could not install legacy fetch fallback", error);
  }

  startObservers();
})();
