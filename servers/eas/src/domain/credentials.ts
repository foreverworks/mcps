import type { RawAndroidCredentials, RawIosCredentials } from "./schema.js";

/**
 * The credentials audit: per bundle id (iOS) and package (Android), what EAS
 * holds for building and submitting, and in plain words what is missing or
 * running out. A typical case: the App Store Connect key for submissions set
 * on `com.example.app` and missing on `com.example.app.dev`, so every
 * TestFlight upload of the dev variant fails at "Prepare credentials" with a
 * message that names nothing. One call to this says it.
 *
 * Which identifiers to audit is not configured anywhere: it is every
 * identifier EAS has credentials for, plus every one the project's recent
 * builds were made for (a build for an identifier with no credentials is the
 * case worth catching), plus any the caller names.
 */

export const EXPIRING_DAYS = 30;

const DAY_MS = 86_400_000;

export type Target = { readonly platform: "ios" | "android"; readonly identifier: string };

/**
 * "expired 3 days ago" / "expires in 12 days" pushed onto the right list, or
 * nothing when there is time. Whole days, counted toward zero; expired means
 * the moment has passed, even by an hour. Answers the days left (negative: past).
 */
const checkExpiry = (what: string, iso: string, now: number, missing: string[], expiring: string[]): number => {
  const ms = Date.parse(iso) - now;
  const days = Math.trunc(ms / DAY_MS);
  if (ms <= 0) missing.push(`${what} expired ${-days} days ago (${iso.slice(0, 10)})`);
  else if (days <= EXPIRING_DAYS) expiring.push(`${what} expires in ${days} days (${iso.slice(0, 10)})`);
  return days;
};

const SUBMIT_KEY_MISSING =
  "no App Store Connect API key for submissions: eas submit and a workflow's submit job fail at Prepare credentials " +
  '("eas-cli failed to resolve submission config"); set one with set_submit_key';

export const auditIos = (identifier: string, credentials: RawIosCredentials | undefined, now: number) => {
  const missing: string[] = [];
  const expiring: string[] = [];
  const absent: string[] = [];
  if (credentials === undefined) {
    missing.push("no iOS credentials on EAS for this bundle id: a build of it cannot sign and nothing can be submitted (eas credentials, once)");
    return { platform: "ios" as const, identifier, ok: false, missing, expiring, absent };
  }
  const distribution = credentials.iosAppBuildCredentialsList.map((build) => {
    const type = build.iosDistributionType;
    const certificate = build.distributionCertificate;
    const profile = build.provisioningProfile;
    if (certificate === null) missing.push(`no distribution certificate for ${type}`);
    if (profile === null) missing.push(`no provisioning profile for ${type}`);
    else if (profile.status !== null && profile.status !== "active") missing.push(`the ${type} provisioning profile is ${profile.status}`);
    return {
      type,
      certificate:
        certificate === null
          ? null
          : {
              serial: certificate.serialNumber,
              portalId: certificate.developerPortalIdentifier,
              expires: certificate.validityNotAfter,
              daysLeft: checkExpiry(`the ${type} distribution certificate`, certificate.validityNotAfter, now, missing, expiring),
            },
      profile:
        profile === null
          ? null
          : {
              portalId: profile.developerPortalIdentifier,
              status: profile.status,
              expires: profile.expiration,
              daysLeft: checkExpiry(`the ${type} provisioning profile`, profile.expiration, now, missing, expiring),
            },
    };
  });
  if (distribution.length === 0) missing.push("no build credentials (distribution certificate and provisioning profile): a build of it cannot sign");
  const key = credentials.appStoreConnectApiKeyForSubmissions;
  if (key === null) missing.push(SUBMIT_KEY_MISSING);
  if (credentials.pushKey === null) absent.push("push key (needed only for remote push notifications)");
  return {
    platform: "ios" as const,
    identifier,
    ok: missing.length === 0,
    missing,
    expiring,
    absent,
    credentialsId: credentials.id,
    appleTeam: credentials.appleTeam?.appleTeamIdentifier ?? null,
    submitKey: key === null ? null : { keyId: key.keyIdentifier, issuerId: key.issuerIdentifier, name: key.name, easId: key.id },
    pushKey: credentials.pushKey === null ? null : { keyId: credentials.pushKey.keyIdentifier },
    distribution,
  };
};

export const auditAndroid = (identifier: string, credentials: RawAndroidCredentials | undefined) => {
  const missing: string[] = [];
  const absent: string[] = [];
  if (credentials === undefined) {
    missing.push("no Android credentials on EAS for this package: a build of it has no upload keystore and nothing can be submitted");
    return { platform: "android" as const, identifier, ok: false, missing, expiring: [] as string[], absent };
  }
  const keystores = credentials.androidAppBuildCredentialsList.map((build) => ({
    name: build.name,
    isDefault: build.isDefault,
    keystore:
      build.androidKeystore === null
        ? null
        : {
            type: build.androidKeystore.type,
            keyAlias: build.androidKeystore.keyAlias,
            sha1: build.androidKeystore.sha1CertificateFingerprint,
            sha256: build.androidKeystore.sha256CertificateFingerprint,
          },
  }));
  if (!keystores.some((k) => k.isDefault && k.keystore !== null)) missing.push("no default upload keystore: a build of it cannot sign");
  const submit = credentials.googleServiceAccountKeyForSubmissions;
  if (submit === null) missing.push("no Google service account key for submissions: eas submit to Google Play fails");
  if (credentials.androidFcm === null && credentials.googleServiceAccountKeyForFcmV1 === null) {
    absent.push("FCM credentials (needed only for remote push notifications)");
  }
  return {
    platform: "android" as const,
    identifier,
    ok: missing.length === 0,
    missing,
    expiring: [] as string[],
    absent,
    credentialsId: credentials.id,
    keystores,
    submitKey: submit === null ? null : { clientEmail: submit.clientEmail, project: submit.projectIdentifier },
    fcm: credentials.googleServiceAccountKeyForFcmV1 !== null ? "v1" : (credentials.androidFcm?.version ?? null),
  };
};

/**
 * Every (platform, identifier) worth auditing, sorted: what EAS holds
 * credentials for, what was built, and what was asked for. A filter narrows
 * the set. An identifier asked for is always reported for the platform asked;
 * without a platform, for the platforms EAS knows it on, or for both (as
 * missing) when it knows it on neither.
 */
export const targetsOf = (
  known: readonly Target[],
  filter: { readonly platform?: "ios" | "android"; readonly identifier?: string },
): readonly Target[] => {
  const platforms: readonly Target["platform"][] = filter.platform === undefined ? ["ios", "android"] : [filter.platform];
  const matches = known.filter((t) => platforms.includes(t.platform) && (filter.identifier === undefined || t.identifier === filter.identifier));
  const { identifier } = filter;
  const asked =
    identifier !== undefined && (filter.platform !== undefined || matches.length === 0) ? platforms.map((platform) => ({ platform, identifier })) : [];
  const seen = new Map<string, Target>();
  for (const t of [...matches, ...asked]) seen.set(`${t.platform}\n${t.identifier}`, t);
  return [...seen.values()].sort((a, b) => a.platform.localeCompare(b.platform) || a.identifier.localeCompare(b.identifier));
};
