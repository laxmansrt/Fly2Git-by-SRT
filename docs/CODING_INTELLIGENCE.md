# Fly2Git — Coding Intelligence (Phase 15D)

## 1. Overview & Product Philosophy

Fly2Git Coding Intelligence builds an objective, structured representation of the developer's coding practice history using sync metadata and normalized topic tags.

### Core Questions Answered
- What algorithmic patterns have I practiced?
- How has my practice cadence and pattern focus changed over time?
- Which programming languages do I use for different problem types?
- Which platforms do I turn to for specific patterns?
- Which algorithmic concepts frequently appear together in my history?
- Which patterns have low observed activity in my recent practice?
- When viewing a problem on a platform, how does it connect to my past practice?

### Pure Observation & Navigation (Zero Scoring Policy)
Coding Intelligence is strictly an observation and navigation tool. It adheres to an uncompromised product invariant:
- **NO skill scores** (no 0-100 scores, no ratings)
- **NO developer ratings**
- **NO IQ scores**
- **NO employability scores or hireability ratings**
- **NO interview success probabilities**
- **NO rankings against other users or percentiles**
- **NO demeaning judgment or weakness labels**

---

## 2. Controlled Vocabulary & Pattern Normalization

The system normalizes arbitrary tags and platform labels into 25 canonical patterns:

| Canonical Pattern | Example Aliases Mapped |
|---|---|
| `arrays` | `array`, `arrays` |
| `strings` | `string`, `strings` |
| `hashing` | `hash-map`, `hash table`, `hashtable`, `hash` |
| `two-pointers` | `two-pointer`, `two pointer`, `twopointers` |
| `sliding-window` | `sliding window`, `slidingwindow` |
| `binary-search` | `binary search`, `binarysearch` |
| `sorting` | `sort`, `sorting` |
| `linked-list` | `linked list`, `linkedlist` |
| `stack` | `stacks` |
| `queue` | `queues`, `deque` |
| `trees` | `tree` |
| `binary-tree` | `binary tree`, `binarytree` |
| `bst` | `binary-search-tree`, `binary search tree` |
| `heap` | `heaps`, `priority-queue`, `priority queue` |
| `graph` | `graphs` |
| `bfs` | `breadth-first-search`, `breadth first search` |
| `dfs` | `depth-first-search`, `depth first search` |
| `greedy` | `greedy` |
| `backtracking` | `back-tracking`, `backtrack` |
| `dynamic-programming` | `dp`, `dynamic programming`, `dynamicprogramming` |
| `bit-manipulation` | `bit manipulation`, `bitwise`, `bits` |
| `math` | `maths`, `mathematics` |
| `prefix-sum` | `prefix sum`, `prefixsum` |
| `union-find` | `union find`, `dsu`, `disjoint-set` |
| `trie` | `tries` |

**Invariant**: Unsupported or unknown tags return `null` and remain unknown. The system never invents tags.

---

## 3. Data Model & Aggregations

### Pattern Activity
```json
{
  "pattern": "hashing",
  "count": 18,
  "firstSeen": 1759000000000,
  "lastSeen": 1759900000000,
  "platforms": ["leetcode", "geeksforgeeks"],
  "languages": ["python", "java"],
  "difficulties": {
    "Easy": 4,
    "Medium": 11,
    "Hard": 3,
    "Unknown": 0
  }
}
```

### Coding Journey Timeline
Groups activity by month (`YYYY-MM`) sorted chronologically:
```json
[
  {
    "period": "2026-08",
    "dominantPatterns": ["arrays", "hashing"],
    "platforms": ["leetcode"],
    "languages": ["java"],
    "count": 14
  },
  {
    "period": "2026-09",
    "dominantPatterns": ["trees", "graph"],
    "platforms": ["leetcode", "codeforces"],
    "languages": ["java", "cpp"],
    "count": 22
  }
]
```

### Pattern Relationships (Empirical Co-occurrence)
```json
[
  {
    "patternA": "arrays",
    "patternB": "hashing",
    "coOccurrenceCount": 14
  }
]
```

