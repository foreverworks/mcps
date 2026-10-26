/**
 * The personal-data check. This repository is public, and an address, a phone
 * number or an id copied from a real response, a log or a local setup is
 * published the moment it is pushed. So every text file a commit would carry
 * (what git tracks, and new files it does not ignore) is read for values that
 * look like personal data: private, shared and link-local addresses, MAC
 * addresses, tailnet host names, e-mail addresses, phone numbers, and personal
 * identifiers checked by their own checksum (Romanian CNP, IBAN). Each one is
 * reported by file, line, kind and the text matched, and any finding fails.
 *
 * The documentation values the standards reserve for examples pass (RFC 5737,
 * 3849 and 9637 addresses, RFC 7042 MACs, RFC 2606 and 6761 names, published
 * example IBANs, fictional phone ranges), as does a whole range written in
 * CIDR notation. A line that has to carry a real-looking value says so with
 * `personal-data-check: allow` and the reason; a file that cannot carry a
 * comment has its public values named in .personal-data-allow. CONTRIBUTING.md
 * ("Personal data and deployments") is the list a contributor reads.
 *
 * Run by `npm run check`, and on every push and pull request by
 * .github/workflows/personal-data.yml, which runs it with plain Node, no
 * install: it imports nothing but Node's own modules. Outside a git repository
 * (an exported tree) it reads every file on disk but those under a directory
 * the root .gitignore names.
 *
 *   npx tsx scripts/personal-data.ts
 */
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type Kind =
  | "ipv4-private"
  | "ipv4-shared"
  | "ipv4-link-local"
  | "ipv6-global"
  | "ipv6-unique-local"
  | "ipv6-link-local"
  | "mac"
  | "tailnet-host"
  | "email"
  | "phone"
  | "cnp"
  | "iban";

/** One value on one line: its kind, where it starts (1-based) and the text matched. */
export type Hit = { readonly column: number; readonly kind: Kind; readonly text: string };
export type Finding = Hit & { readonly line: number };

/** Anywhere on a line, it skips that line. The reason goes next to it. */
export const MARKER = "personal-data-check: allow";

/** Each match of a pattern that the judge gives a kind; undefined lets it through. */
const hitsOf = (line: string, pattern: RegExp, judge: (match: RegExpExecArray) => Kind | undefined): Hit[] =>
  [...line.matchAll(pattern)].flatMap((match) => {
    const kind = judge(match);
    return kind === undefined ? [] : [{ column: match.index + 1, kind, text: match[0] }];
  });

// ---------------------------------------------------------------- networks

type Range = { readonly base: bigint; readonly prefix: number; readonly bits: number };

const within = (address: bigint, range: Range): boolean => (address ^ range.base) >> BigInt(range.bits - range.prefix) === 0n;

/**
 * A whole block written in CIDR notation (`10.0.0.0/8`, `fe80::/10`) names a
 * range, not a machine: host bits all zero, and no longer than a /16.
 */
const isRangeNotation = (address: bigint, prefix: number | undefined, bits: number): boolean =>
  prefix !== undefined && prefix <= 16 && (address & ((1n << BigInt(bits - prefix)) - 1n)) === 0n;

const v4 = (text: string): bigint | undefined => {
  const octets = text.split(".").map(Number);
  return octets.length === 4 && octets.every((o) => Number.isInteger(o) && o <= 255) ? octets.reduce((acc, o) => (acc << 8n) | BigInt(o), 0n) : undefined;
};

/** A block from its CIDR notation, which the check itself lets through as a range. */
const v4Range = (cidr: string): Range => {
  const [base = "", prefix = ""] = cidr.split("/");
  return { base: v4(base) ?? 0n, prefix: Number(prefix), bits: 32 };
};

/** The IPv4 blocks that only ever name a private network, a carrier-grade NAT or VPN (RFC 6598), or a link. */
const V4_FLAGGED: readonly (readonly [Range, Kind])[] = [
  [v4Range("10.0.0.0/8"), "ipv4-private"],
  [v4Range("172.16.0.0/12"), "ipv4-private"],
  [v4Range("192.168.0.0/16"), "ipv4-private"],
  [v4Range("100.64.0.0/10"), "ipv4-shared"],
  [v4Range("169.254.0.0/16"), "ipv4-link-local"],
];

