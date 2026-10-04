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
    // The URL must BE a Formspree endpoint — but never pin its ID, so the
    // go-live swap of the placeholder stays a single-file change.
    assert.match(config, /https:\/\/formspree\.io\/f\/[A-Za-z0-9_-]+/);
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
      "_gotcha",
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
  test("both honeypot fields present (founder decision 2026-10-04: AC-literal _honey + Formspree's built-in _gotcha)", () => {
    for (const fieldName of ["_honey", "_gotcha"]) {
      const honeypot = tagNamed(fieldName);
      assert.ok(honeypot, `missing ${fieldName} honeypot input`);
      assert.match(honeypot, /tabindex="-1"/);
    }
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
  test("success requires Formspree's explicit ok:true — a 200 with a non-JSON or ok:false body must never render a false confirmation", () => {
    assert.match(page, /body\?\.ok === true/);
    assert.doesNotMatch(page, /body\?\.ok !== false/);
  });
  test("success state actually hides the form — author [hidden] rule beats form's display:flex — and releases the send lock", () => {
    // The form's own `display: flex` overrides the UA [hidden] rule, so
    // form.hidden = true needs an author rule (repo pattern: ProjectCard
    // .project-card[hidden], StatusFilter .filter[hidden]).
    assert.match(page, /form\[hidden\] \{[^}]*display: none/);
    const successBlock =
      page.split("body?.ok === true")[1]?.split("throw new Error")[0] ?? "";
    assert.match(successBlock, /form\.hidden = true/);
    assert.match(successBlock, /sending = false/);
    assert.match(successBlock, /submitButton\.disabled = false/);
    assert.match(successBlock, /status\.focus\(\)/);
  });
  test("error state takes keyboard focus (WCAG 2.4.3) — mirror of the status region", () => {
    assert.match(page, /<p[^>]*\bid="form-error"[^>]*tabindex="-1"/);
    const catchBlock = page.split(".catch(() => {")[1] ?? "";
    assert.match(catchBlock, /error\.focus\(\)/);
  });
});
