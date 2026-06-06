---
name: LINE Fleet Monitor
description: Internal admin + ops monitoring tool for LINE Channel quota/webhook health and cold-chain IoT telemetry.
colors:
  primary: "#3d8a5f"
  primary-soft: "#e6f0ea"
  primary-ink: "#1a3d2a"
  neutral-bg: "#fafafa"
  neutral-surface: "#ffffff"
  neutral-border: "#e7e7e7"
  neutral-ink: "#1a1a1a"
  state-online: "#10b981"
  state-delayed: "#f59e0b"
  state-offline: "#f43f5e"
  state-unknown: "#94a3b8"
  state-frozen: "#0ea5e9"
typography:
  display:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 500
    lineHeight: 1.4
  body:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.01em"
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral-surface}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-ink}"
  badge-state-online:
    backgroundColor: "oklch(95% 0.05 160)"
    textColor: "oklch(40% 0.12 160)"
    rounded: "{rounded.sm}"
  badge-state-offline:
    backgroundColor: "oklch(95% 0.05 15)"
    textColor: "oklch(45% 0.18 15)"
    rounded: "{rounded.sm}"
---

# Design System: LINE Fleet Monitor

## 1. Overview

**Creative North Star: "The Quiet Workshop."**

LINE Fleet Monitor is a tool two very different people live in: a LINE OA admin who scans it ten times a day, and a lab/operations staff member who opens the public share page once per shift to check a fridge. Neither wants to be impressed. They want to know the truth in under three seconds.

The system earns its place by being useful first, friendly second, beautiful last. Friendly means warm, rounded, legible on a phone screen in mixed lighting. It does not mean playful, decorated, or soft-headed. The visual restraint is the point: a tool that shouts for attention has already lost the user's trust.

This product explicitly rejects the saturated AI default of 2026 (flat blue/violet monochrome), the SaaS landing-page vocabulary (hero metrics, glass cards, gradient text, eyebrow labels above every section), and the dated Thai enterprise look (warm gray with one dull accent, circa 2018). It also resists the terminal/hacker aesthetic that telemetry products often reach for. Operators here are not engineers running a NOC.

**Key Characteristics:**
- Restrained. Neutral surfaces dominate, brand color earns its place.
- One family, all weights. Geist Variable across display, headline, body, and labels.
- Soft geometry (10px base radius) on the chrome, crisp data values on the reading.
- State colors are semantic, not decorative. Every color means something specific.
- WCAG AA on every state indicator, with redundant icon + text labels.

## 2. Colors

The palette is a quiet neutral base with one brand-leaning green and a small, deliberate state vocabulary. Neutrals are warm-tinted (chroma 0.005-0.015 toward the brand hue) so the surface and the brand feel like family, not strangers.

### Primary
- **Workshop Green** (`#3d8a5f` / `oklch(52% 0.10 155)`): The brand voice. Used for primary CTAs, current selection, and the rare brand moment. Never used for state. Affinity with Line's green without impersonating it.
- **Workshop Green Soft** (`#e6f0ea` / `oklch(95% 0.02 155)`): Tinted surface for selected nav rows, primary-button hover halos, and the lightest possible brand wash.
- **Workshop Green Ink** (`#1a3d2a` / `oklch(28% 0.08 155)`): Pressed/active state of the primary, and the dark text-on-light variant for high-contrast brand headers.

### Neutral
- **Page** (`#fafafa` / `oklch(98% 0.005 155)`): Body background. Warm-tinted toward brand hue at very low chroma, not the AI cream/sand giveaway.
- **Surface** (`#ffffff` / `oklch(100% 0 0)`): Cards, dialogs, popovers. True white so data values pop against it.
- **Border** (`#e7e7e7` / `oklch(91% 0.005 155)`): Hairline dividers, card outlines, input strokes.
- **Ink** (`#1a1a1a` / `oklch(15% 0 0)`): Primary text. High contrast, true near-black, not a tinted gray.
- **Muted Ink** (auto-derived from Ink at ~55% lightness): Secondary text, captions, helper copy.

### State (semantic only; never used for decoration)
- **Online** (`#10b981` / `oklch(72% 0.16 160)`): Device / webhook healthy. Paired with `CheckCircle` icon and the text "Online".
- **Delayed** (`#f59e0b` / `oklch(76% 0.16 75)`): Warning-adjacent state, beats slowly. Paired with `AlertTriangle` and "Delayed".
- **Offline** (`#f43f5e` / `oklch(65% 0.22 18)`): Hard failure. Paired with `XCircle` and "Offline".
- **Unknown** (`#94a3b8` / `oklch(70% 0.02 240)`): No data yet / no device registered. Paired with `Activity` and "Unknown". Distinct from offline so the user can tell the difference.
- **Frozen** (`#0ea5e9` / `oklch(70% 0.14 220)`): Reserved for sub-zero temperature readings. Paired with `Snowflake`. Not a state of the device; a state of the reading.