### Recent Pattern Shifts
Compares the recent window (last 30 days) against the previous equivalent window (30-60 days ago):
- Allowed labels: `increased`, `decreased`, `stable`, `new`, `inactive`.
```json
{
  "pattern": "graph",
  "recentCount": 12,
  "previousCount": 3,
  "direction": "increased"
}
```

### Deterministic Exploration Candidates
```json
[
  {
    "type": "low_recent_activity",
    "pattern": "sliding-window",
    "evidence": "Observed 8 times historically, but 0 in the recent 30-day period.",
    "reason": "Opportunity to revisit this pattern if desired."
  },
  {
    "type": "new_pattern",
    "pattern": "dynamic-programming",
    "evidence": "First observed 3 times in the recent period with no prior activity.",
    "reason": "Recently introduced pattern in practice history."
  }
]
```

---

## 4. Privacy Boundaries & Data Minimization

1. **No Code in Storage**: Source code is never retained in analytics or intelligence databases.
2. **Sanitized Metadata Only**: Intelligence aggregates counts, platforms, languages, difficulties, and normalized pattern slugs.
3. **No Credential Exposure**: Provider API keys reside exclusively on the backend server.
4. **No Invasive Surveillance**: Zero tracking of browser history, cookies, keystrokes, or page DOM.

---

## 5. User Data Deletion

Invoking `DELETE /api/intelligence/data` or `DELETE /api/analytics`:
- Immediately deletes all user topic tags and derived intelligence data.
- Leaves GitHub repositories, commits, account identity, and billing unchanged.

---

## 6. API Contracts

### `GET /api/intelligence/patterns`
- **Auth**: Bearer JWT.
- **Entitlement**: Basic gets top 3 preview (`preview: true`, `isPro: false`). Pro / Pro Grants get full patterns (`preview: false`, `isPro: true`). Expired accounts receive HTTP 403 `ENTITLEMENT_EXPIRED`.
- **Response**:
```json
{
  "ok": true,
  "patterns": [...],
  "totalObserved": 18,
  "period": "all",
  "isPro": true,
  "preview": false
}
```

### `GET /api/intelligence/journey`
- **Query params**: `range` (e.g. `all`, `30d`), `tz` (timezone offset in minutes).
- **Response**:
```json
{
  "ok": true,
  "journey": [...],
  "range": "all",
  "isPro": true,
  "preview": false
}
```

### `POST /api/intelligence/problem-context`
- **Input**:
```json
{
  "platform": "leetcode",
  "problemSlug": "course-schedule",
  "title": "Course Schedule",
  "difficulty": "Medium",
  "topics": ["Graph", "BFS"]
}
```
- **Response**:
```json
{
  "ok": true,
  "currentProblem": {
    "platform": "leetcode",
    "problemSlug": "course-schedule",
    "title": "Course Schedule",
    "difficulty": "Medium",
    "patterns": ["bfs", "graph"]
  },
  "observedHistory": {
    "patterns": [
      { "pattern": "bfs", "observedCount": 5 },
      { "pattern": "graph", "observedCount": 8 }
    ],
    "totalProblemMatches": 11
  },
  "relatedPatterns": [
    { "pattern": "dfs", "coOccurrenceCount": 6 }
  ],
  "platformHistory": {
    "currentPlatformCount": 7,
    "otherPlatformsCount": 4,
    "platforms": ["leetcode", "codeforces"]
  },
  "languageHistory": {
    "java": 7,
    "python": 4
  }
}
```

### `POST /api/intelligence/explain`
- **Input**: `{ userQuestion: "How has my pattern focus shifted?", range: "30d" }`
- **Output**:
```json
{
  "ok": true,
  "success": true,
  "summary": "Observed coding practice history shows focused activity in arrays with diversified problem exposure.",
  "observations": [
    "arrays: 4 observed problems across leetcode, geeksforgeeks."
  ],
  "relatedPatterns": ["hashing", "sorting"],
  "recentChanges": ["Recent activity shifted toward dynamic-programming (new)."],
  "suggestedExploration": [
    "Your recent history contains fewer observed problems involving sliding-window. Exploring introductory problems could broaden pattern exposure."
  ],
  "confidence": "high",
  "totalObserved": 18
}
```

### `DELETE /api/intelligence/data`
- Clears derived user intelligence data and topic tags.
