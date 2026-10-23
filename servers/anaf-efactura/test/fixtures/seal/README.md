Test-only certificates for the seal tests (test/seal.test.ts), made with openssl on 2026-09-30:
`test-ca.crt` issues `seal-ok` (organizationIdentifier 25886108, the Ministry's) and `seal-other-org`
(99999999); `other-ca` issues `seal-foreign`. The leaf keys are here so the tests can sign seals in
ANAF's shape; they guard nothing, and the CA keys were deleted after issuing. The certificates are
`.crt`, not `.pem`: the repo's .gitignore keeps `*.pem` out as a guard against real credentials.