### Named Rules

**The One Voice Rule.** Brand green is used on ≤10% of any given screen. Its rarity is the point. If a screen feels "green", the accent has bled into the state vocabulary, which is a bug.

**The State Has No Brand Rule.** State colors (emerald/amber/rose/sky/gray) are never replaced by brand green even when green would look nicer. State means what it means; consistency beats aesthetics.

**The Real Numbers Rule.** Background, surface, and ink are all near-true neutral (chroma ≤ 0.015) so the data values, which carry the chroma, are the loudest thing on the page.

## 3. Typography

**Display / Headline / Body / Label Font:** Geist Variable, sans-serif (with system fallback).

**Character:** A single tuned family. Soft humanist sans with a wide weight range (300-700) and a slightly compressed x-height. It reads friendly at body sizes, confident at display sizes, and never feels decorative. We resist the urge to pair a display serif; product UI doesn't need the contrast and the extra family costs legibility on small labels.

### Hierarchy
- **Display** (600, 2.25rem / 36px, line-height 1.2, tracking -0.02em): Reserved for page-level headers (e.g. dashboard h1). Not used in cards.
- **Headline** (600, 1.5rem / 24px, line-height 1.3, tracking -0.01em): Card titles, section headers in modals.
- **Title** (500, 1.125rem / 18px, line-height 1.4): Sub-headers, table row labels, important inline labels.
- **Body** (400, 0.875rem / 14px, line-height 1.5): Default UI body. Max 65-75ch for prose blocks; data and compact UI run denser (data tables and stat cards may use 0.8125rem).
- **Label** (500, 0.75rem / 12px, tracking 0.01em): Button labels, table column headers, badge text, tab labels. Sentence case. Never all-caps except for the rare uppercase-tracked status chip, which is a deliberate component, not a default.

### Named Rules

**The One Family Rule.** No second typeface, no monospace exception. If a "code-looking" feel is needed, the label class is monospace-styled within Geist via `font-variant-numeric: tabular-nums` (numeric data) — the family stays the same.

**The No All-Caps Rule.** Sentence case everywhere. All-caps is reserved for short status chips and the rare, deliberate "eyebrow" label. Body copy and button labels never go uppercase.

**The Tabular Numbers Rule.** All numeric data (temperatures, percentages, dates, IDs) uses `font-variant-numeric: tabular-nums` so columns align in tables and the eye doesn't re-parse on every refresh.

## 4. Elevation

The system uses **tonal layering, not shadows**, by default. Cards sit on a slightly lighter surface than the page; elevation comes from the lightness step, not a drop shadow. Shadows appear only as a response to state (modal, popover, focused card) and are soft and diffuse.

This decision is deliberate. A working dashboard covered in shadows looks like a 2014 app. Tonal layering reads as calmer, more confident, and survives small-screen glare better.

### Shadow Vocabulary
- **Card Rest** (no shadow, surface is `oklch(100% 0 0)` on a `oklch(98% 0.005 155)` page): The default. Card is just "more white" than its background.
- **Card Hover** (`0 1px 2px oklch(0% 0 0 / 4%)`): Subtle, only on interactive cards (the source detail link cards on the IoT dashboard).
- **Popover** (`0 8px 24px oklch(0% 0 0 / 10%)`): Used for dialogs, dropdowns, popovers, the search results panel.
- **Modal Backdrop** (`0 24px 48px oklch(0% 0 0 / 16%)`): Reserved for true modals and confirm dialogs.

### Named Rules

**The Flat-By-Default Rule.** Surfaces are flat at rest. Shadows appear only as a response to state (hover, focus, elevation) or as the explicit visual cue for floating UI (popover, modal). A page with three or more shadowed cards is a page that's lost the plot.

## 5. Components

### Buttons
- **Shape:** Gently rounded (10px). Not pill, not square.
- **Primary:** Background `Workshop Green` (`#3d8a5f`), text white, 8px vertical × 16px horizontal padding. One per screen at most.
- **Hover / Focus:** Background darkens to `Workshop Green Ink` (`#1a3d2a`). Focus ring is a 2px outer ring at `oklch(52% 0.10 155 / 40%)` — visible, not loud.
- **Secondary / Ghost:** Transparent background, 1px border in `--border`, ink text. Used for cancel, secondary actions.
- **Destructive:** Rose background, white text. Reserved for delete and irreversible ops. Always paired with a confirm dialog.

### Chips / Badges
- **Style:** 4px vertical × 8px horizontal padding, 6px radius, 12px label-class text.
- **State Badges:** Light tinted background at ~95% lightness, dark text at ~40% lightness, same hue as the state color. Never use the full-saturation state color for the background; the eye can't read text on it.
- **Filter Chips:** 1px border in `--border`, neutral text, selected variant uses `Workshop Green Soft` background and `Workshop Green Ink` text.

