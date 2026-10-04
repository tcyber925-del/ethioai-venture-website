/**
 * Analytics configuration and conversion-event classification — ENG-85.
 *
 * Provider decision (founder, 2026-10-04): GoatCounter, recorded in the
 * PRD ("Analytics mechanism") and on the ENG-85 issue description.
 *
 * Privacy facts about THIS integration (binding on everything in this
 * file and in src/components/Analytics.astro — claims here are limited
 * to what this code does; consent posture is a policy question pending
 * founder confirmation and is not decided by this code):
 * - This code sets no cookies and stores nothing client-side.
 * - Conversion events send one piece of data: the event name (in
 *   count.js's `path` field). No form contents, email addresses or any
 *   other PII are read or sent.
 * - External links are classified ONLY when they carry an explicit
 *   `data-analytics-event` hook (the demo/GitHub proof links). There is
 *   no blanket outbound-link tracking.
 * - While GOATCOUNTER_SITE_ID is pending, nothing is loaded and nothing
 *   is reported.
 *
 * This module is pure (no DOM APIs) so the classification rules are
 * covered by tests/analytics.test.mjs via `node --test`. The DOM wiring
 * lives in src/components/Analytics.astro.
 */

/**
 * GoatCounter site ID — SINGLE CONFIG CONSTANT (ENG-85).
 *
 * PENDING founder account provisioning (verified 2026-10-04: no site ID
 * exists yet). When the account is created, set this to the site code
 * shown in GoatCounter's snippet (e.g. "abc12345" from
 * https://abc12345.goatcounter.com/count). Empty string = analytics
 * disabled: no count script is rendered and no events are reported.
 *
 * Accepted form: the site slug only — lowercase letters, digits and
 * single hyphens ("abc12345", "my-site-1"). Anything else (spaces,
 * dots, full hostnames or URLs) is rejected by goatcounterEndpoint()
 * with a thrown error so a bad value fails the build instead of
 * silently emitting requests to a wrong origin.
 */
export const GOATCOUNTER_SITE_ID = "";

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
 * ID is pending (analytics disabled — the script tag is not rendered).
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
 * Classify a click target into a conversion-event name (the GoatCounter
 * `count({path, event:true})` key), or null when nothing should be sent.
 *
 * Precedence:
 * 1. An explicit `data-analytics-event` value (non-empty after trim) wins
 *    and is reported verbatim — this is how demo/GitHub clicks (AC4) and
 *    any future ad-hoc events attach.
 * 2. Internal root-relative hrefs are classified by path:
 *      /start-a-project       → cta-start-a-project   (AC1)
 *      /work                  → work-open             (AC3)
 *      /work/<slug>           → project-open          (AC3)
 *      /solutions[...]        → solution-open         (AC5)
 *      /research[...]         → research-open         (AC5)
 * 3. Everything else (external links without a hook, mailto:, tel:,
 *    in-page anchors, bare fragments, relative refs) → null.
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

  // Strip query and fragment; tolerate trailing slashes.
  const path = href.split(/[?#]/, 1)[0].replace(/\/+$/, "");
  if (path === "" || path === "/") return null;

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
