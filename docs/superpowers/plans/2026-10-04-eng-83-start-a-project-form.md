# ENG-83 Start a Project Conversion Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `/start-a-project` page: a problem-first qualification form on Formspree with validation, honeypot spam protection, and client-side success/error states — no backend, no new dependencies.

**Architecture:** One new Astro page (`src/pages/start-a-project.astro`) renders a semantic form whose `action` is a single pending config constant (`src/config/forms.ts`). Native HTML validation covers input validation; a small inline script intercepts submit, POSTs via `fetch` with `Accept: application/json`, and renders success/error states in two live regions outside the form (so the form can be hidden on success without hiding the status). Without JS the form falls back to Formspree's native POST handling. Creating the page auto-activates every self-gating CTA via `routeExists` — no shared-component edits (ENG-85 works those files in parallel).

**Tech Stack:** Astro 7 (static-first, TypeScript strict), plain HTML/CSS/JS, Formspree hosted endpoint, node:test for source invariants, Playwright MCP for runtime verification (no repo dependency added).

**Spec:** Notion "02 — IA, UX & Page Specification" (Start a Project: "Problem-first qualification form with clear success/error states"; UX principles), "04 — Technical Architecture & Content Model" (Form integration boundary — Formspree approved 2026-10-04), "01 — PRD" (Conversion mechanism, V1 routes, evidence policy), Linear ENG-83 acceptance criteria.

## Global Constraints

- No backend, database, CMS, auth, CRM, or agent backend (PRD V1 non-goals).
- No new npm dependencies.
- Minimal fields only: problem description, name, email, organization (optional) + Formspree `_honey` honeypot. No sensitive data.
- No invented contact details, response-time promises, metrics, or claims.
- Endpoint ID PENDING founder provisioning: exactly one config constant, clearly marked; `PENDING_FORMSPREE_ID` placeholder until it arrives.
- Keep shared-component diffs to zero: do not edit/reformat `Button.astro`, `Header.astro`, `Footer.astro`, `StartProjectCta.astro`, `BaseLayout.astro`, `about.astro` (ENG-85 parallel branch).
- check:dist on every page: `html lang`, unique non-empty title, non-empty meta description, viewport, exactly one `<h1>`, zero dead internal refs (form `action` is external and outside the checked attribute set anyway).
- Branch `ENG-83-start-a-project-form`, PR titled `ENG-83: <short description>` with the Linear link, never merge.
- Verification: `npm run verify` must exit 0 — never claim without running.

## Review Focus

- Formspree endpoint drift: only `src/config/forms.ts` may contain `formspree.io/f/`; the page must import it (test: single occurrence in config, zero in page, `action={formspreeEndpoint}` present).
- Field creep (privacy AC): rendered `name=` set must be exactly {problem, name, email, organization, _honey}, problem first, organization not required (test: tag extraction over source).
- Success/error states missing or not client-side: `role="status"` + `role="alert"` regions, `Accept: "application/json"`, `fetch(form.action` (test) — then runtime-checked in Task 4.
- Honeypot omission (spam AC): `name="_honey"` present and hidden (test; runtime-confirmed hidden in Task 4).
- check:dist regressions: exactly one h1, description present, no dead internal links — enforced by `npm run verify` (Task 3).

---

### Task 1: AC source-invariants test (red first)

**Files:**

- Create: `tests/start-a-project.test.mjs`

**Interfaces:**

- Consumes: none (reads `src/pages/start-a-project.astro`, `src/config/forms.ts` from disk).
- Produces: `node --test` suite that Task 2 must turn green.

- [ ] **Step 1: Write the failing test** — full file content:

```js
/**
 * ENG-83 acceptance invariants for the Start a Project conversion flow.
 *
 * Deterministic source-level checks (run in `npm test` BEFORE the build,
 * so they read the source, not dist/): the Formspree endpoint lives in
 * exactly one config constant, the field set stays minimal and
 * problem-first, spam protection and client-side success/error states
 * are present. End-to-end submission behavior is verified separately
 * against a preview build (see the ENG-83 PR); the live endpoint ID is
 * pending founder provisioning.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(
  new URL("../src/pages/start-a-project.astro", import.meta.url),
  "utf8",
);
const config = readFileSync(
  new URL("../src/config/forms.ts", import.meta.url),
  "utf8",
);

/** Open tags of form controls in the page source, in document order. */
const controlTags = [...page.matchAll(/<(?:input|textarea)\b[^>]*>/g)].map(
  (m) => m[0],
);
const tagNamed = (name) =>
  controlTags.find((tag) => new RegExp(`name="${name}"`).test(tag));

describe("start-a-project endpoint is a single config constant", () => {
  test("config holds the one Formspree endpoint URL", () => {
    const hits = config.match(/formspree\.io\/f\//g) ?? [];
    assert.equal(hits.length, 1);
    assert.match(config, /PENDING_FORMSPREE_ID/);
  });
  test("page imports the constant and hardcodes no endpoint", () => {
    assert.match(page, /from "\.\.\/config\/forms"/);
    assert.match(page, /action=\{formspreeEndpoint\}/);
    assert.doesNotMatch(page, /formspree\.io/);
  });
});

describe("start-a-project qualification fields are minimal and problem-first", () => {
  test("exactly the approved control names, problem description first", () => {
    const names = controlTags.map((tag) => tag.match(/name="([^"]+)"/)?.[1]);
    assert.deepEqual(names, [
      "problem",
      "name",
      "email",
      "organization",
      "_honey",
    ]);
  });
  test("required fields and email typing", () => {
    assert.match(tagNamed("problem"), /<textarea\b[^>]*\brequired\b/);
    assert.match(tagNamed("name"), /\brequired\b/);
    assert.match(tagNamed("email"), /type="email"/);
    assert.match(tagNamed("email"), /\brequired\b/);
  });
  test("organization is optional (privacy: minimal necessary data)", () => {
    assert.doesNotMatch(tagNamed("organization"), /\brequired\b/);
  });
});

describe("start-a-project spam protection and states", () => {
  test("Formspree honeypot field present", () => {
    const honey = tagNamed("_honey");
    assert.ok(honey, "missing _honey honeypot input");
    assert.match(honey, /tabindex="-1"/);
  });
  test("client-side success and error regions exist", () => {
    assert.match(page, /role="status"/);
    assert.match(page, /role="alert"/);
    assert.match(page, /Thanks — your message has been sent\./);
    assert.match(page, /Something went wrong sending your message/);
  });
  test("AJAX submission requests Formspree's JSON response", () => {
    assert.match(page, /fetch\(form\.action/);
    assert.match(page, /Accept: "application\/json"/);
    assert.match(page, /method="post"/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/start-a-project.test.mjs`
