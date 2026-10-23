/**
 * Google's scope URLs that more than one product here names, and the one way
 * a granted scope string is read. Pure. A scope only one product uses lives in
 * that product's domain/grants.ts.
 */
export const SCOPE_ROOT = "https://www.googleapis.com/auth/";

/** Every file the account can see, in Drive and in Docs, Sheets and Slides. */
export const DRIVE = `${SCOPE_ROOT}drive`;
/** Through Drive, only the files this client created or opened. */
export const DRIVE_FILE = `${SCOPE_ROOT}drive.file`;
export const DOCUMENTS = `${SCOPE_ROOT}documents`;
export const SPREADSHEETS = `${SCOPE_ROOT}spreadsheets`;
export const PRESENTATIONS = `${SCOPE_ROOT}presentations`;
/** The account's address, and nothing else: asked for in every consent so tokeninfo can say who approved it. */
export const USERINFO_EMAIL = `${SCOPE_ROOT}userinfo.email`;

/** A granted scope string ("a b c", as a token endpoint or tokeninfo states it) as a list. */
export const splitScopes = (scope: string | undefined): readonly string[] => (scope ?? "").split(/\s+/).filter(Boolean);
