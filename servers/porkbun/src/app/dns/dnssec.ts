import { compactDigest, type Ds, dnskeyRdata, dsProblems, parseDnskey } from "../../domain/dns/ds.js";
import { normalHostname } from "../../domain/dns/hostname.js";
import { fail, inputError } from "../../domain/errors.js";
import { annotated, callTool } from "../callTool.js";
import type { Deps, ToolArgs } from "../ports.js";
import { dsOf } from "./dnskey.js";

/**
 * create_dnssec_record, with its DS record checked before the registry gets
 * it. A DS that does not match the zone's key breaks the domain for every
 * validating resolver as soon as it is published, so:
 *
 * - from a DNSKEY (`dnskey`, or the vendor's four keyData* fields), the DS is
 *   computed here and any of keyTag, alg, digestType and digest also given
 *   must agree with it;
 * - without one, all four are required and must have a DS record's shape.
 */

const DS_FIELDS = ["keyTag", "alg", "digestType", "digest"] as const;

export type DnssecArgs = ToolArgs & {
  readonly domain: string;
  readonly dnskey?: string;
  readonly keyTag?: string;
  readonly alg?: string;
  readonly digestType?: string;
  readonly digest?: string;
};

/** The vendor's optional DNSKEY fields as one DNSKEY's data, when all four are given. */
const keyDataOf = (args: ToolArgs): string | undefined => {
  const parts = ["keyDataFlags", "keyDataProtocol", "keyDataAlgo", "keyDataPubKey"].map((k) => args[k]);
  return parts.every((p) => typeof p === "string" && p.trim() !== "") ? parts.join(" ") : undefined;
};

const same = (field: (typeof DS_FIELDS)[number], given: string, computed: string): boolean =>
  field === "digest" ? compactDigest(given).toLowerCase() === computed.toLowerCase() : /^\d+$/.test(given.trim()) && Number(given) === Number(computed);

/** The DS to send, and what it was checked against. */
export const dsFor = (args: DnssecArgs): { readonly ds: Ds; readonly checked: "dnskey" | "keyData" | "shape" } => {
  const zone = normalHostname(args.domain);
  const keyData = keyDataOf(args);
  const keyText = args.dnskey ?? keyData;
  if (keyText === undefined) {
    const missing = DS_FIELDS.filter((f) => args[f] === undefined);
    if (missing.length > 0) {
      return fail(inputError(`give dnskey (the zone's DNSKEY record, and the DS is computed from it) or all of keyTag, alg, digestType and digest; ${missing.join(", ")} missing`));
    }
    const ds: Ds = {
      keyTag: (args.keyTag as string).trim(),
      alg: (args.alg as string).trim(),
      digestType: (args.digestType as string).trim(),
      digest: compactDigest(args.digest as string),
    };
    const problems = dsProblems(ds);
    if (problems.length > 0) return fail(inputError(`${problems.join("; ")}; nothing was sent`));
    return { ds, checked: "shape" };
  }
  const key = parseDnskey(keyText);
  const owner = key.owner === undefined ? undefined : normalHostname(key.owner);
  if (owner !== undefined && owner !== zone) return fail(inputError(`dnskey is the key of ${owner}, not of ${zone}; nothing was sent`));
  if (args.dnskey !== undefined && keyData !== undefined && !dnskeyRdata(parseDnskey(keyData)).equals(dnskeyRdata(key))) {
    return fail(inputError("the keyData* fields describe another key than dnskey; nothing was sent"));
  }
  const digestType = args.digestType?.trim() ?? "2";
  if (!/^\d+$/.test(digestType)) return fail(inputError(`digestType "${digestType}" is not a number; nothing was sent`));
  const ds = dsOf(zone, key, Number(digestType));
  const differ = DS_FIELDS.filter((f) => args[f] !== undefined && !same(f, args[f] as string, ds[f]));
  if (differ.length > 0) {
    return fail(
      inputError(
        `the DS computed from the DNSKEY is keyTag ${ds.keyTag}, alg ${ds.alg}, digestType ${ds.digestType}, digest ${ds.digest}; ` +
          `${differ.map((f) => `${f} "${String(args[f])}"`).join(", ")} differ, so the key or the typed values are wrong; nothing was sent`,
      ),
    );
  }
  return { ds, checked: args.dnskey === undefined ? "keyData" : "dnskey" };
};

export const createDnssecRecord = async (deps: Deps, args: DnssecArgs, revealsSecrets: boolean): Promise<unknown> => {
  const { ds, checked } = dsFor(args);
  const { dnskey: _dnskey, ...vendorArgs } = args;
  const result = await callTool(deps, "create_dnssec_record", { ...vendorArgs, ...ds }, revealsSecrets);
  return annotated(result, { ds: { ...ds, checked } });
};
