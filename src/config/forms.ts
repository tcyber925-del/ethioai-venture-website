/**
 * Form integration endpoint (ENG-83; spec 04 "Form integration boundary").
 *
 * The approved V1 mechanism is Formspree — a hosted form endpoint, so the
 * static site introduces no backend, database, CRM or authentication
 * (founder decision, 2026-10-04, recorded in PRD "Conversion mechanism"
 * and spec 04).
 *
 * PROVISIONED 2026-10-05: the founder created the form and supplied the
 * endpoint ID; replacing the placeholder with the real ID was the single
 * config change, and no other file references the endpoint
 * (tests/start-a-project.test.mjs enforces that).
 *
 * SPAM PROTECTION (founder decision, 2026-10-04 — no longer pending):
 * ship BOTH honeypot fields — the AC-literal `_honey` AND Formspree's
 * built-in discard field `_gotcha` (help.formspree.io, "Honeypot spam
 * filtering", all plans: a filled `_gotcha` is silently ignored
 * server-side). Both render hidden in the page's `.hp` wrapper.
 */
export const formspreeEndpoint = "https://formspree.io/f/xrpeggll";
