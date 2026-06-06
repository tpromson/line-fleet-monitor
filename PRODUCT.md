# Product

## Register

product

## Users

Two primary user groups share this surface:

**LINE OA admins** — operators who manage multiple LINE Official Accounts (Channels) under Organizations. They live in the dashboard daily: checking quota usage, verifying webhook health, responding to alerts. Speed and clarity matter more than visual flourish. They want to spot problems in under five seconds.

**Lab/operations staff** — non-technical users who read the IoT temperature widgets through the public share link. They monitor cold storage (blood bank, vaccine fridge, reagent freezer, room-temperature stock). They read the page on mobile, in mixed lighting, and need to see at a glance: is the temperature safe right now. Most of them never see the admin dashboard.

## Product Purpose

LINE Fleet Monitor centralizes monitoring for two distinct domains in one stack:

1. **LINE Messaging API fleet** — quota consumption, webhook connectivity, alert thresholds across many Channels and Providers. The problem it solves: a single OA admin can't watch 30+ Channels manually, and a quota exhaustion or silent webhook failure costs the business.

2. **Cold-chain IoT telemetry** — temperature/humidity readings from sources in labs, pharmacies, and stock rooms. The problem it solves: silent equipment failure (compressor down, door left open) that ruins inventory before anyone notices.

Success means: the right person sees the right state change in the right surface at the right time, with zero false alarms and zero missed events.

## Brand Personality

**Friendly, accessible, soft.**

The product is a daily tool, not a marketing showcase. It should feel like a competent colleague: warm enough to look at all day, clear enough to act on at a glance, honest enough that color always means something specific.

Voice in copy: Thai-first, concise, action-oriented. No jargon, no marketing puffery. Buttons say what they do ("บันทึก", "ลบ"), not "OK" or "Submit".

Visual: soft radius (10px base, currently in tokens), rounded geometry, generous spacing. Color earns its place by communicating state. Nothing decorative.

## Anti-references

This product must NOT look like:

- **The 2026 AI flat-blue/violet monochrome** — the saturated default of generative UI. Hue 240-280°, chroma 0.15-0.25, full surfaces. Avoid entirely. The current token `--sidebar-primary: oklch(0.488 0.243 264.376)` in dark mode is exactly this trap and should be reconsidered.
- **SaaS landing tropes** — gradient text, hero-metric blocks, glass cards, eyebrow labels above every section, "01 · About / 02 · Process" numbered markers. This is a working tool, not a sales page.
- **Generic Thai enterprise beige** — flat warm-gray with one accent, the dated admin-panel look from circa 2018. Conveys boredom and low craft.
- **Grafana / terminal-dense dashboards** — even though this product handles telemetry, the audience is not engineers running a NOC. Skip the wall-of-monospace, the heat-grid heatmaps, the BLINKING ALERTS.
- **LINE brand mimicry** — Line's `#06C755` is a real anchor but copying it directly reads as a third-party client. Stay in the green family, drift toward a slightly more muted, custom green that signals affinity without impersonation.

## Design Principles

1. **State before decoration** — color is communication first, aesthetics never. Every colored element must answer "what is the user being told?" Removing the color must remove the information, or the color is wrong.

2. **One glance tells the truth** — a returning admin should be able to scan the dashboard in under three seconds and know which Channels need attention. Public share page: same goal, mobile, no scrolling for the critical reading.

3. **The surface recedes, the data leads** — chrome (cards, headers, dividers) should be quieter than the data it holds. A temperature reading at -17.9 °C should be the loudest thing on the card, not the card frame.

4. **One accent, many semantic states** — pick a brand hue and commit. Use it for primary action, current selection, and brand voice. Use a separate, smaller semantic vocabulary (rose, amber, sky, emerald) strictly for state. Never let the brand accent drift into a state color.

5. **Soft on the eyes, sharp on the signal** — soft radii, generous spacing, friendly typography. But threshold lines, alert icons, and the data values themselves are crisp and unornamented. The chrome is gentle; the warnings are not.

## Accessibility & Inclusion

WCAG 2.1 AA is the floor:

- Body text ≥ 4.5:1 against its background. Large text and UI components ≥ 3:1.
- Color is never the only signal — every state indicator pairs color with an icon or text label (e.g. "Online" badge + green dot, not just green dot).
- Public share page is read in mixed real-world lighting (lab rooms, pharmacy back-of-house, outdoors walking between buildings). All state colors must pass contrast on white card surfaces AND in glare.
- Operationally, color-blind users (about 8% of men) must distinguish online / delayed / offline / unknown. The icons (CheckCircle, AlertTriangle, XCircle, Activity) carry the meaning redundantly.
- Reduced-motion: all transitions collapse to crossfade or instant when `prefers-reduced-motion: reduce` is set. No essential information gated on animation.
- Thai-first copy. English allowed in technical labels where it is the standard term (Channel, Provider, Quota, Webhook) per `CONTEXT.md`. No machine-translated Thai.
