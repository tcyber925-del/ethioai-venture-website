/**
 * Regression suite for the ENG-85 analytics configuration and conversion
 * event classification (src/config/analytics.ts).
 *
 * Run: node --test — wired into `npm run verify` and the CI job.
 *
 * These cases encode the agreed event catalog from ENG-85's acceptance
 * criteria: (1) Start a Project CTA clicks, (2) project form start/submit
 * (delegation hook contract for ENG-83), (3) work/project opens,
 * (4) demo/GitHub proof-link clicks (explicit hooks only — no blanket
 * outbound tracking), (5) solution/research engagement. Keep them in sync
 * with the catalog documented in src/components/Analytics.astro.
 *
 * Privacy rules encoded here: external links without an explicit
 * `data-analytics-event` hook are never classified (no PII, no form
 * contents, no outbound-link harvesting — GoatCounter is cookieless and
 * events are counts keyed by event name only).
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  EVENT_HOOK_ATTRIBUTE,
  FORM_HOOK_ATTRIBUTE,
  FORM_START_EVENT,
  FORM_SUBMIT_EVENT,
  GOATCOUNTER_SITE_ID,
  analyticsEventForAnchor,
  goatcounterEndpoint,
} from "../src/config/analytics.ts";

describe("goatcounterEndpoint", () => {
  test("empty site ID (pending provisioning) disables analytics with null", () => {
    assert.equal(goatcounterEndpoint(""), null);
  });

  test("whitespace-only site ID also disables analytics", () => {
    assert.equal(goatcounterEndpoint("   "), null);
  });

  test("site ID derives the official count endpoint", () => {
    assert.equal(
      goatcounterEndpoint("mycode123"),
      "https://mycode123.goatcounter.com/count",
    );
  });

  test("surrounding whitespace in the site ID is tolerated", () => {
    assert.equal(
      goatcounterEndpoint("  mycode123\n"),
      "https://mycode123.goatcounter.com/count",
    );
  });

  test("current config is either pending (null) or a valid goatcounter endpoint", () => {
    const endpoint = goatcounterEndpoint(GOATCOUNTER_SITE_ID);
    assert.ok(
      endpoint === null ||
        /^https:\/\/[^/]+\.goatcounter\.com\/count$/.test(endpoint),
      `unexpected endpoint shape: ${endpoint}`,
    );
    assert.equal(typeof GOATCOUNTER_SITE_ID, "string");
  });
});

describe("delegation hook contract (documented for ENG-83)", () => {
  test("form hook attribute", () => {
    assert.equal(FORM_HOOK_ATTRIBUTE, "data-analytics-form");
  });

  test("element event hook attribute", () => {
    assert.equal(EVENT_HOOK_ATTRIBUTE, "data-analytics-event");
  });

  test("form event names", () => {
    assert.equal(FORM_START_EVENT, "form-start");
    assert.equal(FORM_SUBMIT_EVENT, "form-submit");
  });
});

describe("AC1 — Start a Project CTA clicks classify from href", () => {
  const cases = [
    ["/start-a-project", "cta-start-a-project"],
    ["/start-a-project/", "cta-start-a-project"],
    ["/start-a-project?from=nav#top", "cta-start-a-project"],
    // Prefix traps: near-miss paths are not CTAs.
    ["/start-a-project-old", null],
    ["/start-a-project/other", null],
  ];
  for (const [href, expected] of cases) {
    test(`"${href}" → ${expected}`, () => {
      assert.equal(analyticsEventForAnchor(href), expected);
    });
  }
});

describe("AC3 — work/project opens classify from href", () => {
  const cases = [
    ["/work", "work-open"],
    ["/work/", "work-open"],
    ["/work?status=x", "work-open"],
    ["/work/ethiobio", "project-open"],
    ["/work/ethiobio#evidence", "project-open"],
    // Prefix trap: "/workflow" is not the work surface.
    ["/workflow", null],
    ["/works", null],
  ];
  for (const [href, expected] of cases) {
    test(`"${href}" → ${expected}`, () => {
      assert.equal(analyticsEventForAnchor(href), expected);
    });
  }
});

describe("AC5 — solution/research engagement classifies from href", () => {
  const cases = [
    ["/solutions", "solution-open"],
    ["/solutions/workflow-automation", "solution-open"],
    ["/research", "research-open"],
    ["/research/some-note", "research-open"],
    // Prefix traps.
    ["/solutionsx", null],
    ["/researching", null],
  ];
  for (const [href, expected] of cases) {
    test(`"${href}" → ${expected}`, () => {
      assert.equal(analyticsEventForAnchor(href), expected);
    });
  }
});

describe("AC4 — demo/GitHub clicks require an explicit hook", () => {
  test("explicit hook wins over href classification", () => {
    assert.equal(
      analyticsEventForAnchor("https://github.com/org/repo", "github-click"),
      "github-click",
    );
    assert.equal(
      analyticsEventForAnchor("https://demo.example.com", "demo-click"),
      "demo-click",
    );
  });

  test("explicit hook works on internal hrefs too", () => {
    assert.equal(
      analyticsEventForAnchor("/whatever", "custom-event"),
      "custom-event",
    );
  });

  test("empty/whitespace explicit hook falls back to href classification", () => {
    assert.equal(analyticsEventForAnchor("/work", ""), "work-open");
    assert.equal(analyticsEventForAnchor("/work", "   "), "work-open");
    assert.equal(analyticsEventForAnchor("/about", "   "), null);
  });

  test("external links without a hook are never classified", () => {
    assert.equal(analyticsEventForAnchor("https://github.com/org/repo"), null);
    assert.equal(analyticsEventForAnchor("https://example.com"), null);
    assert.equal(analyticsEventForAnchor("//cdn.example.com/x"), null);
  });
});

describe("untracked surfaces stay null (privacy: counts only, no surprises)", () => {
  const cases = [
    "/",
    "/about",
    "#main",
    "mailto:hi@example.com",
    "tel:+25111",
    "",
    // Relative (non root-relative) refs are not emitted by the site and
    // are deliberately not guessed at.
    "work/ethiobio",
  ];
  for (const href of cases) {
    test(`"${href}" → null`, () => {
      assert.equal(analyticsEventForAnchor(href), null);
    });
  }
});
