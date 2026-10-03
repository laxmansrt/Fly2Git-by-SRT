// Fly2Git Backend — Pattern Normalizer (Phase 15D)
// Normalizes heterogeneous topic labels and tags from coding platforms into a controlled vocabulary.
// Invariants:
// 1. Controlled vocabulary: Recognizes standard algorithmic patterns without inventing unsupported tags.
// 2. Deterministic normalization: Same input string always produces the exact same canonical slug.
// 3. Unknown handling: Unknown or unsupported tags return null and remain unknown.

const CANONICAL_PATTERNS = Object.freeze([
  "arrays",
  "strings",
  "hashing",
  "two-pointers",
  "sliding-window",
  "binary-search",
  "sorting",
  "linked-list",
  "stack",
  "queue",
  "trees",
  "binary-tree",
  "bst",
  "heap",
  "graph",
  "bfs",
  "dfs",
  "greedy",
  "backtracking",
  "dynamic-programming",
  "bit-manipulation",
  "math",
  "prefix-sum",
  "union-find",
  "trie",
]);

// Aliases mapping to canonical slugs
const PATTERN_ALIASES = Object.freeze({
  // Arrays
  array: "arrays",
  arrays: "arrays",

  // Strings
  string: "strings",
  strings: "strings",

  // Hashing
  hash: "hashing",
  hashing: "hashing",
  "hash-table": "hashing",
  "hash table": "hashing",
  "hash-map": "hashing",
  "hash map": "hashing",
  hashmap: "hashing",
  hashtable: "hashing",

  // Two Pointers
  "two-pointer": "two-pointers",
  "two pointer": "two-pointers",
  "two-pointers": "two-pointers",
  "two pointers": "two-pointers",
  twopointers: "two-pointers",

  // Sliding Window
  "sliding-window": "sliding-window",
  "sliding window": "sliding-window",
  slidingwindow: "sliding-window",

  // Binary Search
  "binary-search": "binary-search",
  "binary search": "binary-search",
  binarysearch: "binary-search",

  // Sorting
  sort: "sorting",
  sorting: "sorting",

  // Linked List
  "linked-list": "linked-list",
  "linked list": "linked-list",
  linkedlist: "linked-list",

  // Stack
  stack: "stack",
  stacks: "stack",

  // Queue
  queue: "queue",
  queues: "queue",
  deque: "queue",

  // Trees
  tree: "trees",
  trees: "trees",

  // Binary Tree
  "binary-tree": "binary-tree",
  "binary tree": "binary-tree",
  binarytree: "binary-tree",

  // BST
  bst: "bst",
  "binary-search-tree": "bst",
  "binary search tree": "bst",

  // Heap / Priority Queue
  heap: "heap",
  heaps: "heap",
  "priority-queue": "heap",
  "priority queue": "heap",
  priorityqueue: "heap",

  // Graph
  graph: "graph",
  graphs: "graph",

  // BFS
  bfs: "bfs",
  "breadth-first-search": "bfs",
  "breadth first search": "bfs",
  "breadth-first search": "bfs",

  // DFS
  dfs: "dfs",
  "depth-first-search": "dfs",
  "depth first search": "dfs",
  "depth-first search": "dfs",

  // Greedy
  greedy: "greedy",

  // Backtracking
  backtracking: "backtracking",
  "back-tracking": "backtracking",
  backtrack: "backtracking",

  // Dynamic Programming
  dp: "dynamic-programming",
  "dynamic-programming": "dynamic-programming",
  "dynamic programming": "dynamic-programming",
  dynamicprogramming: "dynamic-programming",

  // Bit Manipulation
  "bit-manipulation": "bit-manipulation",
  "bit manipulation": "bit-manipulation",
  bits: "bit-manipulation",
  bitwise: "bit-manipulation",

  // Math
  math: "math",
  maths: "math",
  mathematics: "math",

  // Prefix Sum
  "prefix-sum": "prefix-sum",
  "prefix sum": "prefix-sum",
  prefixsum: "prefix-sum",

  // Union Find
  "union-find": "union-find",
  "union find": "union-find",
  unionfind: "union-find",
  dsu: "union-find",
  "disjoint-set": "union-find",
  "disjoint set": "union-find",

  // Trie
  trie: "trie",
  tries: "trie",
});

class PatternNormalizer {
  /**
   * Normalizes a single raw tag string to its canonical pattern slug.
   *
   * @param {string} rawTag
   * @returns {string|null} Canonical slug or null if unknown
   */
  static normalize(rawTag) {
    if (!rawTag || typeof rawTag !== "string") return null;

    const cleaned = rawTag
      .toLowerCase()
      .trim()
      .replace(/[\s_]+/g, "-") // normalize spaces and underscores to dashes for lookup
      .replace(/[^a-z0-9-]/g, ""); // strip punctuation

    if (!cleaned) return null;

    // Check alias dictionary with dashes
    if (PATTERN_ALIASES[cleaned]) {
      return PATTERN_ALIASES[cleaned];
    }

    // Also check space-separated variant
    const withSpaces = cleaned.replace(/-/g, " ");
    if (PATTERN_ALIASES[withSpaces]) {
      return PATTERN_ALIASES[withSpaces];
    }

    // Direct match against canonical patterns
    if (CANONICAL_PATTERNS.includes(cleaned)) {
      return cleaned;
    }

    // Unknown tags remain unknown
    return null;
  }

  /**
   * Normalizes a collection or list of raw tags.
   * Filters out duplicates and unknown tags.
   *
   * @param {Array<string>|string} rawTags - Array of strings or comma-separated string
   * @returns {Array<string>} Unique canonical pattern slugs
   */
  static normalizeList(rawTags) {
    if (!rawTags) return [];

    let list = [];
    if (Array.isArray(rawTags)) {
      list = rawTags;
    } else if (typeof rawTags === "string") {
      list = rawTags.split(/[,\n;|]+/);
    } else {
      return [];
    }

    const canonicalSet = new Set();
    for (const item of list) {
      const canonical = PatternNormalizer.normalize(item);
      if (canonical) {
        canonicalSet.add(canonical);
      }
    }

    return Array.from(canonicalSet).sort();
  }

  /**
   * Checks whether a tag is already a canonical pattern slug.
   *
   * @param {string} tag
   * @returns {boolean}
   */
  static isCanonical(tag) {
    if (!tag || typeof tag !== "string") return false;
    return CANONICAL_PATTERNS.includes(tag.toLowerCase().trim());
  }

  /**
   * Returns list of all supported canonical pattern identifiers.
   *
   * @returns {Array<string>}
   */
  static getCanonicalPatterns() {
    return [...CANONICAL_PATTERNS];
  }
}

module.exports = {
  PatternNormalizer,
  CANONICAL_PATTERNS,
  PATTERN_ALIASES,
};
