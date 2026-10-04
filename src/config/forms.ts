/**
 * Form integration endpoint (ENG-83; spec 04 "Form integration boundary").
 *
 * The approved V1 mechanism is Formspree — a hosted form endpoint, so the
 * static site introduces no backend, database, CRM or authentication
 * (founder decision, 2026-10-04, recorded in PRD "Conversion mechanism"
 * and spec 04).
 *
 * PENDING: the Formspree form endpoint ID has not been provisioned by the
 * founder yet. Until it arrives, this constant keeps its placeholder value
 * and submissions cannot succeed — replacing `PENDING_FORMSPREE_ID` with
 * the founder-provisioned ID is the single config change; no other file
 * references the endpoint (tests/start-a-project.test.mjs enforces that).
 *
 * SPAM PROTECTION (founder decision, 2026-10-04 — no longer pending):
 * ship BOTH honeypot fields — the AC-literal `_honey` AND Formspree's
 * built-in discard field `_gotcha` (help.formspree.io, "Honeypot spam
 * filtering", all plans: a filled `_gotcha` is silently ignored
 * server-side). Both render hidden in the page's `.hp` wrapper.
 */
export const formspreeEndpoint = "https://formspree.io/f/PENDING_FORMSPREE_ID";
