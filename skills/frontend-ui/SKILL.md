---
name: frontend-ui
description: >-
  Use this skill when designing or redesigning a website, web app, or any
  interface and you want the result to feel intentional and distinctive rather
  than generic. Covers art direction, typography, color systems, layout, motion,
  and the craft of interface copy. Load this when a user asks to build a new
  page, style an existing one, or make something look better.
---

# UI Craft

Design like an art director who treats every brief as its own project: the
result should read as a deliberate point of view, not a reusable template. If
the user has shown you preferences, given you context about their product, or
seen your earlier work, treat all of that as input. Take one justifiable risk
per project, and make everything else disciplined.

## Own the brief before you touch pixels

Good design starts with a concrete subject. If the brief does not name one, pin
it down: what is this product or page for, who uses it, and what is its single
job? Write that down in one or two sentences. Every later decision should trace
back to those sentences. Pull from the subject's own world — its materials,
tools, vocabulary, and conventions — because that is where distinctive choices
live. If the brief is thin on real content, propose some; copy is part of the
design and can be the difference between a page that feels made and one that
feels filled in.

## The plan artifact: a compact design system

Before writing any markup or CSS, produce a short plan with four parts:

**Palette.** Four to six named colors with jobs, not just swatches: a surface or
background tone, a primary action color, a text hierarchy (at least a strong and
a muted tone), and one accent used sparingly. Check contrast early — if the
pairings cannot carry readable text, adjust before building, not after.

**Typography.** Pick typefaces for roles, not "a font." Typically a display face
with real character used with restraint, a neutral body face that is comfortable
to read, and optionally a utility face for captions, numbers, or data. Aim for
pairings that are different enough to be interesting and compatible enough to
share a page. Set an explicit scale: sizes, weights, line heights, and spacing
for every level you use.

**Layout.** Describe the arrangement in a sentence or two, then sketch it with
an ASCII wireframe so you can compare options before committing. Think in terms
of hierarchy: what is seen first, what supports it, what recedes.

**Centerpiece.** Name the single element that will make this page memorable and
that embodies the brief — a moment, an interaction, a graphic device, a use of
type. It should be the only loud thing on the page.

If the subject warrants it, add a short motion plan: where animation is earned,
what it expresses, and where it stays quiet. Scattered effects read as noise;
one orchestrated moment reads as design.

## The default trap

Hasty and generated work clusters into a few recognizable looks: soft neutral
backgrounds paired with serif display type and one warm accent; near-black
backdrops with a single saturated highlight; dense editorial layouts built from
hairlines with no border radius. Any of these can be the right answer for a
given brief — but left to themselves they are defaults, not decisions. When the
user's brief explicitly asks for a direction, follow it exactly. When an axis is
left open, do not spend that freedom on the obvious choice; spend it on
something the brief actually justifies.

A useful test: imagine the same plan applied to an unrelated subject. If nothing
about the plan is specific to this project — if any product would look the same
— revise until it isn't, and say what you changed and why.

## Principles

- **Every choice cites the brief.** If you cannot say why a color, weight, or
  spacing exists, cut it or find the reason.
- **Structure carries meaning.** Numbering, dividers, and labels should encode
  real information. A "01 / 02 / 03" sequence is only honest when the content is
  genuinely ordered, like a process or a timeline.
- **Type is personality.** The pairing of display and body is often the first
  thing a viewer remembers. Treat the type treatment as part of the design, not
  a delivery vehicle.
- **Motion must earn its place.** Movement draws attention; use it where it
  helps comprehension or delight, and resist adding it everywhere. Restraint
  reads as confidence.
- **Match effort to ambition.** A maximalist direction needs elaborate
  execution; a minimal direction needs flawless spacing and proportion. Either
  can be elegant once finished.

## The writing is part of the design

Words are interface material, not filler. Write from the reader's side of the
screen: name things by what people see and control, never by the machinery
behind them. Prefer active, concrete labels ("Save changes," not "Submit"), and
keep the same name for an action everywhere it appears — a button that says
"Publish" should produce a toast that says "Published." Errors and empty states
are directions, not apologies: say what happened and what to do next, plainly,
in the product's voice. Match tone to audience, stay conversational, and keep it
specific. A label labels, an example demonstrates; let each element do one job.

## Reshaping something existing

When redesigning, do not discard what works. Inventory the current design
first: what is it trying to say, what is genuinely broken, and what is worth
keeping. Preserve the good, fix the specific problems, and evolve rather than
replace wholesale unless the brief asks for a fresh start. The discipline is the
same: name the problem, propose a plan, and let every change trace back to the
brief.

## Work in passes

Draft the plan, then review it against the brief before building. Be honest
about what is generic, revise it, and note what you changed. Build following the
plan, deriving colors, type, and spacing from it. Then critique your own work:
look at the rendered result, screenshot it if your environment allows, and check
that the centerpiece lands and nothing fights it. Iterate before showing the
user — share ideas when you have some confidence they will delight, not as a
running commentary. If you have a place to jot down what you tried, use it; it
makes the next pass better.

## Non-negotiable quality floor

Whatever the direction, ship to a baseline: layouts work on a narrow mobile
screen and a wide desktop, all controls are reachable and operable by keyboard,
focus is always visible, `prefers-reduced-motion` is respected, and text keeps
accessible contrast. A distinctive design that fails these reads as broken, not
artistic. One image is worth a thousand tokens of self-review, so screenshot
whenever you can.

## Before you call it done

- [ ] The brief is restated in one or two sentences.
- [ ] Every palette and type decision traces back to it.
- [ ] One centerpiece; everything else stays quiet.
- [ ] Layout survives narrow and wide widths.
- [ ] Keyboard navigation and visible focus verified.
- [ ] Reduced motion respected.
- [ ] Text contrast and sizes meet accessibility.
- [ ] Interface copy is plain, active, and consistent.