### Cards / Containers
- **Corner Style:** 10px radius (matches the design system base). Source detail cards on the IoT dashboard may use 14px for slightly more presence.
- **Background:** True white (`oklch(100% 0 0)`).
- **Border:** 1px `--border`. Hairline only. No shadow at rest.
- **Internal Padding:** 16px on the content area; headers use 16-20px with the title on a 20-24px line.
- **State Ring:** When a card is in a state (e.g. temperature above threshold), a 1px ring in the state color replaces the default border, never a left-stripe. The exception that proves the rule: zero left-stripe accents anywhere on the surface.

### Inputs / Fields
- **Style:** 1px border in `--border`, white background, 10px radius, 8-12px padding. Label sits above the field (not floating) in 12px label class.
- **Focus:** Border darkens to `Workshop Green` at 60% lightness; 2px outer ring at `oklch(52% 0.10 155 / 30%)`. No layout shift on focus.
- **Error:** Border in `state-offline` red, helper text in the same red below the field. Icon prefix on the field.
- **Disabled:** 50% opacity, `not-allowed` cursor, no focus ring.

### Navigation
- **Top Bar (admin dashboard):** White surface, 1px bottom border. Logo left, primary nav center, user/org switcher right. Brand green only on the active item indicator (small dot or underline, not a heavy background fill).
- **Public Page Header (IoT temperature):** No top bar. Org name as the page title, no nav. The public view is single-purpose; chrome gets in the way.
- **Side Nav (if used):** Reserved for future admin sections. Default to top-bar nav for current scope.

### Temperature Widget Card (signature component)
- **Card:** White surface, 10px radius, no shadow.
- **State Ring:** 1px ring in the threshold-state color (rose for over, amber for near, emerald for under, sky for ≤ 0°C).
- **Reading:** The temperature is the loudest thing on the card. `2.25rem` (display class), tabular-nums, in the same color as the ring.
- **Snowflake icon:** 14px, sky-400, appears at the left of the reading when temp ≤ 0°C.
- **Today Max / Min / Avg:** Label-class text with an icon prefix (🔺 🔻 ▸), muted ink color. The trio sits below the reading, never replaces it.

## 6. Do's and Don'ts

### Do:
- **Do** pair every state color with a redundant icon (`CheckCircle`, `AlertTriangle`, `XCircle`, `Activity`, `Snowflake`) and a text label. Color is never the only signal.
- **Do** use `font-variant-numeric: tabular-nums` on all numeric data, all the time.
- **Do** let the data values be the loudest thing on the page. Card frames recede.
- **Do** test every state color on the actual card surface in real lighting. The 95%-lightness tints are calibrated to pass WCAG AA on white cards in glare.
- **Do** keep the public share page chrome-free. The org name is the title; everything else is data.
- **Do** use Sentence case for all UI text. Thai is the primary language; English is the technical term when it is the standard (Channel, Provider, Quota, Webhook).
- **Do** use `Workshop Green` for the single primary action on a screen, the active nav indicator, and the brand wash on selected states. Nowhere else.
- **Do** use the full state vocabulary for status (online / delayed / offline / unknown) without ever substituting the brand green for one of them.

### Don't:
- **Don't** use `border-left` or `border-right` greater than 1px as a colored stripe. Ever. The state ring around a card is the answer; the left stripe is the anti-pattern.
- **Don't** use gradient text (`background-clip: text`). Decorative, never meaningful.
- **Don't** use glassmorphism (blurred translucent surfaces) as decoration. A modal backdrop is the only place blur is allowed, and only because it has a job.
- **Don't** reach for the saturated 2026 AI palette. No flat blue (`oklch(...)` hue 240-280°) for primary, no violet, no purple-to-blue gradients. The product's primary is `Workshop Green` and that is the conversation.
- **Don't** use hero-metric blocks (big number, small label, supporting stats) for non-metric content. Stat cards are for actual stats.
- **Don't** put an all-caps tracked eyebrow label above every section. The 2023 SaaS template is the tell; use it zero times per page.
- **Don't** use numbered section markers (`01 / 02 / 03`) above sections unless the section is genuinely a sequence and the order matters.
- **Don't** use animated motion for entrance choreography. Motion conveys state change and feedback, nothing else. A page-load reveal that staggers every section is reflex, not design.
- **Don't** impersonate Line's neon green. Stay in the green family at lower chroma, drift sage/sea-green, never `#06C755`.
- **Don't** copy the dated Thai enterprise look. The neutral-warm-gray-with-one-accent admin panel of 2018 is not the look. We are not bland.
- **Don't** reinvent standard affordances for flavor. Native dialogs, native form controls, native scrolling. The tool should disappear into the task.
