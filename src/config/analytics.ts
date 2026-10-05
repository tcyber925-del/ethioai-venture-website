/**
 * Analytics configuration and conversion-event classification — ENG-85.
 *
 * THIS FILE IS THE AUTHORITATIVE EVENT CATALOG (see the block above
 * analyticsEventForAnchor); src/components/Analytics.astro and
 * tests/analytics.test.mjs reference it instead of restating it.
 *
 * Decisions (provider, consent posture, measurement scope) are recorded
 * on the sources of truth — the PRD's "Analytics mechanism" section and
 * the ENG-85 decision comment on Linear — not restated as claims here;
 * this file only implements them.
 *
 * Privacy facts about THIS integration (claims here are limited to what
 * this code does; the consent posture is a founder policy decision recorded
 * in the records named above — no consent banner for V1):
 * - This code sets no cookies and stores nothing client-side.
 * - Conversion events send one piece of data: the event name (in
 *   count.js's `path` field). No form contents, email addresses or any
 *   other PII are read or sent.
 * - External links are classified ONLY when they carry an explicit
 *   `data-analytics-event` hook (the demo/GitHub proof links). There is
 *   no blanket outbound-link tracking.
 * - With an empty GOATCOUNTER_SITE_ID nothing is loaded and nothing is
 *   reported; the ID is provisioned (2026-10-05).
 *
 * This module is pure (no DOM APIs) so the classification rules are
 * covered by tests/analytics.test.mjs via `node --test`. The DOM wiring
 * lives in src/scripts/analytics-client.ts (init(win, doc)), rendered by
 * src/components/Analytics.astro.
 */

/**
 * GoatCounter site ID — SINGLE CONFIG CONSTANT (ENG-85).
 *
 * Provisioned by the founder 2026-10-05 (status recorded on Linear
 * ENG-85): the account name doubles as the site code, so this is the
 * "ethioaiventure" in
 * https://ethioaiventure.goatcounter.com/count. Empty string = analytics
 * disabled: no count script is rendered, no listeners ship, and no
 * events are reported (scripts/check-dist.mjs asserts this invariant
 * against dist/).
 *
 * Accepted form: the site slug only — lowercase letters, digits and
 * single hyphens ("abc12345", "my-site-1"). Anything else (spaces,
 * dots, full hostnames or URLs) is rejected by goatcounterEndpoint()
 * with a thrown error so a bad value fails the build instead of
 * silently emitting requests to a wrong origin.
 */
export const GOATCOUNTER_SITE_ID = "ethioaiventure";

/** Origin of the official count script (dependency-free, loaded async). */
export const GOATCOUNTER_COUNT_SCRIPT = "https://gc.zgo.at/count.js";

/**
 * Strict site-slug pattern: lowercase alphanumeric segments joined by
 * single hyphens, no leading/trailing hyphen. Mirrors the hostname
 * label form so the derived `${id}.goatcounter.com` is always a valid
 * origin (rejects spaces, dots, slashes, protocol prefixes, etc.).
 */
const SITE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Full count endpoint for the configured site ID, or null while the site
 * ID is empty (analytics disabled — the script tag is not rendered).
 *
 * @throws Error when the ID is non-empty but not a valid GoatCounter
 *   site slug, with a diagnostic naming the offending value.
 */
export function goatcounterEndpoint(siteId: string): string | null {
  const trimmed = siteId.trim();
  if (trimmed === "") return null;
  if (!SITE_SLUG_PATTERN.test(trimmed)) {
    throw new Error(
      `Invalid GOATCOUNTER_SITE_ID ${JSON.stringify(trimmed)}: expected the ` +
        `GoatCounter site slug only (lowercase letters, digits, hyphens — ` +
        `e.g. "abc12345"), not a hostname or URL.`,
    );
  }
  return `https://${trimmed}.goatcounter.com/count`;
}

/**
 * Delegation hook contract (documented for ENG-83's form markup):
 * a `<form data-analytics-form>` gets `form-start` on the first focusin
 * inside it (once per page) and `form-submit` on submit. The attribute
 * value is ignored; presence is the switch. No field values are read.
 */
export const FORM_HOOK_ATTRIBUTE = "data-analytics-form";

