// Strict-subset JSON Schema validator (draft 2020-12 kernel).
//
// This file is part of the SHIPPED pack: `tools/validate.mjs` uses it to
// check a job record against `schemas/job.schema.json` and an evidence package
// against `schemas/evidence.schema.json`. It is the repository's only JSON
// Schema validator, and it was promoted out of the test tree rather than
// copied, so the tests and the shipped tool cannot drift apart.
//
// No dependencies: no package.json, no ajv, nothing to install. It implements
// ONLY the keywords the schemas in this pack use, and THROWS on any keyword it
// does not implement. Throwing is the safe direction: a keyword silently
// ignored could hide the very constraint that separates a pass from a non-pass,
// and a false FAIL on a legitimate future keyword is the acceptable cost.
//
// `format` is deliberately NOT enforced. Draft 2020-12 makes format an
// annotation only; a validator that enforces nothing must not pretend to
// enforce it. The consequence -- the schemas' timestamps are unchecked -- is
// asserted explicitly in the repository's `tests/evidence.test.mjs` ("evidence
// records provenance per check"), so nobody later mistakes `format: date-time`
// for a guarantee.
//
// The keyword set grows one mutation per keyword, in the repository's
// `tests/schema-validator.test.mjs`, which exercises this file through the
// re-export in `tests/lib/schema-validator.mjs`.
import assert from "node:assert/strict";

/**
 * Structural deep equality for JSON values. Node's `assert.deepEqual` throws
 * instead of answering a question, and the validator below needs to answer
 * "is this value one of the enum members?" on every call.
 */
function deepEqualValue(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqualValue(v, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return deepEqualValue(ka, kb) && ka.every((k) => deepEqualValue(a[k], b[k]));
  }
  return false;
}

// --- the validator ----------------------------------------------------------

export const KNOWN_KEYWORDS = new Set([
  "$schema", "$id", "$defs", "$ref", "title", "description",
  "type", "enum", "const", "required", "properties", "additionalProperties",
  "items", "allOf", "if", "then", "else", "minLength", "maxLength",
  "minItems", "format", "pattern", "minimum", "maximum",
]);

const TYPE_OK = new Map([
  ["object", (d) => d !== null && typeof d === "object" && !Array.isArray(d)],
  ["array", (d) => Array.isArray(d)],
  ["string", (d) => typeof d === "string"],
  ["integer", (d) => typeof d === "number" && Number.isInteger(d)],
  ["number", (d) => typeof d === "number" && Number.isFinite(d)],
  ["boolean", (d) => typeof d === "boolean"],
  ["null", (d) => d === null],
]);

const describeValue = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);

/** Resolve a local JSON pointer such as `#/$defs/check` against the root. */
export function resolvePointer(root, pointer) {
  return pointer.split("/").reduce((node, token) => {
    const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
    assert.ok(
      node != null && Object.prototype.hasOwnProperty.call(node, key),
      `unresolvable $ref segment ${JSON.stringify(key)} in ${JSON.stringify(pointer)}`,
    );
    return node[key];
  }, root);
}