/** An IPv4 address, with an optional /prefix; not part of a longer dotted number such as a version. */
const IPV4 = /(?<![\w.])(\d{1,3}(?:\.\d{1,3}){3})(?:\/(\d{1,2}))?(?!\w|\.\d)/g;

/**
 * Every other IPv4 address passes: public ones are no one's in particular, and
 * the documentation blocks (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24),
 * loopback and 0.0.0.0 are what examples use.
 */
const ipv4 = (line: string): Hit[] =>
  hitsOf(line, IPV4, (m) => {
    const address = v4(m[1] ?? "");
    const prefix = m[2] === undefined ? undefined : Number(m[2]);
    if (address === undefined || isRangeNotation(address, prefix, 32)) return undefined;
    return V4_FLAGGED.find(([range]) => within(address, range))?.[1];
  });

/** An IPv6 address as a number, or undefined when the text is not one (a time, a MAC, a C++ scope). */
export const parseIPv6 = (text: string): bigint | undefined => {
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const groups = (part: string | undefined): string[] => (part === undefined || part === "" ? [] : part.split(":"));
  const head = groups(halves[0]);
  const tail = groups(halves[1]);
  if (![...head, ...tail].every((g) => /^[0-9A-Fa-f]{1,4}$/.test(g))) return undefined;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  return [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail].reduce((acc, g) => (acc << 16n) | BigInt(parseInt(g, 16)), 0n);
};

const v6Range = (cidr: string): Range => {
  const [base = "", prefix = ""] = cidr.split("/");
  return { base: parseIPv6(base) ?? 0n, prefix: Number(prefix), bits: 128 };
};

/** Reserved for documentation: RFC 3849 and RFC 9637. */
const V6_DOCUMENTATION: readonly Range[] = [v6Range("2001:db8::/32"), v6Range("3fff::/20")];

/** Global unicast, unique local (the private ranges' counterpart, which VPNs use), link-local. */
const V6_FLAGGED: readonly (readonly [Range, Kind])[] = [
  [v6Range("2000::/3"), "ipv6-global"],
  [v6Range("fc00::/7"), "ipv6-unique-local"],
  [v6Range("fe80::/10"), "ipv6-link-local"],
];

/** Candidates: groups of hex and colons with at least two colons, then parsed. */
const IPV6 = /(?<![\w:.])((?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4})(?:\/(\d{1,3}))?(?![\w:])/g;

const ipv6 = (line: string): Hit[] =>
  hitsOf(line, IPV6, (m) => {
    const address = parseIPv6(m[1] ?? "");
    const prefix = m[2] === undefined ? undefined : Number(m[2]);
    if (address === undefined || isRangeNotation(address, prefix, 128) || V6_DOCUMENTATION.some((range) => within(address, range))) return undefined;
    return V6_FLAGGED.find(([range]) => within(address, range))?.[1];
  });

/** Six pairs of hex digits, one separator throughout; not part of a longer run such as a key fingerprint. */
const MAC = /(?<![\w:-])[0-9A-Fa-f]{2}([:-])(?:[0-9A-Fa-f]{2}\1){4}[0-9A-Fa-f]{2}(?![\w:-])/g;

/** RFC 7042's documentation blocks (unicast and multicast), all zeros, broadcast, and the format's usual placeholder. */
const macAllowed = (mac: string): boolean => {
  const m = mac.toLowerCase().replace(/-/g, ":");
  return m.startsWith("00:00:5e:00:53:") || m.startsWith("01:00:5e:90:10:") || ["00:00:00:00:00:00", "ff:ff:ff:ff:ff:ff", "aa:bb:cc:dd:ee:ff"].includes(m);
};

const mac = (line: string): Hit[] => hitsOf(line, MAC, (m) => (macAllowed(m[0]) ? undefined : "mac"));

