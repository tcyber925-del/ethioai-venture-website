/**
 * Regression battery for the ENG-85 analytics CLIENT (the DOM wiring that
 * used to live inside Analytics.astro): src/scripts/analytics-client.ts.
 *
 * Run: node --test — wired into `npm run verify` and the CI job.
 *
 * Covers with fake globals (no DOM, no dependencies): hook-over-href
 * precedence, the in-content-only rule for section-open events, CTA/
 * project classification, once-per-form form-start, submit wiring, the
 * bounded drop-oldest queue, load-time flush, and flush-on-first-report
 * once the count.js API appears (a slow count.js must not lose pre-load
 * events).
 *
 * The event catalog and hook contract are NOT restated here — see the
 * EVENT CATALOG block in src/config/analytics.ts (authoritative).
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { init } from "../src/scripts/analytics-client.ts";
import { SECTION_OPEN_EVENTS } from "../src/config/analytics.ts";

/**
 * Minimal selector support for the four selector shapes the client uses:
 * `main`, `[data-analytics-event]`, `a[href]`, `form[data-analytics-form]`.
 */
function selectorMatches(node, selector) {
  const parsed = /^([a-z]+)?(?:\[([^\]]+)\])?$/.exec(selector);
  if (parsed === null)
    throw new Error(`unsupported fake selector: ${selector}`);
  const [, tag, attribute] = parsed;
  if (tag !== undefined && tag !== node.tag) return false;
  if (attribute !== undefined && !(attribute in node.attrs)) return false;
  return true;
}

/** Fake element with real closest()/matches()/getAttribute() semantics. */
function makeElement({ tag = "div", attrs = {}, parent = null } = {}) {
  const node = {
    tag,
    attrs,
    parent,
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    matches: (selector) => selectorMatches(node, selector),
    closest(selector) {
      let current = node;
      while (current !== null) {
        if (selectorMatches(current, selector)) return current;
        current = current.parent;
      }
      return null;
    },
  };
  return node;
}

/** Shared document tree: <main> (with a hooked form), header and footer. */
const tree = {
  main: makeElement({ tag: "main" }),
  header: makeElement({ tag: "header" }),
  footer: makeElement({ tag: "footer" }),
};
tree.form = makeElement({
  tag: "form",
  attrs: { "data-analytics-form": "" },
  parent: tree.main,
});

/** An anchor inside `parent` (defaults to <main>); omit href for hook-only. */
function link(href, { parent = tree.main, hook } = {}) {
  return makeElement({
    tag: "a",
    attrs: {
      ...(href === undefined ? {} : { href }),
      ...(hook ? { "data-analytics-event": hook } : {}),
    },
    parent,
  });
}

/**
 * Wire init() against fake globals; returns firing helpers plus the
 * recorded window.goatcounter.count() payloads.
 */
function harness() {
  const winListeners = [];
  const docListeners = [];
  const calls = [];
  const win = {
    goatcounter: undefined,
    addEventListener(type, listener) {
      winListeners.push({ type, listener });
    },
  };
  const doc = {
    addEventListener(type, listener) {
      docListeners.push({ type, listener });
    },
  };
  init(win, doc);
  return {
    /** Make the count.js API appear (as an async script would). */
    loadCountJs: () => {
      win.goatcounter = { count: (vars) => calls.push(vars) };
    },
    fire: (type, target) => {
      for (const { type: t, listener } of docListeners) {
        if (t === type) listener({ target });
      }
    },
    fireLoad: () => {
      for (const { type: t, listener } of winListeners) {
        if (t === "load") listener({ target: null });
      }
    },
    paths: () => calls.map((c) => c.path),
  };
}

describe("listeners are registered on the fake globals", () => {
  test("registers load on window and click/focusin/submit on document", () => {
    const winTypes = [];
    const docTypes = [];
    init(
      { addEventListener: (type) => winTypes.push(type) },
      { addEventListener: (type) => docTypes.push(type) },
    );
    assert.deepEqual(winTypes, ["load"]);
    assert.deepEqual(docTypes, ["click", "focusin", "submit"]);
  });
});

describe("click delegation (AC1, AC3, AC5)", () => {
  test("in-content anchor clicks classify from href", () => {
    for (const [href, expected] of [
      ["/start-a-project", "cta-start-a-project"],
      ["/work", "work-open"],
      ["/work/ethiobio", "project-open"],
      ["/solutions", "solution-open"],
      ["/research", "research-open"],
    ]) {
      const h = harness();
      h.loadCountJs();
      h.fire("click", link(href));
      assert.deepEqual(h.paths(), [expected], `for ${href}`);
    }
  });

  test("section-open events are in-content only: header/footer nav clicks don't count", () => {
    const hrefs = {
      "work-open": "/work",
      "solution-open": "/solutions",
      "research-open": "/research",
    };
    for (const name of SECTION_OPEN_EVENTS) {
      const href = hrefs[name];
      assert.ok(href, `no href mapping for ${name}`);
      for (const zone of ["header", "footer"]) {
        const h = harness();
        h.loadCountJs();
        h.fire("click", link(href, { parent: tree[zone] }));
        assert.deepEqual(h.paths(), [], `${name} from ${zone} must not report`);
      }
      const inContent = harness();
      inContent.loadCountJs();
      inContent.fire("click", link(href));
      assert.deepEqual(
        inContent.paths(),
        [name],
        `${name} in-content must report`,
      );
    }
  });

  test("CTA clicks count from nav too (cta-start-a-project is not in-content gated)", () => {
    const h = harness();
    h.loadCountJs();
    h.fire("click", link("/start-a-project", { parent: tree.header }));
    assert.deepEqual(h.paths(), ["cta-start-a-project"]);
  });

  test("unclassified surfaces report nothing", () => {
    const h = harness();
    h.loadCountJs();
    h.fire("click", link("/about"));
    h.fire("click", link("https://example.com"));
    h.fire("click", link(undefined));
    assert.deepEqual(h.paths(), []);
  });
});

