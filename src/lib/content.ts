/**
 * Whether an optional content field carries approved content.
 *
 * ENG-102: one predicate, shared. Three surfaces read the same collection
 * fields and each had grown its own test — truthiness on /work, a trim-nonempty
 * check on /solutions, and a bare `typeof === "string"` on the homepage. That
 * last one treated `evidence: ""` as content, so an entry could render an empty
 * evidence card on the homepage while the same field counted as pending on
 * /work — the exact evidence-versus-absence distinction the evidence policy
 * turns on, decided two different ways.
 *
 * The rule, stated once: a field counts as content when it is a string with at
 * least one non-whitespace character. Everything else is absence.
 */

/** True when a value is a string containing something other than whitespace. */
export function hasContent(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** True when a list carries at least one non-empty entry. */
export function hasListItem(value: readonly string[] | undefined): boolean {
  return Array.isArray(value) && value.some(hasContent);
}
