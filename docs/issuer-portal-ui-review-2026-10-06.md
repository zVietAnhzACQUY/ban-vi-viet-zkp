# Issuer Portal UI review — 2026-10-06

## Scope and changed files

Source and live routes were inspected before editing; previous reports were not used as implementation evidence.

- `apps/issuer-portal/src/App.tsx`: independent shell, operator login, landing, dashboard statistics/filter/search, request detail and confirmation dialogs, customer receive session guidance.
- `apps/issuer-portal/src/styles.css`: navy/blue design tokens, system fonts, responsive dashboard/cards, feedback states and dialogs.
- `apps/issuer-portal/src/api.ts`: optional public lifecycle timestamp typing only.
- `apps/issuer-portal/index.html`: neutral title, description and theme color.
- `apps/issuer-portal/src/flow.test.ts`: UI boundary regression coverage.
- `apps/web/src/App.tsx`, `age-request-flow.ts`, `age-request-flow.test.ts`: neutral customer-facing explanatory copy; minimal customer tracking remains on Website.
- `apps/api/src/app.ts`: recordChecked error wording only; error code, role enforcement and state machine unchanged.

No schema or migration edits. No production/public business-data changes. Application tests use the existing isolated `g2_test_20261005` schema and synthetic fixtures; their runner confirms eight existing migrations and no pending migration. Browser login/logout creates/removes test sessions, but no existing request was approved, rejected, revoked or claimed.

## Content decisions

Removed prominent simulation/pilot/role/KYC/VNeID disclaimers and internal architecture explanations from Portal UI. Login now explicitly addresses operating staff; Website copy explains external record checking without collecting identity documents or DOB. recordChecked error now requests confirmation of external checking in plain language.

Retained business errors, expiry/revocation warnings, ownership checks, role enum names, technical test names and documentation limitations. Actual account names/email addresses are not rewritten: the public seed account name and email still contain `demo`, as account data rather than decorative UI copy.

This remains an internal pilot: no real KYC, VNeID or government identity integration. Existing threat models/technical limitations remain applicable. No production-readiness claim.

## Verification

- Application suite: 83 tests; all passed.
- Website, Wallet and Issuer Portal production builds passed; `tsc --noEmit` passed, including an independent rerun after the API wording change.
- Existing Website/Wallet large-chunk build warnings remain; Portal build has no chunk warning.
- G1 static SHA-256 baseline: 45/45 unchanged. Dynamic witness evidence excluded from this immutable comparison; no circuit rebuild.
- Edited Vietnamese UI source is Unicode NFC.

Real Codex in-app browser URLs tested at origin `http://127.0.0.1:5175`:

- `/`: logged-out landing has operator login and Website return links.
- `/login`: accessible; ADMIN sign-in reaches dashboard; logout returns here.
- `/operator`: unauthenticated redirects internally to `/login`; CUSTOMER sees access denied. Existing API integration tests also enforce operator role and recordChecked.
- `/operator/ad541d9c-5106-4690-81e0-642c65213c09`: pending detail, approval disabled before recordChecked; checking it opens confirmation. Confirmation was cancelled, not submitted. Mutation success is covered by isolated API tests rather than modifying this public request.
- `/receive-age/ad541d9c-5106-4690-81e0-642c65213c09`: owning CUSTOMER sees minimal pending state, no claim button; missing session shows Website login guidance and stays on receive route, not operator login.

Dashboard tested at 390 × 844: document scrollWidth=390, innerWidth=390; no horizontal overflow. Login also has no horizontal overflow. Viewport override reset afterwards.

Fresh login browser tab had no console warnings/errors. Earlier development tab retained transient Vite HMR errors while files were being replaced; these did not recur on fresh load. No continuous polling is added to Portal. React StrictMode can issue duplicate initial GETs during development; this is not a polling loop.

No live ISSUED fixture was available for a safe end-to-end Wallet redemption; that final live step remains for owner verification. No private key or owner credential was accessed. Synthetic cryptographic integration fixtures are exercised by the existing application test runner.

## Screenshot evidence

The original login was captured in the browser tool before editing; that capture was not persisted as a local file. Saved post-change evidence:

- `evidence/issuer-ui-20261006/login-after.jpg`
- `evidence/issuer-ui-20261006/login-mobile.jpg`
- `evidence/issuer-ui-20261006/operator-desktop.jpg`
- `evidence/issuer-ui-20261006/operator-mobile.jpg`
- `evidence/issuer-ui-20261006/receive-pending.jpg`

## Operator usage

Open Portal `/login`, sign in with the existing operator account, filter/search requests and choose **Xem chi tiết**. Confirm external record checking before approval. Approval/rejection/revocation require dialog confirmation. Birth date is never entered here; existing Issuer CLI signing remains unchanged. Customers track requests on Website and only continue to Portal reception when ISSUED.
