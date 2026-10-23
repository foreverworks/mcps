/**
 * The tool surface every receipts server shares (the views): registration,
 * input schemas, the policy, and the process entry point. An app brings its
 * words (ReceiptCopy), its list_orders, and its use cases.
 */
export { detailField, localDate, stateField, type StateCopy } from "./fields.js";
export { runServer, type ServerSpec } from "./main.js";
export { POLICY } from "./policy.js";
export { registerReceiptTools } from "./register.js";
export type { Handled, ReceiptCopy, ReceiptTools, Zoned } from "./tools.js";
