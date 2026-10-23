/**
 * Tagged failures, without an exception hierarchy.
 *
 * Every server here discriminates a failure by a `kind` field rather than by
 * `instanceof`, because the tag survives serialisation, a module boundary and a
 * round trip through JSON, and a class does not. The five servers had
 * byte-identical copies of the machinery below and differed only in the union
 * of failures they name, which is the part worth writing per server.
 *
 * The symbol is namespaced per server on purpose. Two servers in one process
 * (a test, a future composed binary) must not catch each other's failures and
 * report them under their own remedies.
 */

type Thrown<E> = { readonly error: E };

export type ErrorKit<E> = {
  /** Throw a tagged failure. Returns `never`, so it can sit in a value position. */
  readonly fail: (error: E) => never;
  /** The failure, if this is one of ours. `undefined` for anything else. */
  readonly asAppError: (thrown: unknown) => E | undefined;
};

/**
 * `required(value, what)`: a field the wire schema marks optional that this
 * call cannot do without. Each server says what the absence becomes (Google's
 * is an API error, Oblio's a drift), so it passes `missing`.
 */
export const makeRequired =
  (missing: (what: string) => never) =>
  <T>(value: T | null | undefined, what: string): T =>
    value ?? missing(what);

export const makeErrorKit = <E>(namespace: string): ErrorKit<E> => {
  const tag = Symbol.for(`foreverworks.${namespace}.appError`);

  return {
    fail: (error: E): never => {
      throw { [tag]: true, error } as Thrown<E>;
    },
    asAppError: (thrown: unknown): E | undefined =>
      typeof thrown === "object" && thrown !== null && tag in thrown
        ? (thrown as unknown as Thrown<E>).error
        : undefined,
  };
};
