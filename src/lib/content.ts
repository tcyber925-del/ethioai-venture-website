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

/**
 * True when a list carries at least one non-empty entry.
 *
 * A type predicate, not a boolean. `astro check` rejected
 * `{hasListItem(data.technologies) && data.technologies.map(…)}` with
 * "'data.technologies' is possibly 'undefined'" — a presence test that cannot
 * narrow tells the caller nothing, so the natural guard does not typecheck and
 * the local `&& data.technologies.length > 0` creeps back in alongside it.
 */
export function hasListItem(
  value: readonly string[] | undefined,
): value is readonly string[] {
  return Array.isArray(value) && value.some(hasContent);
}

/**
 * True when any of the given fields carries content.
 *
 * For the "one of these two, or neither" shape — `{(topic || status) && …}`
 * guarding a pair of labels. Expressed once so the wrapper and its children
 * cannot disagree: if the wrapper kept truthiness while the children used
 * `hasContent`, a whitespace-only value would print an empty `<p>` there while
 * counting as absence everywhere else.
 */
export function hasContentOrAny(values: readonly unknown[]): boolean {
  return values.some(hasContent);
}
