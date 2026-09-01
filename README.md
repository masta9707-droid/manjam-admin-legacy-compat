# MANJAM legacy Admin compatibility build

This project preserves the deployed legacy Angular Admin presentation and adds
one narrowly scoped compatibility gateway for the current backend MFA contract.

## Provenance

- Live source mirrored from `https://admin.dev.manjaglobal.com/` on 2026-08-27.
- Deployed legacy Git source identified in Coolify as private repository
  `manja-dev-test/tht-admin`, branch `dev`, commit
  `31447d1652d20a0cbdcff7cdc693400316f95710`.
- The original repository is not accessible to the current GitHub account, so
  this recovery copy does not claim to replace its editable Angular source.
- `public/index.original.html` is retained as evidence of the unmodified entry
  document. The downloaded Angular bundles are otherwise unchanged.

## Compatibility delta

`public/mfa-compat.js` takes over only the logged-out route. It calls the current
password endpoint, handles an MFA challenge, verifies the six-digit code, and
then writes only the same `currentUser` and `token` keys expected by the legacy
session service. The password, OTP and challenge token are never persisted.

The backend MFA policy is not disabled or bypassed.

## Verification

```sh
npm run verify
docker build -t manjam-admin-legacy-compat .
```

Do not switch the Coolify source or domain until the local fixture test, real
staging MFA round-trip, rollback image and exact deployment approval are ready.
