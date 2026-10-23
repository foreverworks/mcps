import { fail, inputError } from "./errors.js";

/**
 * ANAF's ids are numbers written as text: a message's download id
 * (`id` in a listing, which download_invoice takes) and an upload's
 * `id_incarcare`. Checked for that form so a wrong one (a requestId pasted
 * with its label, an invoice number, a file name) fails here, naming the
 * argument, instead of spending one of ANAF's ten downloads a day on it.
 */
const DIGITS = /^[0-9]{1,20}$/;

const digitsOf = (value: string, what: string, from: string): string => {
  const id = value.trim();
  if (!DIGITS.test(id)) fail(inputError(`${what} "${value.slice(0, 60)}" is not an ANAF id: digits only, as ${from} gives it`));
  return id;
};

export const parseMessageId = (value: string): string => digitsOf(value, "message_id", "the id field of list_invoices");

export const parseUploadId = (value: string): string => digitsOf(value, "id_incarcare", "upload_invoice's uploadId");
