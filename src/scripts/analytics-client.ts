/**
 * Analytics client — delegated conversion-event listeners (ENG-85).
 *
 * Extracted from src/components/Analytics.astro so `node --test` can
 * exercise the wiring with fake globals (tests/analytics-client.test.mjs,
 * no DOM dependency). The component calls init(window, document) from its
 * gated <script> and renders nothing while GOATCOUNTER_SITE_ID is empty.
 *
 * Event names and hook contracts: the EVENT CATALOG block in
 * src/config/analytics.ts (authoritative single copy). Decision records
 * (provider, consent posture, in-content scope): PRD "Analytics mechanism"
 * and the ENG-85 decision comment on Linear — this module only implements
 * them.
 *
 * Privacy facts about THIS module only: it sets no cookies, stores nothing
 * beyond an in-memory bounded queue, reads no form field values, and sends
 * only event names via window.goatcounter.count({path: <name>, event: true})
 * (the documented GoatCounter events API — `path` carries the event name;
 * this module sends no page URL of its own).
 */

/** The slice of GoatCounter's count.js API this module uses. */
export interface GoatCounterApi {
  count(vars: { path: string; event: boolean }): void;
}

/** Minimal element surface (structurally satisfied by DOM elements). */
export interface AnalyticsElement {
  closest(selector: string): AnalyticsElement | null;
  getAttribute(name: string): string | null;
  matches(selector: string): boolean;
}

/** Minimal window surface: event registration + the count.js API. */
export interface AnalyticsWindow {
  goatcounter?: GoatCounterApi;
  addEventListener(
    type: string,
    listener: (event: { target: unknown }) => void,
  ): void;
}

/** Minimal document surface: event registration (delegation root). */
export interface AnalyticsDocument {
  addEventListener(
    type: string,
    listener: (event: { target: unknown }) => void,
  ): void;
}

import {
  analyticsEventForAnchor,
  EVENT_HOOK_ATTRIBUTE,
  FORM_HOOK_ATTRIBUTE,
  FORM_START_EVENT,
  FORM_SUBMIT_EVENT,
  SECTION_OPEN_EVENTS,
} from "../config/analytics.ts";

/**
 * Duck-typed element guard (no `instanceof Element`: this module must run
 * under node:test with fakes — and Text/non-element targets lack closest).
 */
function asElement(value: unknown): AnalyticsElement | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<AnalyticsElement>;
  if (
    typeof candidate.closest !== "function" ||
    typeof candidate.getAttribute !== "function" ||
    typeof candidate.matches !== "function"
  ) {
    return null;
  }
  return candidate as AnalyticsElement;
}

/**
 * Wire delegated click/focusin/submit listeners on `doc` and queue/flush
 * reporting through `win.goatcounter`.
 *
 * Reporting semantics: count.js may execute after this module runs (async)
 * or never arrive (blocked/absent). While the API is missing, events go to
 * a bounded queue (drop-oldest — never unbounded, never grows after the
 * cap). Queued events are flushed at `load` IF the API is already there,
 * and otherwise on the FIRST report() once the API appears — a slow count.js
 * never loses pre-load events (e.g. an autofocused form-start). If the API
 * never appears the queue simply stays capped and nothing is sent.
 */
export function init(win: AnalyticsWindow, doc: AnalyticsDocument): void {
  const QUEUE_LIMIT = 20;
  const queued: string[] = [];

  function flush(): void {
    const api = win.goatcounter;
    if (!api || typeof api.count !== "function") return;
    for (const name of queued.splice(0)) {
      api.count({ path: name, event: true });
    }
  }

  function report(eventName: string): void {
    const api = win.goatcounter;
    if (api && typeof api.count === "function") {
      flush(); // first report after the API appears drains any backlog first
      api.count({ path: eventName, event: true });
      return;
    }
    if (queued.length >= QUEUE_LIMIT) queued.shift(); // drop-oldest cap
    queued.push(eventName);
  }

  win.addEventListener("load", () => {
    flush(); // no-op when count.js hasn't run yet; report() flushes later
  });

  /* Click delegation: explicit data-analytics-event hook (element or
     ancestor) wins, else classify the nearest anchor's href. Section-open
     events (SECTION_OPEN_EVENTS) report only when the click lands inside
     <main> — header/footer nav clicks on the same hrefs don't count
     (founder decision recorded on Linear ENG-85). */
  doc.addEventListener("click", (event) => {
    const target = asElement(event.target);
    if (target === null) return;
    const hook =
      target
        .closest(`[${EVENT_HOOK_ATTRIBUTE}]`)
        ?.getAttribute(EVENT_HOOK_ATTRIBUTE) ?? undefined;
    const href = target.closest("a[href]")?.getAttribute("href") ?? "";
    const eventName = analyticsEventForAnchor(href, hook);
    if (eventName === null) return;
    if (SECTION_OPEN_EVENTS.has(eventName) && target.closest("main") === null) {
      return;
    }
    report(eventName);
  });

  /* Form lifecycle (AC2): first focusin starts, submit submits.
     Presence of the attribute is the switch; field values never read. */
  const startedForms = new WeakSet<object>();

  doc.addEventListener("focusin", (event) => {
    const target = asElement(event.target);
    if (target === null) return;
    const form = target.closest(`form[${FORM_HOOK_ATTRIBUTE}]`);
    if (form === null || startedForms.has(form)) return;
    startedForms.add(form);
    report(FORM_START_EVENT);
  });

  doc.addEventListener("submit", (event) => {
    const form = asElement(event.target);
    if (form === null) return;
    if (!form.matches(`form[${FORM_HOOK_ATTRIBUTE}]`)) return;
    report(FORM_SUBMIT_EVENT);
  });
}
