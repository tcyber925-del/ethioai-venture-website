---
version: alpha
name: EthioAI Venture
description: Visual identity and design system for the EthioAI Venture public website.

colors:
  primary: "#171717"
  secondary: "#525252"
  tertiary: "#0F5B5A"
  neutral: "#FAFAF8"
  surface: "#FFFFFF"
  on-surface: "#171717"
  border: "#D9D9D5"
  muted: "#737373"

typography:
  display:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 4.5rem
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.04em"

  h1:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 3.75rem
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.035em"

  h2:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 3rem
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.025em"

  h3:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 1.5rem
    fontWeight: 600
    lineHeight: 1.2

  body-lg:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 1.125rem
    fontWeight: 400
    lineHeight: 1.6

  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.6

  body-sm:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.5

  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 0.75rem
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.06em"

  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.5

rounded:
  sm: 4px
  md: 8px
  lg: 12px
  xl: 16px

spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
  3xl: 64px
  4xl: 80px
  5xl: 96px
  6xl: 128px

components:
  button-primary:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: 12px

  button-primary-hover:
    backgroundColor: "#0A4948"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: 12px

  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: 12px

  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.lg}"
    padding: 24px

---

## Overview

**Practical Enterprise AI, expressed through technical editorialism.**

EthioAI Venture is an AI engineering and implementation studio. The website should communicate the confidence of a serious engineering practice without adopting the visual clichés of the AI startup category.

The design should feel:

- technical
- practical
- precise
- credible
- calm
- modern
- human
- evidence-led

The closest mental model is **a contemporary engineering studio combined with a strong technical publication**: clear hierarchy, disciplined typography, generous whitespace, structured information, and real evidence.

Avoid designs that feel:

- futuristic for its own sake
- cyberpunk
- flashy
- consumer-gadget-like
- generic SaaS
- excessively corporate
- visually dependent on "AI" effects

The visual identity should come primarily from **typography, composition, spacing, structure, and evidence**.

---

## Colors

The palette is intentionally restrained.

**Primary** `{colors.primary}` is the principal ink color. Use it for headings, primary text, and important interface elements.

**Secondary** `{colors.secondary}` is supporting text and secondary information.

**Tertiary** `{colors.tertiary}` is the EthioAI Venture brand accent. It should be used selectively for primary actions, active states, important links, and small visual highlights.

**Neutral** `{colors.neutral}` is the primary page background. Its slight warmth prevents the interface from feeling sterile while remaining highly professional.

**Surface** `{colors.surface}` is used for cards, forms, and other content surfaces.

**On-surface** `{colors.on-surface}` provides the default high-contrast content color on surfaces.

**Border** `{colors.border}` provides subtle structural separation.

**Muted** `{colors.muted}` is reserved for low-emphasis supporting information.

The accent is an **accent**, not the entire visual identity.

Do not fill large areas with saturated teal merely to make the site look more branded.

Prefer a mostly neutral interface with carefully placed accent moments.

Maintain WCAG AA contrast for normal text and interactive controls.

---

## Typography

Typography is one of the primary expressions of the EthioAI Venture identity.

Use **Inter** or the project's finalized equivalent as the primary typeface.

The hierarchy should feel strong without becoming theatrical.

### Display and headings

Large headings use strong weights and modest negative tracking.

The display scale should communicate confidence and technical competence rather than advertising spectacle.

Avoid:

- extremely thin headings
- excessive all-caps
- excessively long headline lines
- decorative type treatments
- oversized text that consumes an entire mobile viewport

### Body

Body typography prioritizes comfortable reading.

Use generous line height and reasonable line lengths for longer content.

### Technical typography

The monospace style is reserved for genuinely technical material:

- code
- commands
- technical identifiers
- system metadata
- selected measurements

Do not use monospace simply to make ordinary marketing copy appear technical.

---

## Layout

The layout language is **structured spaciousness**.

Content should generally sit inside a centered container with a desktop maximum width of approximately **1200–1280px**.

