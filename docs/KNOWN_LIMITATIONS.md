# Known limitations

- The repository has not been connected to a customer Supabase project. No migration has been applied to a live project and no real user sign-in or buyer isolation test has been run.
- Admins can create buyers, units and working days, lines, stage/TNA templates, holidays and a unit risk policy in the app. The User management page creates auth users and profiles, changes roles and active status, resets passwords, updates email, and maps buyer users. Initial first-admin provisioning, project secrets, migrations and Edge Function deployment remain trusted project setup; buyer/unit deactivation, arbitrary stage editing and editing an existing unit calendar remain incomplete.
- The planning interface selects active templates, dates, production lines and supervisors, but does not yet support free-form stage insertion/reordering or maintaining templates from the app.
- Photo approval screen is implemented and new uploads create a pending review record. Its nested Supabase query and storage signing require validation against a real project. Photos added before the migration/trigger will need an administrator to create their approval row.
- Buyer portal signed media and AI functions need deployed Edge Functions and secrets.
- Audio transcription quality, Tamil language detection, file support and provider pricing/free-tier eligibility have not been validated with factory recordings or provider credentials. Gemini output is labelled for review and does not auto-save as approved.
- Weekly PDF/XLSX generation exports buyer-safe order progress and buyer-visible milestones. Approved photo embedding/reference delivery and reviewed buyer-safe remarks are not yet included. Export generation is client-side and a report row is logged; files are not archived in private storage.
- Production update/issue history screen is not complete; update rows are append-only in the database, but the app does not yet provide a full amendment UI.
- No activity monitor, automated alert delivery, backup job, log aggregation or production deployment configuration is attached.
- The app currently loads order snapshots on sign-in; it does not yet subscribe to realtime changes or offer a full manual refresh state.
- Offline queue tests on low-end Android, browser eviction handling, large audio and failed partial media upload recovery need field validation. Clearing site data can erase unsynced IndexedDB entries.
- Test/build validation so far is a TypeScript + Vite production build only. Core acceptance workflows and backend policies have not been integration-tested.
- `npm install` reports transitive dependency advisories. The registry audit endpoint was unreachable when checked, so advisory details could not be verified; review the lockfile and update dependencies before public deployment.
