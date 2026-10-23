import { X509Certificate } from "node:crypto";

/**
 * Whom a seal must come from, for this server to call it ANAF's without
 * asking ANAF.
 *
 * The certificate inside a seal proves nothing on its own: anyone can make a
 * key pair and sign. What makes it ANAF's is who ISSUED that certificate and
 * to whom. Both seal certificates seen on 2026-09-30 ("Ministerul Finantelor
 * Publice", valid 2025-11-19..2027-11-19, and "Ministerul Finantelor",
 * 2025-12-05..2027-12-05) name organizationIdentifier 25886108 and were
 * issued by Trans Sped's qualified electronic seal CA, below.
 *
 * The anchor is that CA, pinned: "Trans Sped Electronic Seal QCA G3", valid
 * 2023-05-18 to 2038-05-21, SHA-256 fingerprint
 * AD:88:9F:24:4D:C9:33:3E:E4:EF:7D:B8:44:0F:55:06:44:71:53:BE:44:E8:A7:D9:7A:8E:FD:4B:3C:34:EF:9C,
 * fetched 2026-09-30 from http://www.transsped.ro/cacerts/ts_esqca_g3.p7c (the
 * caIssuers address in the seal certificates themselves); it is issued by
 * "Trans Sped Root CA G3". A seal from any other CA (a renewal under a new
 * one, say) is not refused: it goes to ANAF's own check, and the CA it names
 * is what to add here.
 *
 * Not checked locally: revocation. The CRL and OCSP responder are Trans
 * Sped's (transsped.ro), outside the service's egress, and a revoked seal of
 * the Ministry of Finance would be national news before it was an edge case.
 */
export const SEAL_ORGANIZATION_IDENTIFIER = "25886108";