The precise implementation may be adjusted when the first real page is built and visually verified.

Use CSS Grid and Flexbox rather than manual positioning.

A conceptual responsive grid is:

- Desktop: 12 columns
- Tablet: 8 columns
- Mobile: 4 columns

Major sections should have clear separation.

Within a section:

```text
Section
  ↓
Subsection
  ↓
Component
  ↓
Content
```

Spacing should decrease as the hierarchy becomes more local.

Use the defined spacing scale rather than arbitrary values.

### Responsive behavior

The design is mobile-first.

Validate at approximately:

- 320px
- 375px
- 768px
- 1024px
- 1280px+

Mobile is not simply a smaller desktop layout.

When necessary, change composition, stacking, navigation, and visual emphasis for smaller screens.

Do not allow horizontal overflow.

---

## Elevation & Depth

EthioAI Venture uses **low visual elevation**.

Hierarchy should primarily come from:

1. whitespace
2. typography
3. borders
4. tonal contrast
5. subtle elevation

Shadows should be restrained.

Avoid:

- glowing shadows
- dramatic floating cards
- excessive drop shadows
- heavy glassmorphism
- visual effects that compete with content

A surface should not need a large shadow to feel important.

---

## Shapes

The shape language is **structured and moderately softened**.

Use:

- `sm` for compact elements
- `md` for controls
- `lg` for cards and grouped content
- `xl` only for larger feature surfaces when justified

Avoid excessive rounding.

Do not make every element pill-shaped.

The overall interface should feel engineered and structured rather than playful.

Borders should normally be subtle and functional.

---

## Components

The initial component vocabulary should remain small.

### Primary button

The primary button represents the most important action in a visual region.

The primary website CTA is:

**Start a Project**

Use the tertiary brand color for the primary action.

Do not place multiple visually competing primary actions in the same region.

### Secondary button

Use for important supporting actions such as:

- View Work
- Explore Capabilities
- Read Case Study

Secondary actions should remain visually subordinate to the primary CTA.

### Cards

Cards should group meaningful information.

Appropriate uses include:

- capabilities
- services
- case studies
- experiments
- research
- technical evidence

Do not turn every section into a collection of cards.

If a simple editorial layout communicates the information better, prefer the simple layout.

### Forms

Forms should be short and purposeful.

The primary project inquiry should help understand the visitor's actual problem without collecting unnecessary information.

Forms need clear labels, visible focus states, useful validation, and understandable error messages.

### Evidence

The design should make the status of work clear.

Use explicit distinctions such as:

- Production
- Case Study
- Prototype
- Experiment
- Research
- In Development

A prototype must never visually imply the maturity of a production system.

---

## Do's and Don'ts

### Do

- Do use typography as a major visual element.
- Do use whitespace deliberately.
- Do use the brand accent selectively.
- Do prefer real product and technical evidence.
- Do make hierarchy obvious.
- Do keep interfaces simple.
- Do use semantic HTML.
- Do preserve accessibility.
- Do design mobile-first.
- Do reuse established patterns when repetition is real.
- Do make technical credibility visible.
- Do let content and evidence drive visual hierarchy.

### Don't

- Don't use generic AI gradients as the primary identity.
- Don't use glowing brains, robots, or abstract AI imagery as decoration.
- Don't use glassmorphism by default.
- Don't turn every section into cards.
- Don't introduce excessive animation.
- Don't introduce arbitrary colors.
- Don't introduce arbitrary spacing values.
- Don't use decorative visuals that communicate nothing.
- Don't fabricate customers, metrics, testimonials, or outcomes.
- Don't present prototypes as production systems.
- Don't make the interface look futuristic merely to signal AI.
- Don't add design-system complexity for hypothetical future needs.

### Evidence before marketing

**Proof before marketing.**

The website should make genuine technical work easy to understand.

When evidence exists, show it clearly.

When evidence is limited, communicate honestly rather than compensating with exaggerated visual language.

The design should make **real work look credible**, not make unsupported claims look credible.