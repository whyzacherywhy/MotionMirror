import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
const __dirname = dirname(fileURLToPath(import.meta.url));

export const hasDatabase = Boolean(databaseUrl);

const pool = hasDatabase
  ? new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false },
    })
  : null;

export async function initDatabase() {
  if (!pool) return;
  const schema = await readFile(join(__dirname, "db", "schema.sql"), "utf8");
  await pool.query(schema);
  await ensureDefaultCoach();
}

async function query(text, params = []) {
  if (!pool) throw new Error("Database is not configured.");
  return pool.query(text, params);
}

async function transaction(callback) {
  if (!pool) throw new Error("Database is not configured.");
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function msDate(value) {
  if (!value) return null;
  return new Date(value).getTime();
}

function isoDate(value) {
  if (!value) return null;
  return new Date(value).toISOString();
}

function intOrNull(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

function mapProfile(row, runs = []) {
  return {
    id: row.id,
    name: row.name,
    age: row.age || "",
    location: row.location || "",
    goals: row.goals || "",
    coachNotes: row.coach_notes || "",
    photo: row.photo_url || "",
    createdAt: msDate(row.created_at),
    updatedAt: msDate(row.updated_at),
    runs,
  };
}

function mapRunSummary(row) {
  return {
    id: row.id,
    title: row.title,
    dateLabel: row.date_label,
    startedAt: msDate(row.started_at),
    endedAt: msDate(row.ended_at),
    distanceMiles: Number(row.distance_miles || 0),
    elapsedSeconds: Number(row.elapsed_seconds || 0),
    averagePace: Number(row.average_pace || 0),
    elevationGainFeet: Number(row.elevation_gain_feet || 0),
    elevationLossFeet: Number(row.elevation_loss_feet || 0),
    weather: row.weather || {},
    notes: row.notes || "",
    savedAt: msDate(row.created_at),
  };
}

function mapRun(row) {
  return {
    ...mapRunSummary(row),
    runnerName: row.runner_name || "Runner",
    mileSplits: [],
    coachSplits: [],
    route: [],
    history: [],
  };
}

function mapCoach(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    hasPassword: Boolean(row.password_hash),
  };
}

async function ensureDefaultCoach() {
  const email = process.env.COACH_EMAIL || "coach@coachlink.local";
  const displayName = process.env.COACH_NAME || "Coach";
  await query(
    `insert into coaches (email, display_name)
     values ($1, $2)
     on conflict (email) do update set display_name = excluded.display_name, updated_at = now()`,
    [email, displayName],
  );
}

export async function setupRequired() {
  const result = await query("select count(*)::int as count from coaches where password_hash is not null");
  return Number(result.rows[0]?.count || 0) === 0;
}

export async function findCoachByEmail(email) {
  const result = await query("select * from coaches where lower(email) = lower($1) limit 1", [email]);
  return result.rows[0] || null;
}

export async function getCoachById(coachId) {
  const result = await query("select * from coaches where id = $1 limit 1", [coachId]);
  return mapCoach(result.rows[0]);
}

export async function saveCoachLogin({ email, displayName, passwordHash }) {
  const result = await query(
    `insert into coaches (email, display_name, password_hash)
     values ($1, $2, $3)
     on conflict (email) do update
       set display_name = excluded.display_name,
           password_hash = excluded.password_hash,
           updated_at = now()
     returning *`,
    [email, displayName || "Coach", passwordHash],
  );
  const coach = mapCoach(result.rows[0]);
  await query(
    `update runner_profiles
     set coach_id = $1, updated_at = now()
     where coach_id is null
        or coach_id in (select id from coaches where password_hash is null)`,
    [coach.id],
  );
  return coach;
}

export async function suggestedCoach() {
  const email = process.env.COACH_EMAIL || "coach@coachlink.local";
  const displayName = process.env.COACH_NAME || "Coach";
  return { email, displayName };
}

export async function createLiveSession({ id, coachId, runnerName = "Runner" }) {
  const result = await query(
    `insert into live_sessions (id, coach_id, runner_name, status)
     values ($1, $2, $3, 'idle')
     returning *`,
    [id, coachId, runnerName],
  );
  return result.rows[0];
}

export async function getLiveSession(id) {
  const result = await query("select * from live_sessions where id = $1 limit 1", [id]);
  return result.rows[0] || null;
}

export async function updateLiveSessionStatus(id, updates = {}) {
  if (!id) return null;
  const result = await query(
    `update live_sessions
     set runner_name = coalesce($2, runner_name),
         status = coalesce($3, status),
         started_at = coalesce($4, started_at),
         elapsed_ms = coalesce($5, elapsed_ms),
         updated_at = now()
     where id = $1
     returning *`,
    [
      id,
      updates.runnerName ?? null,
      updates.status ?? null,
      updates.startedAt ? isoDate(updates.startedAt) : null,
      Number.isFinite(updates.elapsedMs) ? Math.round(updates.elapsedMs) : null,
    ],
  );
  return result.rows[0] || null;
}

export async function listProfiles(coachId) {
  const profiles = await query(
    `select *
     from runner_profiles
     where coach_id = $1
     order by updated_at desc, created_at desc`,
    [coachId],
  );
  const runs = await query(
    `select re.*
     from run_entries re
     join runner_profiles rp on rp.id = re.profile_id
     where rp.coach_id = $1
     order by re.started_at desc`,
    [coachId],
  );
  const runsByProfile = new Map();
  for (const run of runs.rows) {
    if (!runsByProfile.has(run.profile_id)) runsByProfile.set(run.profile_id, []);
    runsByProfile.get(run.profile_id).push(mapRunSummary(run));
  }
  return profiles.rows.map((profile) => mapProfile(profile, runsByProfile.get(profile.id) || []));
}

export async function createProfile({ name, coachId }) {
  const result = await query(
    `insert into runner_profiles (coach_id, name)
     values ($1, $2)
     returning *`,
    [coachId, name || "Runner"],
  );
  return mapProfile(result.rows[0], []);
}

export async function getProfile(profileId, coachId) {
  const profileResult = await query("select * from runner_profiles where id = $1 and coach_id = $2", [
    profileId,
    coachId,
  ]);
  const profile = profileResult.rows[0];
  if (!profile) return null;
  const runsResult = await query(
    `select * from run_entries
     where profile_id = $1
     order by started_at desc, created_at desc`,
    [profileId],
  );
  return mapProfile(profile, runsResult.rows.map(mapRunSummary));
}

export async function updateProfile(profileId, coachId, updates) {
  const result = await query(
    `update runner_profiles
     set name = coalesce($2, name),
         age = coalesce($3, age),
         location = coalesce($4, location),
         goals = coalesce($5, goals),
         coach_notes = coalesce($6, coach_notes),
         photo_url = coalesce($7, photo_url),
         updated_at = now()
     where id = $1 and coach_id = $8
     returning *`,
    [
      profileId,
      updates.name ?? null,
      updates.age ?? null,
      updates.location ?? null,
      updates.goals ?? null,
      updates.coachNotes ?? null,
      updates.photo ?? null,
      coachId,
    ],
  );
  if (!result.rows[0]) return null;
  const profile = await getProfile(profileId, coachId);
  return profile;
}

export async function getRun(profileId, runId, coachId) {
  const result = await query(
    `select re.*
     from run_entries re
     join runner_profiles rp on rp.id = re.profile_id
     where re.profile_id = $1 and re.id = $2 and rp.coach_id = $3`,
    [
    profileId,
    runId,
      coachId,
    ],
  );
  const row = result.rows[0];
  if (!row) return null;
  const run = mapRun(row);

  const [route, miles, coachSplits, history] = await Promise.all([
    query("select * from run_route_points where run_id = $1 order by point_index", [runId]),
    query("select * from run_mile_splits where run_id = $1 order by mile_number", [runId]),
    query("select * from run_coach_splits where run_id = $1 order by split_number", [runId]),
    query("select * from run_history_items where run_id = $1 order by happened_at, id", [runId]),
  ]);

  run.route = route.rows.map((point) => ({
    lat: Number(point.lat),
    lng: Number(point.lng),
    altitude: point.altitude === null ? null : Number(point.altitude),
    at: msDate(point.recorded_at),
  }));
  run.mileSplits = miles.rows.map((mile) => ({
    number: mile.mile_number,
    label: mile.label || `Mile ${mile.mile_number}`,
    distanceMiles: Number(mile.distance_miles || 1),
    isPartial: Boolean(mile.is_partial),
    endedAt: msDate(mile.ended_at),
    seconds: Number(mile.seconds || 0),
    pace: Number(mile.pace || 0),
    elevationFeet: mile.elevation_feet,
  }));
  run.coachSplits = coachSplits.rows.map((split) => ({
    number: split.split_number,
    startedAt: msDate(split.started_at),
    endedAt: msDate(split.ended_at),
    elapsedSeconds: Number(split.elapsed_seconds || 0),
    distanceMeters: Number(split.distance_meters || 0),
    distanceMiles: Number(split.distance_miles || 0),
    pace: Number(split.pace || 0),
    elevationFeet: split.elevation_feet,
  }));
  run.history = history.rows.map((item) => ({
    at: msDate(item.happened_at),
    type: item.item_type,
    text: item.text,
  }));
  return run;
}

export async function saveRun(profileId, coachId, run) {
  return transaction(async (client) => {
    const profile = await client.query("select id from runner_profiles where id = $1 and coach_id = $2", [
      profileId,
      coachId,
    ]);
    if (!profile.rows[0]) return null;

    const inserted = await client.query(
      `insert into run_entries (
         profile_id, title, date_label, started_at, ended_at, distance_miles,
         elapsed_seconds, average_pace, elevation_gain_feet, elevation_loss_feet,
         weather, notes
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       returning *`,
      [
        profileId,
        run.title,
        run.dateLabel,
        isoDate(run.startedAt),
        isoDate(run.endedAt),
        run.distanceMiles || 0,
        Math.round(run.elapsedSeconds || 0),
        run.averagePace || 0,
        Math.round(run.elevationGainFeet || 0),
        Math.round(run.elevationLossFeet || 0),
        JSON.stringify(run.weather || {}),
        run.notes || "",
      ],
    );
    const saved = inserted.rows[0];

    for (const [index, point] of (run.route || []).entries()) {
      await client.query(
        `insert into run_route_points (run_id, point_index, lat, lng, altitude, recorded_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [saved.id, index, point.lat, point.lng, point.altitude ?? null, isoDate(point.at)],
      );
    }

    for (const mile of run.mileSplits || []) {
      await client.query(
        `insert into run_mile_splits (
           run_id, mile_number, label, distance_miles, is_partial, ended_at,
           seconds, pace, elevation_feet
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          saved.id,
          mile.number,
          mile.label || `Mile ${mile.number}`,
          mile.distanceMiles || 1,
          Boolean(mile.isPartial),
          isoDate(mile.endedAt),
          Math.round(mile.seconds || 0),
          mile.pace || 0,
          intOrNull(mile.elevationFeet),
        ],
      );
    }

    for (const split of run.coachSplits || []) {
      await client.query(
        `insert into run_coach_splits (
           run_id, split_number, started_at, ended_at, elapsed_seconds,
           distance_meters, distance_miles, pace, elevation_feet
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          saved.id,
          split.number,
          isoDate(split.startedAt),
          isoDate(split.endedAt),
          Math.round(split.elapsedSeconds || 0),
          split.distanceMeters || 0,
          split.distanceMiles || 0,
          split.pace || 0,
          intOrNull(split.elevationFeet),
        ],
      );
    }

    for (const item of run.history || []) {
      await client.query(
        `insert into run_history_items (run_id, happened_at, item_type, text)
         values ($1, $2, $3, $4)`,
        [saved.id, isoDate(item.at), item.type || "note", item.text || ""],
      );
    }

    await client.query("update runner_profiles set updated_at = now() where id = $1", [profileId]);
    return mapRunSummary(saved);
  });
}

export async function updateRunNotes(profileId, runId, coachId, notes) {
  const result = await query(
    `update run_entries re
     set notes = $3, updated_at = now()
     from runner_profiles rp
     where re.profile_id = $1 and re.id = $2 and re.profile_id = rp.id and rp.coach_id = $4
     returning re.*`,
    [profileId, runId, notes || "", coachId],
  );
  return result.rows[0] ? mapRunSummary(result.rows[0]) : null;
}

export async function deleteRun(profileId, runId, coachId) {
  const result = await query(
    `delete from run_entries re
     using runner_profiles rp
     where re.profile_id = $1 and re.id = $2 and re.profile_id = rp.id and rp.coach_id = $3
     returning re.id`,
    [profileId, runId, coachId],
  );
  if (!result.rows[0]) return false;
  await query("update runner_profiles set updated_at = now() where id = $1", [profileId]);
  return true;
}
