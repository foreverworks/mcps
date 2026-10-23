import type { EnvelopeVocabulary, makeHandled, McpServer } from "@foreverworks/mcp-kit";

import type { ReceiptUseCases } from "../app/usecases.js";
import type { StateCopy } from "./fields.js";

/** A server's `handled`: the kit's envelope, taught that server's failures and remedies. */
export type Handled = ReturnType<typeof makeHandled>;

/**
 * An app's words for the shared tools: every description a client reads, and
 * the argument descriptions that differ. Word for word what the tools say, so
 * a change here is a change to what every caller sees.
 */
export type ReceiptCopy = {
  readonly health: string;
  readonly getReceipt: string;
  readonly getReceipts: string;
  readonly searchItems: string;
  readonly exportItems: string;
  readonly matchCardCharges: string;
  readonly orderStats: string;
  /** How the range arguments name themselves: "First order date" and "Last order date", or "First date" and "Last date". */
  readonly firstDate: string;
  readonly lastDate: string;
  /** The `detail` argument: what a headline holds in this app. */
  readonly detail: string;
  readonly state: StateCopy;
};

/** What the shared surface reads from a server's deps: the zone its date arguments are described in. */
export type Zoned = { readonly timeZone: string };

/** Everything a server hands the shared tool surface. */
export type ReceiptTools<D extends Zoned, E extends object> = {
  readonly copy: ReceiptCopy;
  /** The server's failures and their remedies, for the envelope every tool answers in. */
  readonly vocabulary: EnvelopeVocabulary<E>;
  /** list_orders, the one tool whose arguments are each app's own: Bolt's history is dated, Glovo's is not. */
  readonly listOrders: (server: McpServer, deps: D, handled: Handled) => void;
  readonly health: (deps: D) => Promise<unknown>;
  readonly getReceipt: (deps: D, orderId: number) => Promise<unknown>;
  readonly useCases: ReceiptUseCases<D>;
};

/** A part of the surface: registers its tools and nothing else. */
export type Registrar = <D extends Zoned, E extends object>(server: McpServer, deps: D, tools: ReceiptTools<D, E>, handled: Handled) => void;
