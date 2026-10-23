import { asAppError, fail } from "../domain/errors.js";

/**
 * Finish a file that was just created: fill a new Doc, lay out a new Sheet,
 * build a deck in a copied template. Shared by the three products' creates.
 *
 * If finishing fails, the file exists anyway. The failure says so and names
 * it, because the obvious retry (create again) would leave a second one.
 */
export const finishCreated = async <T>(
  created: { readonly id: string; readonly link: string },
  what: string,
  finish: () => Promise<T>,
): Promise<T> => {
  try {
    return await finish();
  } catch (thrown) {
    const error = asAppError(thrown);
    if (!error) throw thrown;
    return fail({
      ...error,
      message: `${error.message}; ${what} ${created.id} was created but not finished (${created.link}): finish or trash it rather than creating another`,
    });
  }
};