const TRANS_SPED_ELECTRONIC_SEAL_QCA_G3 = `-----BEGIN CERTIFICATE-----
MIIG7jCCBNagAwIBAgIUD+w8rq4xiLsoC91VG3hQdux/6rUwDQYJKoZIhvcNAQEL
BQAwgYQxCzAJBgNVBAYTAlJPMRgwFgYDVQQKDA9UcmFucyBTcGVkIFMuQS4xFzAV
BgNVBGEMDlZBVFJPLTEyNDU4OTI0MSIwIAYDVQQLDBlUcmFucyBTcGVkIFRydXN0
IFNlcnZpY2VzMR4wHAYDVQQDDBVUcmFucyBTcGVkIFJvb3QgQ0EgRzMwHhcNMjMw
NTE4MTQ1NDQ4WhcNMzgwNTIxMTQ1NDQ3WjCBkDELMAkGA1UEBhMCUk8xGDAWBgNV
BAoMD1RyYW5zIFNwZWQgUy5BLjEXMBUGA1UEYQwOVkFUUk8tMTI0NTg5MjQxIjAg
BgNVBAsMGVRyYW5zIFNwZWQgVHJ1c3QgU2VydmljZXMxKjAoBgNVBAMMIVRyYW5z
IFNwZWQgRWxlY3Ryb25pYyBTZWFsIFFDQSBHMzCCAiIwDQYJKoZIhvcNAQEBBQAD
ggIPADCCAgoCggIBAL9PPr0Pj9KqICOxRzlLH8DHAh7VnDAtwQw+EbfdQwYAVEed
70R4GEaAVE9nPFK7TQYWSHa7W2RNQLX077xm2LfWgsVDbBS8K+oqj5yseQviHnWM
9jZUY9m8IzYPMjaZ8nkoKha2DYjmyOihfUTigTPqBFwpfaKXHnKp0gcgRlqJtR7c
6kF9YwiX23nYr3Fgg/4JSx19aEug7JYsxBCofQjBmU307P4wTvlgmIhvrrp1F9NG
d2oSSHuF9BzV7TsKjNZBsaMRpnMXcIfoEtcZk79q3h8amDDZlRUQpm4wA+BZF925
EY0u5+Yq/Z3C4eLniQaR4Bz50QJ4aAk5v3/UlZSnQOzKyblnq4sJccz1zP6ndbtS
dGVY0BBXn5GEr2sIf+G02jTHzpEM6JeQY1K4ElZAKt06ZQF6lLWHNWbgkjVtYoRL
YInUF8WAmWlOubT/N9gKqIg6avwfcfNLWJwY/l5duYKX1GE78io8tY3aeWDK7FnL
0aAv3n9n8MjIAe/YsjVWIoc9+vd50amWWr8DoNqZt2FAL7kxJDdUL5+FbnAIAhI6
eAlXpNMUemi2gDF08yHq3PgaEUnfcwBFgafHUN8pR0LuL0706rgDivzrx58CQR7d
cmVqdcJSwyBSujZhLVmhfujjiHRssljPeba2w5TIXOpCzrQhBsOGNP0DbX+tAgMB
AAGjggFIMIIBRDASBgNVHRMBAf8ECDAGAQH/AgEAMB8GA1UdIwQYMBaAFHPAzzDz
hO71axAfc68Bg8YIt+RzMEoGCCsGAQUFBwEBBD4wPDA6BggrBgEFBQcwAoYuaHR0
cDovL3d3dy50cmFuc3NwZWQucm8vY2FjZXJ0cy90c19yb290X2czLnA3YzBVBgNV
HSAETjBMMAkGBwQAi+xAAQMwPwYLKwYBBAGCuB0FAQEwMDAuBggrBgEFBQcCARYi
aHR0cDovL3d3dy50cmFuc3NwZWQucm8vcmVwb3NpdG9yeTA7BgNVHR8ENDAyMDCg
LqAshipodHRwOi8vd3d3LnRyYW5zc3BlZC5yby9jcmwvdHNfcm9vdF9nMy5jcmww
HQYDVR0OBBYEFDzFjI1slEDmK5bq2GFsvKd3vBF0MA4GA1UdDwEB/wQEAwIBBjAN
BgkqhkiG9w0BAQsFAAOCAgEApNKBWWn2LcecyiWtt+Bd49DAljlVBHxnO25ZbWp+
NQkVMQ0rAaxbLT2DRlbunfNfTeBIeazv5u5MtsAS4QvzXAtj+A/6DJb7g9jj54li
arpGE76qmekP3J8obuK8mWUGxxpXzK/dOq1AzXxST1VIQuvwLL6Sj2A3xOoiivoq
0w/w3OAEhnG6xYqv5ACGVmt5cKUkl9DsuVgkQoDjLNBSLbaFE4vfFQSgcmwjQbOJ
ZDsGt3td0n6GCe2X05F9mGFLAArvktD6rnv2KqkMN1iCSyjLzxfPWBWiDiKhhAkn
cWXhK/wICIl+DpHpcebj9EEuoJylCkJivNjmW+eDRYn8yhDyBHM3GT25GQ+rTCvS
zbdQXiuYE6l81zdq/UXaGmH7Te02EnRR6lhvTDnST7YB5nhCNmeqXLVSMGO5CfPn
s8GnZ0nTtrLrjHi341QAryVblIgsyStN7bKsQ6medhMAikI5+OX8PCkHVVruhaWG
WSZJbyA+I3tipNqXGiETJ5Xqe+GN9K2E9RZ8nmNYx1MgXl/Yo37gSgTTRSwuyoIt
ebcWpWx+acBW36aU0jgxa6zJoi+3BUEoGQoaEFo3JrHIYjFjcbNp+dNBa8zEJwTv
NVQaV94dSrOVE4V5Y1gZ6jypIPPXbhiZoU9pfveyTlE0fyQgv5DVr4x3CM2AQTz1
DmE=
-----END CERTIFICATE-----`;

export const sealAnchors = (): readonly X509Certificate[] => [new X509Certificate(TRANS_SPED_ELECTRONIC_SEAL_QCA_G3)];
