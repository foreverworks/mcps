/** The code the egress guard puts on the error it rejects with, in `cause.code`, as Node does for a network failure. */
export const EGRESS_DENIED = "EGRESS_DENIED";

/** Whether a thrown value is the egress guard's refusal of a host. Pure. */
export const isEgressDenied = (thrown: unknown): boolean => thrown instanceof Error && (thrown.cause as { readonly code?: unknown } | null | undefined)?.code === EGRESS_DENIED;