Expected: FAIL — ENOENT (neither `src/pages/start-a-project.astro` nor `src/config/forms.ts` exists).

### Task 2: Config constant + page (markup, styles, client script)

**Files:**

- Create: `src/config/forms.ts`
- Create: `src/pages/start-a-project.astro`

**Interfaces:**

- Produces: `formspreeEndpoint: string` (the single endpoint constant); route `/start-a-project` (activates self-gating CTAs via `routeExists`; `tests/route-patterns.test.mjs` already expects the file).

- [ ] **Step 1: Create `src/config/forms.ts`** (content in plan — see code below)
- [ ] **Step 2: Create `src/pages/start-a-project.astro`** (full markup + scoped styles + client script below)
- [ ] **Step 3: Run the test to verify it passes**

Run: `node --test tests/start-a-project.test.mjs`
Expected: PASS (all suites)

- [ ] **Step 4: Fast static checks**

Run: `npx prettier --write tests/start-a-project.test.mjs src/config/forms.ts src/pages/start-a-project.astro && npm run lint && npm run typecheck`
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add tests/start-a-project.test.mjs src/config/forms.ts src/pages/start-a-project.astro
git commit -m "ENG-83: start-a-project page with Formspree qualification form"
```

### Task 3: Full deterministic verification

- [ ] **Step 1: Run the repo verification pipeline**

Run: `npm run verify`
Expected: exit 0. Record: test counts, check:dist `N page(s), M internal reference(s), 0 problems`, and confirm the built page exists (`dist/start-a-project.html`) with CTAs rendered as real `<a href="/start-a-project">` links.

### Task 4: Runtime submission-behavior verification (preview + Playwright MCP)

- [ ] **Step 1:** `npm run build && npm run preview` (background) → `http://localhost:4321/start-a-project`
- [ ] **Step 2:** Page loads: one h1, form with 4 visible fields + hidden honeypot, nav/CTA links to `/start-a-project` are live anchors.
- [ ] **Step 3:** Native validation: submit empty → browser blocks submission (invalid field reported), no fetch fired.
- [ ] **Step 4:** Error state: fill fields, submit → fetch to placeholder endpoint fails → `role="alert"` error visible, form still filled/enabled.
- [ ] **Step 5:** Success state: stub `window.fetch` via evaluate to resolve `{ok:true}` JSON → submit → form hidden, `role="status"` shows "Thanks — your message has been sent.", focus moved to status.
- [ ] **Step 6:** Record evidence (screenshot/console) for the PR.

### Task 5: Commit, push, open PR (no merge)

- [ ] **Step 1:** Commit any remaining changes (plan file stays untracked).
- [ ] **Step 2:** `git push -u origin ENG-83-start-a-project-form`
- [ ] **Step 3:** `gh pr create --base main --title "ENG-83: Start a Project conversion flow" --body <Linear link + verification evidence + pending endpoint ID statement>`
- [ ] **Step 4:** Report PR number, evidence line, and exactly what remains pending the Formspree ID.

---

## Plan self-review

1. **Spec coverage:** problem-first fields ✓ (problem first, Task 1/2); validation ✓ (native required/type=email + `checkValidity`); spam protection ✓ (`_honey` + Formspree server-side filtering, documented in PR); success/error states ✓ (live regions + fetch JSON, runtime-checked Task 4); privacy ✓ (minimal field set test, no sensitive data); submission verified as far as possible without ID ✓ (Task 3 + 4, remainder stated in PR).
2. **Placeholders:** none — code blocks are final content; endpoint placeholder is the _product's_ pending value, explicitly marked.
3. **Type consistency:** `formspreeEndpoint` exported once, imported identically in the page; ids `project-form`/`form-status`/`form-error` match between markup and script.
4. **Review Focus:** each line maps to a Task 1 test or a Task 3/4 check.