describe("explicit hook precedence (AC4)", () => {
  test("data-analytics-event on the anchor wins over href classification", () => {
    const h = harness();
    h.loadCountJs();
    h.fire(
      "click",
      link("https://github.com/org/repo", { hook: "github-click" }),
    );
    h.fire("click", link("https://demo.example.com", { hook: "demo-click" }));
    assert.deepEqual(h.paths(), ["github-click", "demo-click"]);
  });

  test("a hook on an ancestor wins over the anchor href", () => {
    const wrapper = makeElement({
      tag: "div",
      attrs: { "data-analytics-event": "cta-start-a-project" },
      parent: tree.main,
    });
    const anchor = makeElement({
      tag: "a",
      attrs: { href: "/work" },
      parent: wrapper,
    });
    const h = harness();
    h.loadCountJs();
    h.fire("click", anchor);
    assert.deepEqual(h.paths(), ["cta-start-a-project"]);
  });

  test("hooks report even outside <main> (only section-open events are gated)", () => {
    const h = harness();
    h.loadCountJs();
    h.fire(
      "click",
      link("https://github.com/org/repo", {
        parent: tree.header,
        hook: "github-click",
      }),
    );
    assert.deepEqual(h.paths(), ["github-click"]);
  });

  test("non-element targets are ignored", () => {
    const h = harness();
    h.loadCountJs();
    h.fire("click", null);
    h.fire("click", "text node");
    h.fire("click", { nodeType: 3 });
    assert.deepEqual(h.paths(), []);
  });
});

describe("form lifecycle (AC2)", () => {
  test("first focusin in the hooked form reports form-start exactly once", () => {
    const h = harness();
    h.loadCountJs();
    h.fire("focusin", makeElement({ tag: "input", parent: tree.form }));
    h.fire("focusin", makeElement({ tag: "input", parent: tree.form }));
    assert.deepEqual(h.paths(), ["form-start"]);
  });

  test("focusin outside a hooked form reports nothing", () => {
    const h = harness();
    h.loadCountJs();
    h.fire("focusin", makeElement({ tag: "input", parent: tree.main }));
    assert.deepEqual(h.paths(), []);
  });

  test("submit on the hooked form reports form-submit; unhooked forms don't", () => {
    const h = harness();
    h.loadCountJs();
    h.fire("submit", tree.form);
    h.fire("submit", makeElement({ tag: "form", parent: tree.main }));
    assert.deepEqual(h.paths(), ["form-submit"]);
  });

  test("submit target without element surface is ignored", () => {
    const h = harness();
    h.loadCountJs();
    h.fire("submit", null);
    assert.deepEqual(h.paths(), []);
  });
});

describe("queue and flush semantics", () => {
  test("events before count.js arrives are queued, then flushed on the first report", () => {
    const h = harness();
    h.fire("click", link("/work"));
    assert.deepEqual(h.paths(), [], "nothing is sent while count.js is absent");
    h.loadCountJs();
    h.fire("click", link("/work"));
    assert.deepEqual(h.paths(), ["work-open", "work-open"]);
  });

  test("a slow count.js that appears after load still receives pre-load events", () => {
    const h = harness();
    h.fire("focusin", makeElement({ tag: "input", parent: tree.form }));
    h.fireLoad();
    assert.deepEqual(h.paths(), [], "still absent at load — nothing sent yet");
    h.loadCountJs();
    h.fire("click", link("/work"));
    assert.deepEqual(h.paths(), ["form-start", "work-open"]);
  });

  test("load flushes the queue when count.js already ran", () => {
    const h = harness();
    h.fire("click", link("/work"));
    h.loadCountJs();
    h.fireLoad();
    assert.deepEqual(h.paths(), ["work-open"]);
  });

  test("queue is bounded with drop-oldest semantics", () => {
    const h = harness();
    for (let i = 0; i < 25; i += 1) h.fire("click", link("/work"));
    h.loadCountJs();
    h.fire("click", link("/work"));
    assert.equal(h.paths().length, 21, "20 queued + the new event");
  });

  test("nothing is ever sent when count.js never appears", () => {
    const h = harness();
    for (let i = 0; i < 30; i += 1) h.fire("click", link("/work"));
    h.fireLoad();
    h.fire("click", link("/work"));
    assert.deepEqual(h.paths(), []);
  });
});