/**
 * Explicit event hook: `data-analytics-event="some-event"` on any element
 * (or an ancestor of a clicked link) reports that event name verbatim.
 * Used for the demo/GitHub proof links (AC4) — external hrefs are never
 * classified without this hook.
 */
export const EVENT_HOOK_ATTRIBUTE = "data-analytics-event";

/** Form lifecycle event names (AC2). */
export const FORM_START_EVENT = "form-start";
export const FORM_SUBMIT_EVENT = "form-submit";

/**
 * Section-open events that count IN-CONTENT clicks only (founder
 * decision recorded on Linear ENG-85): a click must land inside `<main>`
 * or it is not reported, so header/footer navigation clicks on the same
 * hrefs never inflate engagement counts. The DOM check lives in
 * src/scripts/analytics-client.ts; classification here stays pure.
 */
export const SECTION_OPEN_EVENTS: ReadonlySet<string> = new Set([
  "work-open",
  "solution-open",
  "research-open",
]);

/**
 * ── EVENT CATALOG (authoritative — ENG-85 acceptance criteria) ────────────
 * The single copy; Analytics.astro and tests/analytics.test.mjs reference
 * this block. Names are the GoatCounter event keys
 * (`window.goatcounter.count({path: <name>, event: true})`):
 *
 *   cta-start-a-project  click on /start-a-project          (AC1)
 *   form-start           first focusin in the hooked form   (AC2)
 *   form-submit          submit of the hooked form          (AC2)
 *   work-open            click on /work, in-content only    (AC3)
 *   project-open         click on /work/<slug>              (AC3)
 *   github-click         explicit hook, GitHub proof link   (AC4)
 *   demo-click           explicit hook, demo proof link     (AC4)
 *   solution-open        click on /solutions[...], in-content only (AC5)
 *   research-open        click on /research[...], in-content only   (AC5)
 *
 * "In-content only" = inside <main> (SECTION_OPEN_EVENTS above).
 *
 * Delegation hooks (contract for ENG-83 and future markup):
 * - `data-analytics-event="name"` on any element (or an ancestor of a
 *   clicked link) reports that event name verbatim; explicit hooks win
 *   over href classification. External links are NEVER classified from
 *   their href — no blanket outbound tracking.
 * - `<form data-analytics-form>` (attribute presence, value ignored)
 *   gets `form-start` once per page on first focusin inside it and
 *   `form-submit` on submit. Field values are never read.
 */

/**
 * Classify a click target into a conversion-event name (the GoatCounter
 * `count({path, event:true})` key), or null when nothing should be sent.
 * Mapping table: see the EVENT CATALOG block above.
 *
 * Precedence:
 * 1. An explicit `data-analytics-event` value (non-empty after trim) wins
 *    and is reported verbatim — this is how demo/GitHub clicks (AC4) and
 *    any future ad-hoc events attach.
 * 2. Internal root-relative hrefs are classified by path (catalog above).
 * 3. Everything else (external links without a hook, mailto:, tel:,
 *    in-page anchors, bare fragments, relative refs) → null.
 *
 * Note: whether a classified event is actually REPORTED (e.g. the
 * in-content-only rule for SECTION_OPEN_EVENTS) is the caller's concern —
 * this function classifies purely from the href/hook.
 *
 * @param href the raw href attribute of the clicked anchor (or "")
 * @param explicitEvent the `data-analytics-event` value found on the
 *   element or its ancestors, if any
 */
export function analyticsEventForAnchor(
  href: string,
  explicitEvent?: string | null,
): string | null {
  const explicit = explicitEvent?.trim();
  if (explicit !== undefined && explicit !== "") return explicit;

  if (!href.startsWith("/")) return null;
  // Protocol-relative ("//host/x") starts with "/" but is external.
  if (href.startsWith("//")) return null;

  // Strip query and fragment; tolerate trailing slashes. "/" → "".
  const path = href.split(/[?#]/, 1)[0].replace(/\/+$/, "");
  if (path === "") return null;

  if (path === "/start-a-project") return "cta-start-a-project";
  if (path === "/work") return "work-open";
  if (path.startsWith("/work/")) return "project-open";
  if (path === "/solutions" || path.startsWith("/solutions/")) {
    return "solution-open";
  }
  if (path === "/research" || path.startsWith("/research/")) {
    return "research-open";
  }
  return null;
}
