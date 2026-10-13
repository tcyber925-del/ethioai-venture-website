/**
 * ENG-103 — regression battery for scripts/check-a11y.mjs.
 *
 * Each fixture dist/ is built by hand and the gate is run against it, so the
 * battery proves the gate REDS on every regression it exists to catch rather
 * than merely passing against whatever the repo happens to have built. Same
 * discipline as tests/check-work.test.mjs.
 *
 * Wired into `npm run verify` and the CI job alongside the other dist gates.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const script = join(repoRoot, "scripts/check-a11y.mjs");

/** Nav CSS as the emitted stylesheet carries it (Astro-scoped). */
const NAV_CSS =
  ".primary-nav[data-astro-cid-h] a{padding-block:var(--space-xs);display:inline-block}" +
  ".footer-nav[data-astro-cid-f] a{padding-block:var(--space-xs);display:inline-block}";

/** The Work filter chip's default border rule, Astro-scoped. */
const CHIP_CSS =
  ".filter__chip[data-astro-cid-w]{padding:var(--space-xs);border:1px solid var(--color-secondary)}";

/** A nav list whose markers are removed — role="list" is the ENG-103 fix. */
function nav(label, links, { role = "list", currentHref } = {}) {
  const items = links
    .map(
      (href) =>
        `<li><a href="${href}"${
          href === currentHref ? ' aria-current="page"' : ""
        }>${href}</a></li>`,
    )
    .join("");
  const roleAttr = role === null ? "" : ` role="${role}"`;
  return `<nav aria-label="${label}"><ul${roleAttr}>${items}</ul></nav>`;
}

/** Links present in the nav of every fixture page. */
const NAV_LINKS = ["/solutions", "/work", "/about"];

function fixture({
  route = "work",
  navRole = "list",
  primaryCurrent = "/work",
  footerCurrent = "/work",
  chipCss = CHIP_CSS,
  navCss = NAV_CSS,
  primaryNav,
  footerNav,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "check-a11y-"));
  const dist = join(root, "dist");
  mkdirSync(join(dist, "_astro"), { recursive: true });
  writeFileSync(join(dist, "_astro", "index.css"), `${navCss}\n${chipCss}`);

  const page = join(dist, route, "index.html");
  mkdirSync(dirname(page), { recursive: true });
  writeFileSync(
    join(page),
    `<!doctype html><title>x</title><h1>x</h1>` +
      (primaryNav ??
        nav("Primary", NAV_LINKS, {
          role: navRole,
          currentHref: primaryCurrent,
        })) +
      (footerNav ??
        nav("Footer", NAV_LINKS, {
          role: navRole,
          currentHref: footerCurrent,
        })),
  );
  return { root, dist };
}

function run(dist) {
  try {
    const stdout = execFileSync(process.execPath, [script, dist], {
      encoding: "utf8",
      stdio: "pipe",
    });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    return {
      code: error.status ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

test("passes on a compliant build", () => {
  const { dist } = fixture();
  const result = run(dist);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /check:a11y passed/);
});

test("REDS when the chip boundary regresses to --color-border", () => {
  const { dist } = fixture({
    chipCss:
      ".filter__chip[data-astro-cid-w]{padding:var(--space-xs);border:1px solid var(--color-border)}",
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /chip default boundary uses --color-border/);
});

test("REDS when the chip rule is missing entirely", () => {
  const { dist } = fixture({ chipCss: ".filter__count{color:red}" });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /could not locate the Work filter chip/);
});

test("REDS when a nav list loses role=list", () => {
  const { dist } = fixture({ navRole: null });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /lost role="list"/);
});

test("REDS when aria-current is missing on the current route", () => {
  const { dist } = fixture({
    primaryNav: nav("Primary", NAV_LINKS, {}),
    footerNav: nav("Footer", NAV_LINKS, {}),
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /marks \[\] aria-current, expected \[\/work\]/);
});

test("REDS when aria-current is added on a link that is not current", () => {
  const { dist } = fixture({
    primaryNav: nav("Primary", NAV_LINKS, { currentHref: "/about" }),
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(
    result.stderr,
    /marks \[\/about\] aria-current, expected \[\/work\]/,
  );
});

test("REDS when nav links carry no block padding", () => {
  const { dist } = fixture({
    navCss: ".primary-nav[data-astro-cid-h] a{color:red}",
  });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /carry no block padding/);
});

test("REDS when the primary nav is absent", () => {
  const { dist } = fixture({ primaryNav: "" });
  const result = run(dist);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /no <nav aria-label="Primary">/);
});

test("root route marks nothing current", () => {
  // On "/" no nav link targets the root, so none may be marked current.
  const { dist } = fixture({
    route: "",
    primaryCurrent: "/work",
    footerCurrent: "/work",
  });
  const result = run(dist);
  assert.equal(result.code, 1, "a non-root link marked current on / must RED");
  assert.match(result.stderr, /marks \[\/work\] aria-current, expected \[\]/);
});
