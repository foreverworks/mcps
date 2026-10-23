import { convert } from "html-to-text";

import type { HtmlToText } from "../domain/body.js";

/**
 * A converter tuned for mail rather than for web pages.
 *
 * `wordwrap: false` disables the default 80-column rewrapping, which would
 * insert newlines mid-sentence and make text harder to quote back accurately.
 * Images are dropped: an email's images are almost always tracking pixels and
 * spacers, and their alt text is noise.
 */
export const htmlToText: HtmlToText = (html) =>
  convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "a", options: { ignoreHref: false, hideLinkHrefIfSameAsText: true } },
    ],
  }).trim();
