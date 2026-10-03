# Fly2Git by SRT — Design System

> **Developer Intelligence Cockpit**  
> "Your Coding Practice OS"  
> **Phase 16.1: Obsidian × Sand × Deep Blue Visual Theme**

This document defines the visual identity, design token architecture,
component system, and accessibility standards for the Fly2Git by SRT
Chrome Extension premium experience.

---

## 1. Product Identity

| Attribute        | Value                                            |
|------------------|--------------------------------------------------|
| **Product**      | Fly2Git by SRT                                   |
| **Concept**      | Your Coding Practice OS                          |
| **Surface**      | Chrome Extension Popup (390 × 600 max)           |
| **Theme**        | Obsidian × Sand × Deep Blue Developer Cockpit    |
| **Atmosphere**   | Calm, mature, cinematic, tactile technical depth |
| **Design File**  | `design-tokens.css`                              |

---

## 2. Design Tokens

All visual decisions are expressed as CSS custom properties (tokens) in
[`design-tokens.css`](../design-tokens.css). Components reference tokens,
never arbitrary hardcoded values.

### 2.1 Color System

The palette pairs a dominant Obsidian/Charcoal foundation with Warm Sand/Champagne metallic highlights and Muted Deep Blue technical context.

```css
/* Base Obsidian Environment */
--color-bg:               #171719;        /* Dominant canvas */
--color-bg-deep:          #101113;        /* Deep spatial layer */
--color-surface:          #222325;        /* Standard charcoal surface */
--color-surface-elevated: #2A2B2E;        /* Elevated card surface */
--color-background:       var(--color-bg);

/* Sand / Champagne Metallic Warmth (Primary Accent) */
--color-sand:             #D8B98A;        /* Primary accent / selected controls */
--color-sand-light:       #E8CFA8;        /* Hover / active highlights */
--color-sand-muted:       #BFA77D;        /* Secondary accent text */

/* Deep Blue Technical Context (Secondary Accent) */
--color-deep-blue:        #40566B;        /* Context containers, technical metadata */
--color-blue-light:       #61778B;        /* Technical labels, links */

/* Borders & Dividers */
--color-border:           rgba(232, 207, 168, 0.14); /* Subtle sand-tinted border */
--color-border-subtle:    rgba(232, 207, 168, 0.08);
--color-border-strong:    rgba(232, 207, 168, 0.28);
--color-border-focus:     var(--color-sand);

/* Glass Base Tiers */
--color-glass:            rgba(255, 255, 255, 0.055);
--color-glass-strong:     rgba(255, 255, 255, 0.085);
```

**Text Hierarchy:**

| Token                    | Hex       | Usage                                |
|--------------------------|-----------|--------------------------------------|
| `--color-text-primary`   | `#F3F0EA` | High-contrast warm headlines, values |
| `--color-text-secondary` | `#AAA49A` | Neutral body text, descriptions      |
| `--color-text-muted`     | `#77736C` | Captions, metadata, inactive labels  |

**Semantic Colors (Strict & Restrained):**

| Token             | Hex       | Usage                                 |
|-------------------|-----------|---------------------------------------|
| `--color-success` | `#34d399` | Natural green: GitHub sync, success   |
| `--color-warning` | `#e0a352` | Muted amber: warnings, attention      |
| `--color-danger`  | `#e57373` | Restrained red: errors, failures      |

**Accent Mapping:**

| Token                  | Value                     | Usage                             |
|------------------------|---------------------------|-----------------------------------|
| `--color-accent`       | `var(--color-sand)`       | Primary controls, focus indicator |
| `--color-accent-hover` | `var(--color-sand-light)` | Hovered active controls           |
| `--color-accent-subtle`| `rgba(216, 185, 138, 0.14)`| Warm tinted backgrounds          |
| `--color-accent-glow`  | `rgba(216, 185, 138, 0.24)`| Gentle ambient glow              |

