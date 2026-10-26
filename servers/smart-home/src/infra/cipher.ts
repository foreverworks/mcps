import { createCipheriv, createDecipheriv } from "node:crypto";

import { type Cipher, IV } from "../domain/broadlink/protocol.js";

/** AES-128-CBC under the protocol's fixed IV, without padding (the protocol pads with zeros itself). */
export const aes: Cipher = {
  encrypt: (key, plain) => {
    const c = createCipheriv("aes-128-cbc", key, IV).setAutoPadding(false);
    return new Uint8Array(Buffer.concat([c.update(plain), c.final()]));
  },
  decrypt: (key, data) => {
    const usable = data.subarray(0, data.length - (data.length % 16));
    const d = createDecipheriv("aes-128-cbc", key, IV).setAutoPadding(false);
    return new Uint8Array(Buffer.concat([d.update(usable), d.final()]));
  },
};
