import { saveToOutbox } from "@foreverworks/mcp-kit";

import type { OutboxPort } from "../app/ports.js";

/** Where downloaded documents are written (ESANATATEAMEA_OUTBOX_DIR): the path, SHA-256 and size go back, never the bytes. */
export const makeOutbox = (dir: string): OutboxPort => ({ save: (name, bytes) => saveToOutbox(dir, name, bytes) });