### 2.2 Platform Brand Accents

Restrained brand colors for genuine platform indicators:

| Platform       | Token                      | Hex       |
|----------------|----------------------------|-----------|
| LeetCode       | `--color-leetcode`         | `#ffa116` |
| GeeksforGeeks  | `--color-geeksforgeeks`    | `#2f8d46` |
| HackerRank     | `--color-hackerrank`       | `#2ec866` |
| CodeChef       | `--color-codechef`         | `#9b6b43` |
| Codeforces     | `--color-codeforces`       | `#318ce7` |
| AtCoder        | `--color-atcoder`          | `#404040` |
| SPOJ           | `--color-spoj`             | `#004b7c` |

---

## 3. Glass System (4-Tier)

The UI uses four intentional, bounded glass surface tiers to create spatial depth.
Translucent charcoal surfaces with sand-tinted borders and restrained blurs:

### Tier Map

| Tier     | Class     | Blur   | Usage                                      |
|----------|-----------|--------|--------------------------------------------|
| Glass 01 | `.glass-01` | 6px  | Chips, passive containers, navigation bar  |
| Glass 02 | `.glass-02` | 14px | Cards, tabs, bento tiles, content surfaces |
| Glass 03 | `.glass-03` | 18px | Active problem hero card, highlighted panels|
| Glass 04 | `.glass-04` | 24px | Modals, overlays, Pro upgrade sheet        |

### Token Naming Convention

Each tier follows the pattern:
```
--glass-{N}-bg
--glass-{N}-border
--glass-{N}-shadow
--glass-{N}-backdrop
```

### Usage Rules

1. **Do not exceed 4 tiers.** All surfaces map directly to a tier.
2. **Glass 02 is default.** Content cards use `.glass-02`.
3. **Glass 03 is reserved for the Hero state** (Current Problem card).
4. **Glass 04 is for modals only.**
5. Both `backdrop-filter` and `-webkit-backdrop-filter` are declared.

---

## 4. Typography Scale

System fonts prioritize legibility at small extension sizes with calm, mature weights.

### Font Stacks

```css
--font-family-system: -apple-system, BlinkMacSystemFont, "SF Pro Text",
  "SF Pro Display", "Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;

--font-family-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo,
  Consolas, "Liberation Mono", monospace;
```

### Type Scale

| Style      | Class           | Size   | Weight | Line   | Letter   | Use                           |
|------------|-----------------|--------|--------|--------|----------|-------------------------------|
| Display    | `.type-display`  | 15px   | 600    | 1.25   | -0.015em | Hero values, card titles      |
| Headline   | `.type-headline` | 13.5px | 600    | 1.3    | -0.01em  | Section headers               |
| Section    | `.type-section`  | 10.5px | 600    | 1.35   | 0.06em   | Eyebrow labels (uppercase)    |
| Body       | `.type-body`     | 12.5px | 400    | 1.45   | 0        | Primary content text          |
| Caption    | `.type-caption`  | 11px   | 400    | 1.4    | 0.01em   | Secondary descriptions        |
| Metadata   | `.type-metadata` | 10px   | 500    | 1.3    | 0.03em   | Timestamps, counts, stats     |
| Numeric    | `.type-numeric`  | 16px   | 600    | 1.15   | —        | Instrument values (monospace) |

---

## 5. Spacing Scale & Border Radii

Strict 8-point spatial rhythm with restrained border rounding:

| Token       | Value  |
|-------------|--------|
| `--space-1` | 4px    |
| `--space-2` | 8px    |
| `--space-3` | 12px   |
| `--space-4` | 16px   |
| `--space-5` | 20px   |
| `--space-6` | 24px   |
| `--space-7` | 32px   |
| `--space-8` | 40px   |

### Border Radii Hierarchy

