/**
 * An SPF record's obvious mistakes (RFC 7208), found before it is published:
 * a misspelt mechanism, an address that is not one, an include with no
 * domain, a term after `all` (never evaluated), two `redirect=`, a second
 * `v=spf1`, more than ten DNS lookups in the record itself (a permerror at
 * every receiver). Syntax only: an include is not followed, so lookups inside
 * it are not counted. Pure.
 */

const MAX_LOOKUPS = 10;

/** Mechanisms that cost a DNS lookup when evaluated (RFC 7208 4.6.4); `redirect=` costs one too. */
const LOOKUP_MECHANISMS = new Set(["include", "a", "mx", "ptr", "exists"]);

const isIpv4 = (text: string): boolean => {
  const parts = text.split(".");
  return parts.length === 4 && parts.every((p) => /^\d+$/.test(p) && p.length <= 3 && Number(p) <= 255 && (p === "0" || !p.startsWith("0")));
};

const isIpv6 = (text: string): boolean => {
  if (!text.includes(":") || !/^[0-9a-f:.]+$/i.test(text)) return false;
  try {
    new URL(`http://[${text}]/`);
    return true;
  } catch {
    return false;
  }
};

/** A prefix length within 0..max, written as a plain number. */
const isCidr = (text: string, max: number): boolean => /^\d+$/.test(text) && Number(text) <= max && (text === "0" || !text.startsWith("0"));

/** A domain-spec: a name with a dot in it, or one built from macros (`%{i}`); nothing a resolver would choke on. */
const domainSpecProblem = (spec: string): string | undefined => {
  if (spec === "") return "needs a domain";
  if (!/^[\x21-\x7e]+$/.test(spec)) return `"${spec}" has a character a domain cannot`;
  if (!spec.includes("%") && !spec.replace(/\.$/, "").includes(".")) return `"${spec}" is not a domain`;
  return undefined;
};

/** The `/cidr4`, `//cidr6` or `/cidr4//cidr6` that `a` and `mx` may end with. */
const dualCidrProblem = (suffix: string): string | undefined => {
  const match = /^(?:\/(\d+))?(?:\/\/(\d+))?$/.exec(suffix);
  if (match === null) return `"${suffix}" is not a prefix length (/24, //64)`;
  if (match[1] !== undefined && !isCidr(match[1], 32)) return `/${match[1]} is not an IPv4 prefix length (0-32)`;
  if (match[2] !== undefined && !isCidr(match[2], 128)) return `//${match[2]} is not an IPv6 prefix length (0-128)`;
  return undefined;
};

const addressProblem = (name: "ip4" | "ip6", arg: string): string | undefined => {
  if (!arg.startsWith(":")) return `${name} needs an address (${name}:...)`;
  const [address = "", cidr, extra] = arg.slice(1).split("/");
  const valid = name === "ip4" ? isIpv4(address) : isIpv6(address);
  if (!valid) return `"${address}" is not an ${name === "ip4" ? "IPv4" : "IPv6"} address`;
  if (extra !== undefined || (cidr !== undefined && !isCidr(cidr, name === "ip4" ? 32 : 128))) return `"${arg.slice(1)}" has a prefix length that is not one`;
  return undefined;
};

/** What is wrong with one mechanism's argument (what follows its name), or undefined. */
const mechanismProblem = (name: string, arg: string): string | undefined => {
  switch (name) {
    case "all":
      return arg === "" ? undefined : "all takes no argument";
    case "include":
    case "exists":
      return arg.startsWith(":") ? domainSpecProblem(arg.slice(1)) : `${name} needs a domain (${name}:example.com)`;
    case "ptr":
      return arg === "" ? undefined : arg.startsWith(":") ? domainSpecProblem(arg.slice(1)) : "ptr takes only :domain";
    case "a":
    case "mx": {
      const slash = arg.indexOf("/");
      const domain = slash === -1 ? arg : arg.slice(0, slash);
      const suffix = slash === -1 ? "" : arg.slice(slash);
      if (domain !== "") {
        if (!domain.startsWith(":")) return `${name} takes :domain and a prefix length`;
        const problem = domainSpecProblem(domain.slice(1));
        if (problem !== undefined) return problem;
      }
      return dualCidrProblem(suffix);
    }
    case "ip4":
    case "ip6":
      return addressProblem(name, arg);
    default:
      return `"${name}" is not an SPF mechanism (all, include, a, mx, ptr, ip4, ip6, exists)`;
  }
};

/** Every obvious mistake in an SPF record's text (it starts with `v=spf1`); empty when there is none. */
export const spfProblems = (text: string): readonly string[] => {
  const terms = text.trim().split(/\s+/).slice(1);
  const problems: string[] = [];
  const modifiersSeen = new Set<string>();
  let lookups = 0;
  let afterAll: string | undefined;
  for (const term of terms) {
    const modifier = /^([a-z][a-z0-9_.-]*)=(.*)$/i.exec(term);
    if (modifier !== null) {
      const name = (modifier[1] ?? "").toLowerCase();
      if (name === "v") {
        problems.push(`a second ${term}: a name has one SPF record, with all its terms in it`);
      } else if (name === "redirect" || name === "exp") {
        if (modifiersSeen.has(name)) problems.push(`${name}= appears more than once`);
        modifiersSeen.add(name);
        const problem = domainSpecProblem(modifier[2] ?? "");
        if (problem !== undefined) problems.push(`${term}: ${problem}`);
        if (name === "redirect") lookups += 1;
      }
      // Any other name=value is a modifier a receiver ignores (RFC 7208 6).
      continue;
    }
    const parsed = /^([+\-~?]?)([a-z][a-z0-9]*)(.*)$/i.exec(term);
    if (parsed === null) {
      problems.push(`"${term}" is not an SPF term`);
      continue;
    }
    const name = (parsed[2] ?? "").toLowerCase();
    const problem = mechanismProblem(name, parsed[3] ?? "");
    if (problem !== undefined) problems.push(`${term}: ${problem}`);
    if (afterAll !== undefined) problems.push(`${term} comes after ${afterAll} and is never evaluated; put it before`);
    if (name === "all" && afterAll === undefined) afterAll = term;
    if (LOOKUP_MECHANISMS.has(name)) lookups += 1;
  }
  if (lookups > MAX_LOOKUPS) problems.push(`${lookups} terms need a DNS lookup, over SPF's limit of ${MAX_LOOKUPS}: every receiver fails the record (permerror)`);
  return problems;
};
