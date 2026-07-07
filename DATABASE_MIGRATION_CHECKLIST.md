# Database Migration Checklist

## Phase 1: Profiles And Saved Runs

- Add Postgres client dependency.
- Create a small `db.js` helper with:
  - database connection
  - query helper
  - local startup validation
- Add profile API routes to `server.js`.
- Add saved-run API routes to `server.js`.
- Update `public/run-storage.js` so profile functions use `fetch(...)` instead of `localStorage`.
- Keep local storage as a temporary fallback only if `DATABASE_URL` is missing.

## Phase 2: Coach Login

- Add coach account creation/login.
- Attach every runner profile to a coach.
- Hide profiles from other coaches.
- Add logout.

## Phase 3: Hosted Runner Sessions

- Generate unique session links per run.
- Add a simple session setup screen.
- Store live session metadata in `live_sessions`.
- Keep actual live route points in memory during the active run until save.

## Phase 4: Production Hardening

- Move uploaded profile photos to object storage.
- Add backups.
- Add rate limits for GPS location posting.
- Add privacy/consent language for runner tracking.
- Add error states for GPS, database, and dropped connections.
