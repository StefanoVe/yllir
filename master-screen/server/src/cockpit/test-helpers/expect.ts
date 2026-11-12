// The subset of the expect API the cockpit tests use, on top of node:assert.
// The tests run on node:test; this keeps their assertions as they were written.
// Typed loosely on purpose: the matchers are checked at run time, not by the compiler.
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";

interface Asymmetric {
  readonly asymmetric: true;
  test(value: unknown): boolean;
}

const isAsymmetric = (value: unknown): value is Asymmetric =>
  typeof value === "object" && value !== null && (value as Asymmetric).asymmetric === true;

/**
 * Deep comparison. Partial mode checks only the keys of the expected object (toMatchObject);
 * strict mode requires the same defined keys (toEqual). Asymmetric matchers are honoured.
 */
function deepMatch(actual: unknown, expected: unknown, partial: boolean): boolean {
  if (isAsymmetric(expected)) return expected.test(actual);
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((item, index) => deepMatch(actual[index], item, partial))
    );
  }
  if (expected && typeof expected === "object" && Object.getPrototypeOf(expected) === Object.prototype) {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
    const record = actual as Record<string, unknown>;
    const wanted = Object.entries(expected).filter(([, value]) => value !== undefined);
    if (!partial) {
      const have = Object.keys(record).filter((key) => record[key] !== undefined);
      if (have.length !== wanted.length) return false;
    }
    return wanted.every(([key, value]) => deepMatch(record[key], value, partial));
  }
  if (typeof expected === "object" && expected !== null) return isDeepStrictEqual(actual, expected);
  return Object.is(actual, expected) || (typeof expected === "number" && actual === expected);
}

const show = (value: unknown) => {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

function matchesError(error: unknown, expected?: unknown): boolean {
  if (expected === undefined) return true;
  const message = error instanceof Error ? error.message : String(error);
  if (typeof expected === "string") return message.includes(expected);
  if (expected instanceof RegExp) return expected.test(message);
  if (typeof expected === "function") return error instanceof (expected as new (...args: never[]) => unknown);
  return false;
}

function thrownBy(run: () => unknown): { error: unknown } | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return { error };
  }
}

function matchers(actual: unknown, negate: boolean): Record<string, unknown> {
  const check = (pass: boolean, message: string) => {
    if (pass === negate) {
      throw new assert.AssertionError({
        message: `${negate ? "expected not: " : "expected: "}${message}`,
      });
    }
  };
  const length = () => (actual as { length?: number } | null | undefined)?.length;
  const many = () => Array.from(actual as Iterable<unknown>);
  const result: Record<string, unknown> = {
    get not() {
      return matchers(actual, !negate);
    },
    get rejects() {
      // Matchers run on the rejection reason; toThrow checks its message.
      const reason = async () => {
        try {
          await (actual as Promise<unknown>);
        } catch (error) {
          return { error };
        }
        throw new assert.AssertionError({ message: "expected the promise to reject" });
      };
      return new Proxy(
        {},
        {
          get:
            (_target, name: string) =>
            async (...args: unknown[]) => {
              const { error } = await reason();
              if (name === "toThrow") {
                check(matchesError(error, args[0]), `a rejection matching ${String(args[0] ?? "")}`);
                return;
              }
              return (matchers(error, negate)[name] as (...values: unknown[]) => unknown)(...args);
            },
        },
      );
    },
    toBe: (expected: unknown) => check(Object.is(actual, expected), `${show(actual)} to be ${show(expected)}`),
    toEqual: (expected: unknown) => check(deepMatch(actual, expected, false), `${show(actual)} to equal ${show(expected)}`),
    toMatchObject: (expected: unknown) =>
      check(deepMatch(actual, expected, true), `${show(actual)} to match ${show(expected)}`),
    toContain: (item: unknown) =>
      check(
        typeof actual === "string" ? actual.includes(String(item)) : many().includes(item),
        `${show(actual)} to contain ${show(item)}`,
      ),
    toContainEqual: (item: unknown) =>
      check(
        many().some((value) => deepMatch(value, item, false)),
        `${show(actual)} to contain an item equal to ${show(item)}`,
      ),
    toHaveLength: (expected: number) => check(length() === expected, `length ${show(length())} to be ${expected}`),
    toHaveProperty: (name: string) =>
      check(actual !== null && actual !== undefined && name in Object(actual), `${show(actual)} to have property ${name}`),
    toBeNull: () => check(actual === null, `${show(actual)} to be null`),
    toBeUndefined: () => check(actual === undefined, `${show(actual)} to be undefined`),
    toBeDefined: () => check(actual !== undefined, "a defined value"),
    toBeTruthy: () => check(Boolean(actual), `${show(actual)} to be truthy`),
    toBeFalsy: () => check(!actual, `${show(actual)} to be falsy`),
    toBeString: () => check(typeof actual === "string", `${show(actual)} to be a string`),
    toBeInstanceOf: (expected: new (...args: never[]) => unknown) =>
      check(actual instanceof expected, `${show(actual)} to be an instance of ${expected.name}`),
    toBeGreaterThan: (n: number) => check((actual as number) > n, `${show(actual)} to be greater than ${n}`),
    toBeGreaterThanOrEqual: (n: number) =>
      check((actual as number) >= n, `${show(actual)} to be greater than or equal to ${n}`),
    toBeLessThan: (n: number) => check((actual as number) < n, `${show(actual)} to be less than ${n}`),
    toBeLessThanOrEqual: (n: number) =>
      check((actual as number) <= n, `${show(actual)} to be less than or equal to ${n}`),
    toStartWith: (prefix: string) =>
      check(typeof actual === "string" && actual.startsWith(prefix), `${show(actual)} to start with ${show(prefix)}`),
    toThrow: (expected?: unknown) => {
      const thrown = typeof actual === "function" ? thrownBy(actual as () => unknown) : undefined;
      check(Boolean(thrown) && matchesError(thrown?.error, expected), `a function to throw ${String(expected ?? "")}`);
    },
  };
  return result;
}

/** expect.stringContaining(text): an asymmetric matcher for strings. */
const stringContaining = (text: string): Asymmetric => ({
  asymmetric: true,
  test: (value) => typeof value === "string" && value.includes(text),
});

// Loosely typed: see the note at the top of this file.
export const expect: ((actual: unknown) => any) & { stringContaining: typeof stringContaining } = Object.assign(
  (actual: unknown) => matchers(actual, false),
  { stringContaining },
);