/** A machine's or a tailnet's name under ts.net, Tailscale's MagicDNS domain. `<tailnet>.ts.net` passes. */
const TAILNET = /(?<![\w.-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+ts\.net(?![\w-])/gi;

const tailnet = (line: string): Hit[] => hitsOf(line, TAILNET, () => "tailnet-host");

// ---------------------------------------------------------------- contact

/**
 * RFC 2606 and RFC 6761: names that can never belong to anyone. example.com,
 * .org and .net count wherever they appear in a name, so an example address
 * used as a file name (`me@example.com.password`) passes too.
 */
export const exampleHost = (host: string): boolean => {
  const labels = host.toLowerCase().split(".");
  const reservedTld = ["example", "test", "invalid", "localhost"].includes(labels.at(-1) ?? "");
  return reservedTld || labels.some((label, i) => label === "example" && ["com", "org", "net"].includes(labels[i + 1] ?? ""));
};

/** Addresses of services, not of people: git over SSH, and GitHub's own senders. */
const SERVICE_ADDRESSES = new Set(["git@github.com", "noreply@github.com", "notifications@github.com"]);
const SERVICE_DOMAINS = ["users.noreply.github.com"];

const EMAIL = /(?<![\w.%+-])[\w.%+-]+@((?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,63})(?![\w-])/g;

/**
 * Names shaped like an address that are not one: a retina image
 * (`icon@2x.png`), a systemd template unit (`backup@home.service`).
 */
const NOT_A_HOST = /\.(?:png|jpe?g|gif|svg|webp|avif|ico|service|socket|timer|target|mount|path)$/i;

const email = (line: string): Hit[] =>
  hitsOf(line, EMAIL, (m) => {
    const host = (m[1] ?? "").toLowerCase();
    const address = m[0].toLowerCase();
    if (exampleHost(host) || NOT_A_HOST.test(host) || SERVICE_ADDRESSES.has(address) || SERVICE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return undefined;
    return "email";
  });

/**
 * Numbers reserved for fiction and examples, as digits with the country code:
 * North America's 555-0100 to 555-0199 in any area, and Ofcom's drama ranges
 * for a UK mobile, London and an unassigned area code.
 */
const FICTIONAL_PHONES: readonly RegExp[] = [/^1\d{3}55501\d{2}$/, /^447700900\d{3}$/, /^442079460\d{3}$/, /^441632960\d{3}$/];

/**
 * A phone number in international form (`+` and the country code) or a `tel:`
 * link. A national number without its country code is not looked for: it
 * cannot be told from the other long digit strings a codebase holds. The
 * country code never starts with 0, which leaves out time-zone offsets.
 */
const PHONE = /(?<![\w+/=])(?:\+|tel:\+?)[1-9][\d ().-]{5,22}\d(?!\w|[.-]\d)/g;

export const phoneDigits = (text: string): string | undefined => {
  const number = text.replace(/^tel:/, "");
  const digits = number.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return undefined;
  // A signed decimal (+1.2345678), or digits run together with separators (a table, arithmetic).
  if (/^\+?\d+\.\d+$/.test(number) || /[ .-]{2}/.test(number.replace(/[()]/g, ""))) return undefined;
  return digits;
};

const phone = (line: string): Hit[] =>
  hitsOf(line, PHONE, (m) => {
    const digits = phoneDigits(m[0]);
    return digits === undefined || FICTIONAL_PHONES.some((r) => r.test(digits)) ? undefined : "phone";
  });

// ---------------------------------------------------------------- identifiers

const CNP_WEIGHTS = [2, 7, 9, 1, 4, 6, 3, 5, 8, 2, 7, 9] as const;
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/**
 * Whether 13 digits are a well-formed Romanian personal numeric code (CNP):
 * sex and century 1 to 9, a birth date, a county code (01 to 52, or 70), and
 * the control digit, the weighted sum modulo 11 (10 counts as 1).
 */
export const cnpValid = (cnp: string): boolean => {
  if (!/^[1-9]\d{12}$/.test(cnp)) return false;
  const digit = (i: number): number => cnp.charCodeAt(i) - 48;
  const pair = (i: number): number => digit(i) * 10 + digit(i + 1);
  const month = pair(3);
  const day = pair(5);
  const county = pair(7);
  if (month < 1 || month > 12 || day < 1 || day > (DAYS_IN_MONTH[month - 1] ?? 0)) return false;
  if (!((county >= 1 && county <= 52) || county === 70)) return false;
  const sum = CNP_WEIGHTS.reduce((acc, weight, i) => acc + weight * digit(i), 0);
  return (sum % 11 === 10 ? 1 : sum % 11) === digit(12);
};

/** The control digit a CNP's first 12 digits call for. */
export const cnpControl = (first12: string): number => {
  const sum = CNP_WEIGHTS.reduce((acc, weight, i) => acc + weight * (first12.charCodeAt(i) - 48), 0);
  return sum % 11 === 10 ? 1 : sum % 11;
};

const CNP = /(?<!\w)[1-9]\d{12}(?!\w)/g;

const cnp = (line: string): Hit[] => hitsOf(line, CNP, (m) => (cnpValid(m[0]) ? "cnp" : undefined));

/** IBAN length by country, from the SWIFT IBAN registry. */
const IBAN_LENGTH: Readonly<Record<string, number>> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BI: 27, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24,
  DE: 22, DJ: 27, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FK: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27,
  GT: 28, HN: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20,
  LU: 20, LV: 21, LY: 25, MC: 27, MD: 24, ME: 22, MK: 19, MN: 20, MR: 27, MT: 31, MU: 30, NI: 28, NL: 18, NO: 15, OM: 23, PK: 24,
  PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, RU: 33, SA: 24, SC: 31, SD: 18, SE: 24, SI: 19, SK: 24, SM: 27, SO: 23, ST: 25,
  SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20, YE: 30,
};

/** The remainder modulo 97 of an IBAN read as ISO 13616 says: first four characters moved to the end, letters as 10 to 35. */
export const ibanRemainder = (iban: string): number =>
  [...(iban.slice(4) + iban.slice(0, 4))].reduce((rem, ch) => {
    const value = parseInt(ch, 36);
    return value < 10 ? (rem * 10 + value) % 97 : (rem * 100 + value) % 97;
  }, 0);

/** Whether a text is an IBAN: the country's length and ISO 13616's mod-97 check. Spaces between groups are ignored. */
export const ibanValid = (text: string): boolean => {
  const iban = text.replace(/ /g, "");
  return /^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban) && IBAN_LENGTH[iban.slice(0, 2)] === iban.length && ibanRemainder(iban) === 1;
};

/** Published examples (the IBAN registry's, a national bank's), which documentation and tests use. */
export const EXAMPLE_IBANS: ReadonlySet<string> = new Set(["DE89370400440532013000", "GB82WEST12345698765432", "RO49AAAA1B31007593840000"]);

/** Compact, or in groups of four as it is printed. */
const IBAN = /(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?:[A-Z0-9]{11,30}|(?: [A-Z0-9]{4}){2,7}(?: [A-Z0-9]{1,4})?)(?![A-Za-z0-9])/g;

const iban = (line: string): Hit[] => hitsOf(line, IBAN, (m) => (ibanValid(m[0]) && !EXAMPLE_IBANS.has(m[0].replace(/ /g, "")) ? "iban" : undefined));

// ---------------------------------------------------------------- scanning

const DETECTORS: readonly ((line: string) => Hit[])[] = [ipv4, ipv6, mac, tailnet, email, phone, cnp, iban];

/** Every value on a line that looks like personal data, left to right; none on a line that carries the marker. */
export const scanLine = (line: string): readonly Hit[] => (line.includes(MARKER) ? [] : DETECTORS.flatMap((detect) => detect(line)).sort((a, b) => a.column - b.column));

export const scanText = (text: string): readonly Finding[] => text.split("\n").flatMap((line, i) => scanLine(line).map((hit) => ({ line: i + 1, ...hit })));

/**
 * The repository's own allow-list, for a public or invented value that looks
 * personal (a public body's automated sender, a vendor's published example, a
 * fixture's recorded device) where a line cannot carry the marker: JSON, a
 * generated, vendored or recorded file. One exact
 * value per line, as it appears; a line starting with `#` is a comment, and
 * the comment above a value says why it is there.
 */
export const ALLOW_FILE = ".personal-data-allow";

export const allowedValues = (text: string): ReadonlySet<string> =>
  new Set(
    text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#")),
  );

/** A finding's value as the allow-list names it: an IBAN without its spaces, anything else as matched. */
const valueOf = (hit: Hit): string => (hit.kind === "iban" ? hit.text.replace(/ /g, "") : hit.text);

/** The findings the allow-list does not name, and its entries that match nothing (stale, so they go). */
export const applyAllowList = <F extends Hit>(findings: readonly F[], allow: ReadonlySet<string>): { readonly reported: readonly F[]; readonly unused: readonly string[] } => {
  const used = new Set(findings.map(valueOf));
  return { reported: findings.filter((f) => !allow.has(valueOf(f))), unused: [...allow].filter((value) => !used.has(value)) };
};

/** Git's own rule: a file with a NUL byte in its first 8000 is binary. */
export const isText = (bytes: Uint8Array): boolean => !bytes.subarray(0, 8000).includes(0);

/** The directories a .gitignore names as such (`dist/`, `/bundles/`), by name: what an exported tree has on disk that is not a source. */
export const ignoredDirectories = (gitignore: string): ReadonlySet<string> =>
  new Set(
    gitignore
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.endsWith("/") && !l.startsWith("#") && !l.startsWith("!"))
      .map((l) => l.replace(/^\/|\/$/g, ""))
      .filter((name) => name !== "" && !/[*?[/]/.test(name)),
  );

// ---------------------------------------------------------------- the edge

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The files a commit would carry, relative to the root: tracked, and new ones git does not ignore. */
const filesOf = (root: string): readonly string[] => {
  const git = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (git.status === 0) return [...new Set(git.stdout.split("\0").filter((path) => path !== ""))];
  const gitignore = join(root, ".gitignore");
  const skip = new Set([".git", ...ignoredDirectories(existsSync(gitignore) ? readFileSync(gitignore, "utf8") : "")]);
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (skip.has(entry.name)) return [];
      const path = join(dir, entry.name);
      return entry.isDirectory() ? walk(path) : entry.isFile() ? [relative(root, path)] : [];
    });
  console.log("not a git repository: reading every file but those under the directories .gitignore names");
  return walk(root);
};