/** Validate `data`; returns an array of human-readable errors, empty if valid. */
export function validate(sch, data, root = sch, path = "$") {
  assert.ok(sch && typeof sch === "object" && !Array.isArray(sch),
    `${path}: a schema must be a JSON object`);
  for (const key of Object.keys(sch)) {
    assert.ok(KNOWN_KEYWORDS.has(key),
      `${path}: unsupported JSON Schema keyword ${JSON.stringify(key)} -- this validator will not guess its meaning, so it fails loudly instead of passing`);
  }
  const errors = [];

  if ("$ref" in sch) {
    assert.ok(typeof sch.$ref === "string" && sch.$ref.startsWith("#/"),
      `${path}: only local "#/..." $refs are supported, got ${JSON.stringify(sch.$ref)}`);
    // draft 2020-12: $ref no longer replaces its siblings, so fall through.
    errors.push(...validate(resolvePointer(root, sch.$ref.slice(2)), data, root, path));
  }
  if ("type" in sch) {
    const types = Array.isArray(sch.type) ? sch.type : [sch.type];
    for (const t of types) assert.ok(TYPE_OK.has(t), `${path}: unknown JSON Schema type ${JSON.stringify(t)}`);
    if (!types.some((t) => TYPE_OK.get(t)(data))) {
      errors.push(`${path}: expected type ${JSON.stringify(sch.type)}, got ${describeValue(data)}`);
    }
  }
  if ("const" in sch && !deepEqualValue(data, sch.const)) {
    errors.push(`${path}: expected const ${JSON.stringify(sch.const)}`);
  }
  if ("enum" in sch) {
    assert.ok(Array.isArray(sch.enum) && sch.enum.length > 0, `${path}: "enum" must be a non-empty array`);
    if (!sch.enum.some((v) => deepEqualValue(v, data))) {
      errors.push(`${path}: ${JSON.stringify(data)} is not one of ${JSON.stringify(sch.enum)}`);
    }
  }
  if ("minLength" in sch) {
    // The schema's own declaration is checked loudly -- a minLength on a schema
    // that is not a string schema is a mistake in the schema. The DATA's type is
    // not: a wrong type is already reported by the `type` check above, and a
    // value that is not a string has nothing left for a length rule to say. The
    // same reasoning `pattern` already used, because `base_commit` is null in
    // every queued record and still carries a pattern; without it a null value
    // threw an assertion here, turning a bad record into a crash in whatever
    // was validating it.
    const declared = sch.type === undefined ? [] : (Array.isArray(sch.type) ? sch.type : [sch.type]);
    assert.ok(declared.length === 0 || declared.includes("string"),
      `${path}: "minLength" is implemented only for strings, but this schema declares type ${JSON.stringify(sch.type)}`);
    if (typeof data === "string" && data.length < sch.minLength) {
      errors.push(`${path}: string of length ${data.length} is shorter than minLength ${sch.minLength}`);
    }
  }
  if ("maxLength" in sch) {
    const declared = sch.type === undefined ? [] : (Array.isArray(sch.type) ? sch.type : [sch.type]);
    assert.ok(declared.length === 0 || declared.includes("string"),
      `${path}: "maxLength" is implemented only for strings, but this schema declares type ${JSON.stringify(sch.type)}`);
    if (typeof data === "string" && data.length > sch.maxLength) {
      errors.push(`${path}: string of length ${data.length} is longer than maxLength ${sch.maxLength}`);
    }
  }
  if ("minItems" in sch) {
    // Only implemented for arrays, and it says so rather than silently
    // skipping: a `minItems` hung off a non-array schema would be a constraint
    // this validator cannot judge, which is the case it must fail loudly on.
    const types = sch.type === undefined ? [] : (Array.isArray(sch.type) ? sch.type : [sch.type]);
    assert.ok(types.includes("array"),
      `${path}: "minItems" is implemented only for arrays, but this schema declares type ${JSON.stringify(sch.type)}`);
    // A non-array value is already reported by the `type` check above, so there
    // is nothing for the length rule to say about it.
    if (Array.isArray(data) && data.length < sch.minItems) {
      errors.push(`${path}: array of ${data.length} items is shorter than minItems ${sch.minItems}`);
    }
  }

  // The string and numeric assertion keywords apply only to values of that
  // kind; draft 2020-12 says so, and this schema depends on it -- `base_commit`
  // is null in every queued record and still carries a `pattern`. Asserting on
  // a non-string here would throw on a valid record. A wrong type is already
  // reported by the `type` check, so there is nothing left for these to say.
  if ("pattern" in sch && typeof data === "string") {
    if (!new RegExp(sch.pattern).test(data)) {
      errors.push(`${path}: ${JSON.stringify(data)} does not match pattern ${JSON.stringify(sch.pattern)}`);
    }
  }
  if (typeof data === "number") {
    if ("minimum" in sch && data < sch.minimum) {
      errors.push(`${path}: ${data} is below minimum ${sch.minimum}`);
    }
    if ("maximum" in sch && data > sch.maximum) {
      errors.push(`${path}: ${data} is above maximum ${sch.maximum}`);
    }
  }

  if (Array.isArray(data)) {
    assert.ok("items" in sch,
      `${path}: an array schema without "items" is not supported -- this validator cannot judge the elements`);
    data.forEach((item, i) => errors.push(...validate(sch.items, item, root, `${path}[${i}]`)));
  } else if (data !== null && typeof data === "object") {
    for (const key of sch.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(data, key)) {
        errors.push(`${path}: missing required property ${JSON.stringify(key)}`);
      }
    }
    const props = sch.properties ?? {};
    for (const [key, sub] of Object.entries(props)) {
      if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
      errors.push(...validate(sub, data[key], root, `${path}.${key}`));
    }
    if ("additionalProperties" in sch) {
      for (const key of Object.keys(data)) {
        if (Object.prototype.hasOwnProperty.call(props, key)) continue;
        if (sch.additionalProperties === false) {
          errors.push(`${path}: additional property ${JSON.stringify(key)} is not allowed`);
        } else {
          assert.equal(typeof sch.additionalProperties, "object",
            `${path}: only additionalProperties:false or a schema is supported`);
          errors.push(...validate(sch.additionalProperties, data[key], root, `${path}.${key}`));
        }
      }
    }
  }
  for (const sub of sch.allOf ?? []) errors.push(...validate(sub, data, root, path));

  // `if` is evaluated as an ordinary schema. A schema whose `properties` do not
  // apply because the property is absent SUCCEEDS vacuously, which is what
  // draft 2020-12 says and what this schema relies on: a check that forgot to
  // say what happened satisfies the `if` and so inherits the `then` branch.
  // That is the safe direction -- a record with no result is treated as
  // needing a reason, not as a pass.
  if ("if" in sch) {
    assert.ok("then" in sch || "else" in sch, `${path}: "if" with neither "then" nor "else"`);
    const branch = validate(sch.if, data, root, path).length === 0 ? "then" : "else";
    if (branch in sch) errors.push(...validate(sch[branch], data, root, path));
  }
  return errors;
}
