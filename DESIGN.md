---
version: alpha
name: LeadScout
description: Desktop lead-generation app on the Google Places API (New) — a dense, professional B2B data tool.
omitted:
  - section: spacing
    reason: Uses Tailwind v4's default spacing scale, unmodified.
colors:
  background: oklch(1 0 0)
  foreground: oklch(0.145 0 0)
  card: oklch(1 0 0)
  card-foreground: oklch(0.145 0 0)
  popover: oklch(1 0 0)
  popover-foreground: oklch(0.145 0 0)
  primary: oklch(0.205 0 0)
  primary-foreground: oklch(0.985 0 0)
  secondary: oklch(0.97 0 0)
  secondary-foreground: oklch(0.205 0 0)
  muted: oklch(0.97 0 0)
  muted-foreground: oklch(0.556 0 0)
  accent: oklch(0.97 0 0)
  accent-foreground: oklch(0.205 0 0)
  destructive: oklch(0.577 0.245 27.325)
  destructive-foreground: oklch(0.985 0 0)
  border: oklch(0.922 0 0)
  input: oklch(0.922 0 0)
  ring: oklch(0.708 0 0)
  success: oklch(0.6 0.15 145)
  warning: oklch(0.75 0.15 80)
typography:
  h1:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 28px
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 14px
  caption:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
  sans:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
rounded:
  base: 0.5rem
components:
  button:
    radius: "{rounded.base}"
    height-default: 36px
    height-sm: 32px
    height-lg: 40px
  badge:
    radius: "{rounded.base}"
    color-success: "{colors.success}"
    color-warning: "{colors.warning}"
    color-destructive: "{colors.destructive}"
---

## Overview

LeadScout is a desktop data tool, not a marketing surface: a sales rep scanning a
120-row results grid should be able to find the leads without a website in under a
second. Every visual decision optimizes for density and legibility over decoration —
no page transitions, no hover animations beyond color/opacity, no illustration. The
one deliberate exception is color as signal: status badges (`success`/`warning`/
`destructive`) and the "no website" row highlight exist specifically to make the
highest-value information scannable at a glance in a dense table.

## Colors

The palette is a near-monochrome neutral scale (all zero-chroma OKLCH grays) plus two
narrow-chroma accent hues reserved entirely for status signaling — never for branding
or decoration.

- **Primary (`oklch(0.205 0 0)`, near-black):** buttons, active nav state, focus
  rings. The app has no brand color; primary action affordances are simply "the
  darkest ink on the page."
- **Neutral scale (`background`/`card`/`popover`/`secondary`/`muted`/`accent`/
  `border`):** all zero-chroma grays at different lightness steps. This is what makes
  the UI feel like a data tool rather than a product marketing page.
- **Success (`oklch(0.6 0.15 145)`, green):** used exclusively for the `OPERATIONAL`
  business-status badge.
- **Warning (`oklch(0.75 0.15 80)`, amber):** used exclusively for the "no website"
  lead highlight and cost-confirmation dialogs (Deep Search's worst-case estimate,
  the Phase 2 Enterprise-details spend). Amber means "this costs money or is a sales
  signal," never generic emphasis.
- **Destructive (`oklch(0.577 0.245 27.325)`, red):** `CLOSED_PERMANENTLY`/
  `CLOSED_TEMPORARILY` badges and destructive actions (remove lead, delete saved
  search).

Do not introduce a new hue for a new feature. If something needs to stand out, it
should use `warning` (sales-relevant signal), `destructive` (irreversible/negative),
or `success` (positive/confirmed) — reusing the existing three-color vocabulary keeps
the whole app's status language consistent.

## Themes

The installed DESIGN.md spec does not yet support theme-aware tokens, so the
frontmatter above holds only the light-theme (default) values. Dark-mode overrides
the same semantic tokens are:

| Token | Light | Dark |
|---|---|---|
| background | oklch(1 0 0) | oklch(0.145 0 0) |
| foreground | oklch(0.145 0 0) | oklch(0.985 0 0) |
| card / popover | oklch(1 0 0) | oklch(0.205 0 0) |
| card-foreground / popover-foreground | oklch(0.145 0 0) | oklch(0.985 0 0) |
| primary | oklch(0.205 0 0) | oklch(0.922 0 0) |
| primary-foreground | oklch(0.985 0 0) | oklch(0.205 0 0) |
| secondary / muted / accent | oklch(0.97 0 0) | oklch(0.269 0 0) |
| secondary-foreground / accent-foreground | oklch(0.205 0 0) | oklch(0.985 0 0) |
| muted-foreground | oklch(0.556 0 0) | oklch(0.708 0 0) |
| destructive | oklch(0.577 0.245 27.325) | oklch(0.704 0.191 22.216) |
| border | oklch(0.922 0 0) | oklch(1 0 0 / 10%) |
| input | oklch(0.922 0 0) | oklch(1 0 0 / 15%) |
| ring | oklch(0.708 0 0) | oklch(0.556 0 0) |
| success | oklch(0.6 0.15 145) | oklch(0.65 0.15 145) |
| warning | oklch(0.75 0.15 80) | oklch(0.8 0.15 80) |