const main = (): number => {
  const files = filesOf(ROOT).filter((path) => lstatSync(join(ROOT, path), { throwIfNoEntry: false })?.isFile() === true);
  const texts = files.flatMap((path) => {
    const bytes = readFileSync(join(ROOT, path));
    return isText(bytes) ? [{ path, text: bytes.toString("utf8") }] : [];
  });
  const findings = texts.flatMap(({ path, text }) => scanText(text).map((finding) => ({ path, ...finding })));
  const allowFile = join(ROOT, ALLOW_FILE);
  const { reported, unused } = applyAllowList(findings, allowedValues(existsSync(allowFile) ? readFileSync(allowFile, "utf8") : ""));
  for (const f of reported) console.error(`${f.path}:${f.line}:${f.column}: ${f.kind}: ${f.text}`);
  for (const value of unused) console.error(`${ALLOW_FILE}: ${value} appears nowhere any more: remove it`);
  if (reported.length === 0 && unused.length === 0) {
    console.log(`personal-data check: ${texts.length} text files, nothing that looks like personal data`);
    return 0;
  }
  if (reported.length > 0) {
    const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;
    const inFiles = new Set(reported.map((f) => f.path)).size;
    console.error(
      `\npersonal-data check: ${count(reported.length, "value")} in ${count(inFiles, "file")} look${reported.length === 1 ? "s" : ""} like personal data. Replace each with a documentation value,` +
        ` or where it has to stay, put "${MARKER}" and the reason on its line (CONTRIBUTING.md, "Personal data and deployments").`,
    );
  }
  return 1;
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main());
