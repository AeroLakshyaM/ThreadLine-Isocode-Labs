# Test report

## Executed checks

| Check | Expected | Actual | Result |
|---|---|---|---|
| `npm install` | Install declared dependencies | Completed; the latest install reported 7 vulnerabilities (2 low, 5 moderate). Registry audit endpoint was unavailable, so the advisory details could not be checked. | Pass with dependency follow-up |
| `npm run build` | TypeScript check and Vite/PWA production bundle | Completed successfully after the workspace setup and photo approval screens. The bundle warns about an ExcelJS chunk above 500 kB; report libraries are lazy-loaded. | Pass with bundle warning |

## Not executed

No Supabase project credentials were supplied. Database migration application, role/RLS checks, browser flows, buyer cross-account denial, signed-photo access, provider calls, report contents, offline retry, duplicate replay, low-end Android behavior, failed uploads, Tamil transcription and actual PDF/XLSX opening have not been integration-tested. No acceptance test is claimed as passed.

## Required before acceptance

Execute the acceptance cases in the supplied master prompt in a disposable staging project with separate merchandiser, supervisor, buyer A, buyer B and admin accounts. Record actual results, screenshots/log references, device/browser/version and known defects. Confirm that replaying an update UUID does not duplicate quantity and that changing a buyer's order ID in an API request returns no data.