| Token          | Value  | Usage                        |
|----------------|--------|------------------------------|
| `--radius-xs`  | 4px    | Tiny chips, inline badges    |
| `--radius-sm`  | 8px    | Buttons, small pills         |
| `--radius-md`  | 12px   | Standard cards, nav bars     |
| `--radius-lg`  | 16px   | Hero cards, large dialogs    |
| `--radius-xl`  | 20px   | Hero spatial containers      |
| `--radius-pill` | 9999px | Status pills, badges         |

---

## 6. Motion & Micro-Interactions

Fast, tactile, calm transitions (120–220ms). No bouncy or continuous animation.

| Token                | Duration | Curve                         | Usage                         |
|----------------------|----------|-------------------------------|-------------------------------|
| `--motion-fast`      | 140ms    | `cubic-bezier(0.16, 1, 0.3, 1)` | Hover states, tab switches  |
| `--motion-smooth`    | 200ms    | `cubic-bezier(0.16, 1, 0.3, 1)` | Panel transitions, reveals  |
| `--motion-deliberate`| 280ms    | `cubic-bezier(0.16, 1, 0.3, 1)` | Modal open/close            |

### Ambient Atmosphere

The canvas background uses a charcoal foundation with soft warm sand light entering from the upper left and a subtle deep-blue secondary field on the bottom right (`--canvas-ambient`).

---

## 7. Component Architecture

### 7.1 Cockpit Navigation

A 4-tab navigation bar (`#cockpitNav`) at the top of the active cockpit view.

| Tab       | Panel ID            | Content                              |
|-----------|---------------------|--------------------------------------|
| Home      | `tabPanelHome`      | Problem hero, bento, AI, sync banner |
| Journey   | `tabPanelJourney`   | Coach, Intelligence, Analytics       |
| Sync      | `tabPanelSync`      | Repository, platforms, automation    |
| Settings  | `tabPanelSettings`  | Plan, entitlements, identity         |

**Refined Behavior:**
- Quiet, understated navigation bar in translucent charcoal.
- Active state uses subtle glass elevation and a tiny warm sand indicator pip (`.nav-active-pip`).
- WAI-ARIA tablist/tab/tabpanel markup with ArrowLeft/ArrowRight, Home, and End keyboard navigation.

### 7.2 Current Problem Hero Card

The visual anchor and primary interaction point:
- Deep charcoal glass with warm sand edge highlight.
- Subdued platform pill with deep-blue technical context.
- Quick intelligence shortcuts: `[ Analyze ] [ Explain ] [ Hint ]`.

### 7.3 Bento Metrics Grid

2×2 activity telemetry grid showing practice activity, active platform count, streak, and reliability.

### 7.4 AI Visual Language

- Zero purple cliches, zero neon, zero robot emojis.
- Integrated intelligence surface with warm sand accents, subtle glass, and technical labels.
- Hint depth selection pills using deep-blue technical markers.

### 7.5 Buttons

Physical glass controls:
- **Primary:** Dark glass + warm sand accent (`linear-gradient` with sand border).
- **Secondary:** Translucent charcoal with subtle sand-tinted border.
- **Tertiary:** Clean ghost/text control.

---

## 8. Accessibility

- ARIA tablist/tab/tabpanel pattern fully implemented.
- Focus outlines in soft warm sand (`rgba(216, 185, 138, 0.6)`).
- Reduced motion: `prefers-reduced-motion: reduce` completely zeroes animation and transition durations.
- Contrast: `#F3F0EA` on `#171719` exceeds 12:1 contrast ratio (WCAG AAA).

---

## 9. File Map

| File               | Purpose                                           |
|--------------------|---------------------------------------------------|
| `design-tokens.css` | Central Obsidian, Sand, Deep Blue token system    |
| `popup.css`        | Component styles, cockpit layouts, buttons, glass  |
| `popup.html`       | Cockpit HTML structure and semantic markup        |
| `popup.js`         | Navigation logic, state management, rendering     |
| `manifest.json`    | Chrome extension manifest (references popup.html) |
