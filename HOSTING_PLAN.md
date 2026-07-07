# Coach Live Map: Hosted Web App Plan

## Goal

Move the current local prototype into a hosted web app that coaches and runners can access from real links, with saved profiles and run history stored in a real database instead of one browser.

## Recommended First Hosted Shape

- App server: long-running Node.js server.
- Database: Postgres.
- Frontend: keep the current HTML/CSS/JS pages for now.
- Live tracking: keep Server-Sent Events for coach/runner updates.
- Saved data: move profiles, run summaries, route points, splits, history, and notes into Postgres.

This app uses live GPS updates and live dashboard streams, so a normal always-on Node host is a better first fit than a serverless-only setup.

## What Changes First

Current prototype:

- Live sessions are kept in server memory.
- Runner profiles and saved runs are kept in browser local storage.
- Data only lives on the device/browser that saved it.

Hosted version:

- Coach has an account.
- Runner profiles are stored in Postgres.
- Saved run entries are stored in Postgres.
- Notes, goals, profile photos/URLs, route points, splits, weather, and history are stored in Postgres.
- Any device logged into the coach account can see the same profiles and saved runs.

## Database Tables

The first schema lives in `db/schema.sql`.

Main tables:

- `coaches`: coach account records.
- `runner_profiles`: each runner/client profile.
- `run_entries`: one saved run summary.
- `run_route_points`: GPS route points for saved runs.
- `run_mile_splits`: per-mile pace/elevation.
- `run_coach_splits`: coach-created split segments.
- `run_history_items`: start/pause/stop, coach notes, mile markers, split markers.
- `live_sessions`: optional first step toward storing live session metadata.

## Migration Order

1. Add Postgres connection to the Node server.
2. Add backend API routes for profiles:
   - `GET /api/profiles`
   - `POST /api/profiles`
   - `GET /api/profiles/:id`
   - `PATCH /api/profiles/:id`
3. Add backend API routes for saved runs:
   - `POST /api/profiles/:id/runs`
   - `GET /api/profiles/:id/runs`
   - `GET /api/profiles/:id/runs/:runId`
   - `PATCH /api/profiles/:id/runs/:runId/notes`
4. Update the browser code to call those APIs instead of local storage.
5. Add basic coach login.
6. Deploy the Node server and connect it to hosted Postgres.
7. Test with one real coach account and one or two runner profiles.

## Photo Storage

For the prototype, profile photos are stored in browser local storage as image data. For hosted use, this should change.

Recommended hosted approach:

- Upload profile photos to object storage.
- Save only the photo URL in `runner_profiles.photo_url`.

This keeps the database smaller and avoids storing large base64 images in profile rows.

## Live GPS Notes

The current live tracking session can stay in memory for the first hosted version, but that has limits:

- If the server restarts, the active live session resets.
- Saved runs are fine after they are written to the database.
- Multiple server instances would need shared state later.

That is okay for early client testing. Later, live session state can move into Redis or Postgres if needed.

## Deployment Checklist

Before client use:

- Set `DATABASE_URL`.
- Set `PUBLIC_APP_URL`.
- Set `SESSION_SECRET`.
- Run `db/schema.sql` against the hosted database.
- Make sure the host supports long-lived HTTP connections for Server-Sent Events.
- Test runner GPS from a real phone over HTTPS.
- Test coach dashboard from a laptop over HTTPS.
- Confirm saved run appears from a second browser/device.

## Best Next Coding Step

Build the profile/run API in `server.js`, then update `public/run-storage.js` so it talks to the server instead of local storage.

That gives us the biggest upgrade first: real client profiles and saved run history that persist across devices.
