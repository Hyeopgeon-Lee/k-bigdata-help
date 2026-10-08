# Performance and regression validation (2026-10-08)

The change preserves the HTML layout and stylesheet. Public home data has a 30-second GAS cache; successful mutations flush Sheets and advance a persistent cache generation. Old in-flight readers can populate only an obsolete generation. Manual spreadsheet edits become visible after cache expiry. Private results, PINs, and administrator credentials are not persisted in this cache.

Concurrent identical reads share an in-flight fetch. Completed private reads are removed immediately. Writes are never retried or coalesced automatically because create and mail delivery do not provide end-to-end idempotency. Submit guards prevent duplicate form events. Successful update and delete responses update the current view without a second network round trip. Administrator load versions suppress stale responses; unrelated draft reply fields remain intact after a save.

GAS update/delete use exact request-ID column matching followed by a single row read and contiguous batch write. All mutations and one-time token redemption use the script lock. Immediate and summary mail share the same lock and email marker. This prevents concurrent normal execution from sending the same request twice and preserves administrator status changes. User text is escaped before Sheets writes to prevent formula interpretation; leading-zero student identifiers retain their text representation.

## Validation

- `node --test tests/*.test.mjs`: 11 tests pass (API security, cache generations, creation, authorization, targeted update/delete, mail failure and deduplication, status preservation, in-flight read coalescing).
- `BASELINE_GAS=/path/to/baseline.gs node --test tests/*.test.mjs`: includes a twelfth test comparing original and changed code against the same 1,000-row mock Sheets fixture.
- `node tests/browser-smoke.cjs`: Playwright with installed Microsoft Edge. Requires Playwright on the Node resolution path. `TEST_OUTPUT_DIR` selects the screenshot/results directory. 16 page/viewport scenarios pass at 320, 390, 768 and 1440 px; exercise registration, lookup, deletion and administrator save with intercepted API responses. No page errors or horizontal overflow. These are mock API browser checks, not production writes.
- Frontend syntax checks, GAS parsing through the VM, manifest JSON parsing and `git diff --check` pass.
- The PR workflow runs security/performance and syntax checks without deployment credentials; main push and manual workflow retain existing GAS deployment behavior.

## Measured operation counts

| 1,000-row fixture | Original | Changed |
|---|---:|---:|
| Two public loads: spreadsheet opens | 2 | 1 |
| Two public loads: cells read | 30,030 | 15,015 |
| One update: spreadsheet opens | 2 | 1 |
| One update: cells transferred to script | 15,030 | 30 |
| One update: write calls | 3 | 1 |
| Browser delete: API round trips including refresh | 2 | 1 |
| Browser save: API round trips including refresh | 2 | 1 |

TextFinder still searches the request-ID column inside Sheets; the 30-cell count describes transferred values, not constant-time database indexing. Mock operation counts are not production latency measurements.

## Deployment and remaining limitations

Changes require a new Apps Script web app version as well as publishing the frontend assets. PR branch publication does not update the live service. After merge, check GitHub Pages and the GAS workflow separately: missing GAS secrets cause a skipped deployment, not a successful production update.

The current public home and GAS list are reachable. Read-only GAS baseline samples measured approximately 3.6 and 4.5 seconds from the development environment, including redirects. No post-deployment speedup has been measured. Served index/API/admin/CSS match the repository baseline after line-ending normalization. Repository GAS code was reviewed, but the deployed GAS project source and live Sheets data were not independently read.

Cold public requests and private/admin listing still scan the sheet; request-ID generation scans the ID column. Immediate mail remains synchronous to preserve the existing notification contract and takes the script lock during delivery, so mail latency can delay concurrent writes. Four-digit PIN authentication still lacks server-side rate limiting. A crash after mail acceptance but before the sent marker is committed can lead to a duplicate retry; Apps Script MailApp and Sheets do not support an atomic transaction. These require follow-up design decisions rather than claims of complete elimination.

Production registration/deletion/status writes and actual email sending were not exercised. Tests use isolated fixtures and an intercepted network. Do not run `testDailyRequestSummary` merely as a read-only verification: it sends real email and changes real rows.
