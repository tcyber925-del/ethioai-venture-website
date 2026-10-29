// pack/tools/lib/state-machine.mjs
//
// The transition table, read from `reference/state-machine.md`.
//
// The table is the pack's canonical list of legal transitions, and this
// validator measures against it rather than keeping its own copy. A copy
// would drift: the table would gain a row, the code would not, and the
// validator would permit a transition the pack forbids, or refuse one it
// allows. So the edges come from the document, and only the PREDICATES -- what
// has to be true on disk for a row's trigger to hold -- live in code.
//
// The three `intake` rows are conversational. The document says so itself: the
// intake gate runs before any `job.json` exists, so a held request sits at
// `needs_clarification` in the conversation only. There is nothing on disk to
// inspect for them, so the validator does not implement them.
import { readFileSync } from "node:fs";
import { referencePath } from "./pack-paths.mjs";

/** The stages whose transitions describe the conversation, not a record. */
export const CONVERSATIONAL_STAGES = Object.freeze(["intake", "needs_clarification"]);

/** The section of the document a heading introduces, up to the next heading. */
export function section(markdown, heading) {
  const start = markdown.indexOf(heading);
  if (start === -1) return "";
  const rest = markdown.slice(start + heading.length);
  const next = rest.search(/\n#{1,6} /);
  return next === -1 ? rest : rest.slice(0, next);
}

/**
 * The transition rows, in document order.
 *
 * A row is `| from | to | trigger |`. The header row and the separator row
 * carry no backticked stage names, so they do not match.
 */
export function parseTransitionRows(markdown) {
  const table = section(markdown, "## Transitions");
  const rows = [];
  for (const line of table.split("\n")) {
    const match = /^\|\s*`([a-z_]+)`\s*\|\s*`([a-z_]+)`\s*\|\s*(.+?)\s*\|?\s*$/.exec(line);
    if (match) rows.push({ from: match[1], to: match[2], trigger: match[3] });
  }
  return rows;
}

/** The stage names the document lists, in order. */
export function parseStageNames(markdown) {
  const list = section(markdown, "## Stages");
  const names = [];
  for (const match of list.matchAll(/`([a-z_]+)`/g)) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

/** Is this row one of the conversational ones? */
export function isConversational(row) {
  return CONVERSATIONAL_STAGES.includes(row.from);
}

/** The key a predicate is registered under. */
export const edgeKey = (from, to) => `${from}>${to}`;

/** The document, read from the pack's own `reference/` directory. */
export function readStateMachine() {
  return readFileSync(referencePath("state-machine.md"), "utf8");
}

/**
 * The table as the validator sees it: every row, the conversational rows
 * marked, and the rows this validator has a predicate for.
 */
export function loadTransitions() {
  const markdown = readStateMachine();
  const rows = parseTransitionRows(markdown);
  return {
    markdown,
    rows,
    stages: parseStageNames(markdown),
    conversational: rows.filter(isConversational),
    implemented: rows.filter((row) => !isConversational(row)),
  };
}