Theme switching is not yet wired up in the UI (the `.dark` class exists in CSS but no
control toggles it); the app currently always renders in light mode.

## Typography

Four levels cover the entire app — a dense data tool doesn't need more:

- **h1** — page titles only ("Search", "Results", "Pipeline", "Compliance",
  "Settings"). One per screen, never nested.
- **body** — the default for everything: table cells, form inputs, button labels,
  dialog copy.
- **label** — form field labels and table column headers. Same size as body but
  medium weight, which is what visually separates "this names a field" from "this is
  the field's content" without needing a size change.
- **caption** — secondary/muted metadata: descriptions under a card title, timestamps
  ("last run 9/21/2026"), row counts, the Google attribution line.

No custom webfont is loaded. The `sans` stack is the OS's native UI font
(San Francisco on macOS, Segoe UI on Windows, the system sans on Linux) — a desktop
app should render instantly with zero font-fetch latency and feel native to each
platform, not impose a single brand typeface across all three.

## Logo & Branding

The LeadScout mark is a "radar signal": three concentric arcs sweeping from an
origin point, with a highlighted dot on the outer ring standing in for a
discovered business. Source of truth is
`src-tauri/icons/source/leadscout-mark.svg`, hand-mirrored into
`src/components/branding/wordmark.tsx`'s `LogoMark`.

- **Single flat fill, `currentColor` only.** The mark never carries its own
  hardcoded color — it renders in whatever ink color the caller sets, always
  one of `--primary`/`--foreground`/`--muted-foreground`, never a new hue.
  The app-icon PNG export is the one static exception (it needs real pixels,
  not CSS): white background, near-black (`#111111`) mark, regenerated via
  `pnpm tauri icon src-tauri/icons/source/leadscout-icon-1024.png` if the mark
  ever changes.
- **Safe area.** The mark's geometry is drawn on a 1024×1024 canvas with all
  content kept within the center ~832×832 (~8-9% margin per side) so macOS's
  own squircle corner-mask never clips it.
- **Two variants.** `<Wordmark variant="full" />` (mark + "LeadScout" text) for
  contexts with room — the sidebar header, the About screen's title.
  `<Wordmark variant="mark" />` (icon only) for tight spaces — collapsed/small
  contexts and the onboarding splash.
- **Minimum size.** Legible down to 16px (the smallest app-icon export); below
  that, use `variant="mark"` at no smaller than 16px rather than shrinking
  further.
- **Don't** recolor the mark, add a gradient, or give it its own drop shadow —
  it follows the same neutral-ink rule as every other icon in the app (see
  Colors above: "no new hue" applies to the logo too, not just feature UI).

## Shapes

`rounded.base` (0.5rem) is the only radius decision in the system — shadcn/ui's
"new-york" style derives `sm`/`md`/`lg`/`xl` from it (`base - 4px`, `base - 2px`,
`base`, `base + 4px`). Every interactive surface (button, input, card, dialog, badge,
popover) uses one of these four derived values; nothing in the app uses an
arbitrary one-off border-radius.

## Components

- **Button** — six variants (`default`, `destructive`, `outline`, `secondary`,
  `ghost`, `link`) and four sizes (`default` 36px, `sm` 32px, `lg` 40px, `icon`
  36px square). `default` is reserved for the one primary action per view (Search,
  Save, Start Deep Search); everything else is `outline` or `ghost`. `destructive`
  is exclusively for irreversible actions and always sits behind a confirmation
  dialog (remove API key, remove lead).
- **Badge** — the app's primary status-signaling primitive. `success` for
  `OPERATIONAL`, `destructive` for closed statuses, `warning` for "costs money" or
  "sales signal" (no website, cost estimates), `secondary`/`outline` for neutral
  metadata (tags, "not checked yet"). A badge's color always maps to one of these
  four meanings — never used for decoration.
- **Data grid rows** — the results table encodes exactly one extra semantic per row
  via background tint: a subtle `warning`-tinted row means "no website on file
  (checked)," and a `primary`-colored left border means "new since last saved-search
  run." These two signals are additive (a row can be both) and are the only
  row-level highlighting in the app — don't add a third without a similarly strong,
  sales-relevant reason.

## Do's and Don'ts

- **Don't** add page-transition or hover-lift animations. This is a data tool meant
  to feel instant, not polished-for-marketing.
- **Do** show a visible "last refreshed"/"not checked yet" state for any field
  sourced from Google Place Details, never presenting stale Enterprise-tier data
  (phone, website, rating, hours) as if it were live without that context — see the
  Compliance panel for why.
- **Do** reserve `warning` (amber) specifically for cost/sales-signal emphasis (no
  website, cost-confirmation dialogs) — don't reuse it for arbitrary attention-
  grabbing.
- **Don't** introduce a new accent hue. Success/warning/destructive/neutral is the
  complete status vocabulary; a new feature should map onto one of these, not invent
  a fifth color.
