/**
 * What stands in for a secret this server withholds, in a result and in the
 * description of a tool whose result carries one.
 */
export const WITHHELD_SECRET =
  "withheld: a secret leaves this server only in the result of a money tool, which the client asks the user to approve (for a webhook, rotate_webhook_secret); " +
  "the account holder also sees it at https://porkbun.com/account/api";
