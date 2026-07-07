# CoachLink

CoachLink is a web prototype for live virtual run coaching.

It includes:

- Runner tracking page for GPS, distance, pace, elevation, start/pause/stop.
- Coach dashboard with live map, current mile pace, average pace, elevation, private coach notes, and coach-controlled splits.
- Saved runner profiles.
- Saved run summaries with route map, mile splits, coach splits, history, weather, and notes.

## Run Locally

```sh
npm start
```

Then open:

- `http://127.0.0.1:4173/`
- `http://127.0.0.1:4173/coach.html?session=demo`
- `http://127.0.0.1:4173/runner.html?session=demo`

## Deploy Notes

This app is currently a Node web app with browser-based saved data. The next production step is connecting profiles and saved run history to Postgres.

See:

- `HOSTING_PLAN.md`
- `DATABASE_MIGRATION_CHECKLIST.md`
- `db/schema.sql`
