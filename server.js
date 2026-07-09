import http from "node:http";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createLiveSession,
  createProfile,
  deleteProfile,
  deleteRun,
  findCoachByEmail,
  getCoachById,
  getLiveSession,
  getProfile,
  getRun,
  hasDatabase,
  initDatabase,
  listProfiles,
  saveRun,
  saveCoachLogin,
  setupRequired,
  suggestedCoach,
  updateLiveSessionStatus,
  updateProfile,
  updateRunNotes,
} from "./db.js";

const root = fileURLToPath(new URL("./public", import.meta.url));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";

const sessions = new Map();
const coachStreams = new Set();
const runnerStreams = new Map();
const sessionSecret = process.env.SESSION_SECRET || "local-dev-secret-change-me";

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function sign(value) {
  return createHmac("sha256", sessionSecret).update(value).digest("base64url");
}

function signedCookieValue(coachId) {
  return `${coachId}.${sign(coachId)}`;
}

function verifySignedCookie(value) {
  if (!value) return null;
  const [coachId, signature] = value.split(".");
  if (!coachId || !signature) return null;
  const expected = sign(coachId);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  return coachId;
}

function cookieOptions(req) {
  const secure = req.headers["x-forwarded-proto"] === "https" || process.env.NODE_ENV === "production";
  return `HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${secure ? "; Secure" : ""}`;
}

function setCoachCookie(req, res, coachId) {
  res.setHeader("set-cookie", `coach_session=${encodeURIComponent(signedCookieValue(coachId))}; ${cookieOptions(req)}`);
}

function clearCoachCookie(res) {
  res.setHeader("set-cookie", "coach_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(password, salt, 64).toString("base64url");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const actual = Buffer.from(scryptSync(password, salt, 64).toString("base64url"));
  const expected = Buffer.from(hash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function currentCoach(req) {
  if (!hasDatabase) return null;
  const coachId = verifySignedCookie(parseCookies(req).coach_session);
  if (!coachId) return null;
  return getCoachById(coachId);
}

function authRequired(res) {
  return json(res, 401, { error: "Coach login required." });
}

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, createSession(id));
  }
  return sessions.get(id);
}

function createSession(id, previous = {}) {
  return {
    id,
    coachId: previous.coachId || null,
    mode: previous.mode || "free",
    runnerName: previous.runnerName || "Runner",
    runnerNameEditedByCoach: previous.runnerNameEditedByCoach || false,
    startedAt: previous.startedAt || null,
    lastPoint: null,
    points: [],
    cues: [],
    events: [],
    effortSplit: null,
    effortSplits: [],
    coachConnections: previous.coachConnections || 0,
    runnerConnections: previous.runnerConnections || 0,
    elapsedMs: previous.elapsedMs || 0,
    trackingStartedAt: null,
    status: previous.status || "idle",
  };
}

async function loadSession(id) {
  if (sessions.has(id)) return sessions.get(id);
  let previous = {};
  if (hasDatabase) {
    const liveSession = await getLiveSession(id);
    if (liveSession) {
      previous = {
        coachId: liveSession.coach_id,
        mode: liveSession.mode || "free",
        runnerName: liveSession.runner_name,
        elapsedMs: liveSession.elapsed_ms,
        status: liveSession.status,
        startedAt: liveSession.started_at ? new Date(liveSession.started_at).getTime() : null,
      };
    }
  }
  const session = createSession(id, previous);
  sessions.set(id, session);
  return session;
}

async function getCoachSession(id, coach) {
  const session = await loadSession(id || "demo");
  if (hasDatabase && session.coachId !== coach?.id) return null;
  return session;
}

function resetSession(session) {
  const fresh = createSession(session.id, {
    coachId: session.coachId,
    runnerName: session.runnerName,
    runnerNameEditedByCoach: session.runnerNameEditedByCoach,
    coachConnections: session.coachConnections,
    runnerConnections: session.runnerConnections,
  });
  Object.keys(session).forEach((key) => delete session[key]);
  Object.assign(session, fresh);
  return session;
}

function finalizeTracking(session, now = Date.now()) {
  if (session.status === "live" && session.trackingStartedAt) {
    session.elapsedMs = (session.elapsedMs || 0) + now - session.trackingStartedAt;
    session.trackingStartedAt = null;
  }

  if (session.effortSplit?.trackingStartedAt) {
    session.effortSplit.elapsedMs =
      (session.effortSplit.elapsedMs || 0) + now - session.effortSplit.trackingStartedAt;
    session.effortSplit.trackingStartedAt = null;
  }
}

function effortElapsedMs(effortSplit, now = Date.now()) {
  if (!effortSplit) return 0;
  return (
    (effortSplit.elapsedMs || 0) +
    (effortSplit.trackingStartedAt ? now - effortSplit.trackingStartedAt : 0)
  );
}

function startTracking(session, now = Date.now()) {
  if (session.status !== "live") {
    session.trackingStartedAt = now;
    if (session.effortSplit && !session.effortSplit.trackingStartedAt) {
      session.effortSplit.trackingStartedAt = now;
    }
  }
  session.status = "live";
}

function startCoachSplit(session, now = Date.now()) {
  if (session.effortSplit) return;
  session.effortSplit = {
    number: (session.effortSplits || []).length + 1,
    startedAt: now,
    startedPointIndex: session.points.length,
    elapsedMs: 0,
    trackingStartedAt: session.status === "live" ? now : null,
  };
}

function elapsedMs(session, now = Date.now()) {
  if (session.status === "live" && session.trackingStartedAt) {
    return (session.elapsedMs || 0) + now - session.trackingStartedAt;
  }
  return session.elapsedMs || 0;
}

function recordEvent(session, type, at = Date.now()) {
  session.events ||= [];
  session.events.push({ type, at });
  if (session.events.length > 80) session.events.shift();
}

function serializeSession(session) {
  const now = Date.now();
  const effortSplit = session.effortSplit
    ? {
        ...session.effortSplit,
        elapsedMs: effortElapsedMs(session.effortSplit, now),
      }
    : null;

  return {
    ...session,
    elapsedMs: elapsedMs(session, now),
    effortSplit,
    presence: sessionPresence(session),
  };
}

function sendSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function keepAlive(res) {
  const timer = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, 15000);
  res.on("close", () => clearInterval(timer));
}

function broadcastCoach(event, data) {
  for (const res of coachStreams) sendSse(res, event, data);
}

function broadcastRunner(sessionId, event, data) {
  const streams = runnerStreams.get(sessionId);
  if (!streams) return;
  for (const res of streams) sendSse(res, event, data);
}

function sessionPresence(session) {
  return {
    sessionId: session.id,
    coachConnected: (session.coachConnections || 0) > 0,
    runnerConnected: (session.runnerConnections || 0) > 0,
  };
}

function broadcastPresence(session) {
  const presence = sessionPresence(session);
  broadcastCoach("presence", presence);
  broadcastRunner(session.id, "presence", presence);
}

function snapshot(coachId = null) {
  return [...sessions.values()]
    .filter((session) => !coachId || session.coachId === coachId)
    .map((session) => ({
      ...serializeSession(session),
      points: session.points.slice(-500),
      cues: session.cues.slice(-20),
      events: (session.events || []).slice(-80),
    }));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function databaseUnavailable(res) {
  return json(res, 503, { error: "Database is not configured." });
}

function isProtectedPage(urlPath) {
  return [
    "/coach",
    "/coach.html",
    "/profiles",
    "/profiles.html",
    "/profile",
    "/profile.html",
    "/run",
    "/run.html",
  ].includes(urlPath);
}

async function createCoachLiveSession(coach) {
  const id = `run-${randomBytes(9).toString("base64url")}`;
  await createLiveSession({ id, coachId: coach.id });
  const session = createSession(id, { coachId: coach.id });
  sessions.set(id, session);
  return session;
}

function safeFilePath(urlPath) {
  const aliases = {
    "/coach": "/coach.html",
    "/runner": "/runner.html",
    "/profiles": "/profiles.html",
    "/profile": "/profile.html",
    "/run": "/run.html",
    "/login": "/login.html",
  };
  const requested = urlPath === "/" ? "/index.html" : aliases[urlPath] || urlPath;
  const clean = normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, "");
  return join(root, clean);
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    const coach = await currentCoach(req);

    if (req.method === "GET" && url.pathname === "/api/auth/me") {
      const needsSetup = hasDatabase ? await setupRequired() : false;
      return json(res, 200, {
        authenticated: Boolean(coach),
        coach,
        setupRequired: needsSetup,
        suggestedCoach: needsSetup ? await suggestedCoach() : null,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/auth/setup") {
      if (!hasDatabase) return databaseUnavailable(res);
      if (!(await setupRequired())) return json(res, 409, { error: "Coach account already exists." });
      const body = await readBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const displayName = String(body.displayName || "Coach").trim() || "Coach";
      const password = String(body.password || "");
      if (!email || !password || password.length < 8) {
        return json(res, 400, { error: "Use an email and a password with at least 8 characters." });
      }
      const created = await saveCoachLogin({ email, displayName, passwordHash: hashPassword(password) });
      setCoachCookie(req, res, created.id);
      return json(res, 201, { coach: created });
    }

    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      if (!hasDatabase) return databaseUnavailable(res);
      const body = await readBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const coachRow = await findCoachByEmail(email);
      if (!coachRow || !verifyPassword(password, coachRow.password_hash)) {
        return json(res, 401, { error: "Email or password is incorrect." });
      }
      setCoachCookie(req, res, coachRow.id);
      return json(res, 200, {
        coach: { id: coachRow.id, email: coachRow.email, displayName: coachRow.display_name },
      });
    }

    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      clearCoachCookie(res);
      return json(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/api/sessions") {
      if (hasDatabase && !coach) return authRequired(res);
      return json(res, 200, snapshot(coach?.id || null));
    }

    if (req.method === "POST" && url.pathname === "/api/live-sessions") {
      if (!hasDatabase) return databaseUnavailable(res);
      if (!coach) return authRequired(res);
      const session = await createCoachLiveSession(coach);
      return json(res, 201, {
        session: serializeSession(session),
        coachUrl: `/coach?session=${encodeURIComponent(session.id)}`,
        runnerUrl: `/runner?session=${encodeURIComponent(session.id)}`,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/profiles") {
      if (!hasDatabase) return databaseUnavailable(res);
      if (!coach) return authRequired(res);
      return json(res, 200, { profiles: await listProfiles(coach.id) });
    }

    if (req.method === "POST" && url.pathname === "/api/profiles") {
      if (!hasDatabase) return databaseUnavailable(res);
      if (!coach) return authRequired(res);
      const body = await readBody(req);
      const name = String(body.name || "").trim();
      if (!name) return json(res, 400, { error: "Runner name is required." });
      return json(res, 201, { profile: await createProfile({ name, coachId: coach.id }) });
    }

    const profileMatch = url.pathname.match(/^\/api\/profiles\/([^/]+)$/);
    if (profileMatch && req.method === "GET") {
      if (!hasDatabase) return databaseUnavailable(res);
      if (!coach) return authRequired(res);
      const profile = await getProfile(profileMatch[1], coach.id);
      if (!profile) return json(res, 404, { error: "Profile not found." });
      return json(res, 200, { profile });
    }

    if (profileMatch && req.method === "PATCH") {
      if (!hasDatabase) return databaseUnavailable(res);
      if (!coach) return authRequired(res);
      const profile = await updateProfile(profileMatch[1], coach.id, await readBody(req));
      if (!profile) return json(res, 404, { error: "Profile not found." });
      return json(res, 200, { profile });
    }

    if (profileMatch && req.method === "DELETE") {
      if (!hasDatabase) return databaseUnavailable(res);
      if (!coach) return authRequired(res);
      const deleted = await deleteProfile(profileMatch[1], coach.id);
      if (!deleted) return json(res, 404, { error: "Profile not found." });
      return json(res, 200, { ok: true });
    }

    const profileRunCollectionMatch = url.pathname.match(/^\/api\/profiles\/([^/]+)\/runs$/);
    if (profileRunCollectionMatch && req.method === "POST") {
      if (!hasDatabase) return databaseUnavailable(res);
      if (!coach) return authRequired(res);
      const body = await readBody(req);
      const saved = await saveRun(profileRunCollectionMatch[1], coach.id, body.run || {});
      if (!saved) return json(res, 404, { error: "Profile not found." });
      return json(res, 201, { run: saved });
    }

    const profileRunNotesMatch = url.pathname.match(/^\/api\/profiles\/([^/]+)\/runs\/([^/]+)\/notes$/);
    if (profileRunNotesMatch && req.method === "PATCH") {
      if (!hasDatabase) return databaseUnavailable(res);
      if (!coach) return authRequired(res);
      const body = await readBody(req);
      const run = await updateRunNotes(profileRunNotesMatch[1], profileRunNotesMatch[2], coach.id, body.notes || "");
      if (!run) return json(res, 404, { error: "Run not found." });
      return json(res, 200, { run });
    }

    const profileRunMatch = url.pathname.match(/^\/api\/profiles\/([^/]+)\/runs\/([^/]+)$/);
    if (profileRunMatch && req.method === "DELETE") {
      if (!hasDatabase) return databaseUnavailable(res);
      if (!coach) return authRequired(res);
      const deleted = await deleteRun(profileRunMatch[1], profileRunMatch[2], coach.id);
      if (!deleted) return json(res, 404, { error: "Run not found." });
      return json(res, 200, { ok: true });
    }

    if (profileRunMatch && req.method === "GET") {
      if (!hasDatabase) return databaseUnavailable(res);
      if (!coach) return authRequired(res);
      const run = await getRun(profileRunMatch[1], profileRunMatch[2], coach.id);
      if (!run) return json(res, 404, { error: "Run not found." });
      return json(res, 200, { run });
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      if (hasDatabase && !coach) return authRequired(res);
      const sessionId = url.searchParams.get("sessionId");
      const session = sessionId ? await getCoachSession(sessionId, coach) : null;
      if (sessionId && !session) return json(res, 404, { error: "Session not found." });
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      coachStreams.add(res);
      if (session) {
        session.coachConnections = (session.coachConnections || 0) + 1;
        broadcastPresence(session);
      }
      keepAlive(res);
      sendSse(res, "snapshot", snapshot(coach?.id || null));
      req.on("close", () => {
        coachStreams.delete(res);
        if (session) {
          session.coachConnections = Math.max(0, (session.coachConnections || 0) - 1);
          broadcastPresence(session);
        }
      });
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/runner-events/")) {
      const sessionId = url.pathname.split("/").pop();
      const session = await loadSession(sessionId);
      if (hasDatabase && !session.coachId) return json(res, 404, { error: "Session not found." });
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      if (!runnerStreams.has(sessionId)) runnerStreams.set(sessionId, new Set());
      runnerStreams.get(sessionId).add(res);
      session.runnerConnections = (session.runnerConnections || 0) + 1;
      broadcastPresence(session);
      keepAlive(res);
      sendSse(res, "session", serializeSession(session));
      req.on("close", () => {
        runnerStreams.get(sessionId)?.delete(res);
        session.runnerConnections = Math.max(0, (session.runnerConnections || 0) - 1);
        broadcastPresence(session);
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/location") {
      const body = await readBody(req);
      const session = await loadSession(body.sessionId || "demo");
      if (hasDatabase && !session.coachId) return json(res, 404, { error: "Session not found." });
      const point = {
        lat: Number(body.lat),
        lng: Number(body.lng),
        accuracy: Number(body.accuracy || 0),
        altitude: body.altitude === null ? null : Number(body.altitude),
        speed: body.speed === null ? null : Number(body.speed),
        heading: body.heading === null ? null : Number(body.heading),
        at: Date.now(),
      };

      if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
        return json(res, 400, { error: "A valid latitude and longitude are required." });
      }

      const action = ["start", "resume", "track"].includes(body.action) ? body.action : "track";
      const mode = body.mode === "track" ? "track" : body.mode === "free" ? "free" : session.mode || "free";
      const previousStatus = session.status;
      const isFirstPoint = !session.startedAt;

      if (previousStatus === "paused" && action !== "resume") {
        return json(res, 202, { ok: true, ignored: true, session: serializeSession(session) });
      }

      if (!session.runnerNameEditedByCoach) {
        session.runnerName = body.runnerName || session.runnerName;
      }
      if (action === "start" || action === "resume") session.mode = mode;
      session.startedAt ||= point.at;
      if (isFirstPoint) {
        session.events = [];
        recordEvent(session, "start", point.at);
      } else if (previousStatus === "paused") {
        recordEvent(session, "resume", point.at);
      }
      startTracking(session, point.at);
      startCoachSplit(session, point.at);
      if (hasDatabase && session.coachId) {
        updateLiveSessionStatus(session.id, {
          runnerName: session.runnerName,
          mode: session.mode,
          status: session.status,
          startedAt: session.startedAt,
          elapsedMs: elapsedMs(session, point.at),
        }).catch(() => {});
      }
      session.lastPoint = point;
      session.points.push(point);
      if (session.points.length > 2000) session.points.shift();

      broadcastCoach("session", serializeSession(session));
      return json(res, 200, { ok: true, session: serializeSession(session) });
    }

    if (req.method === "POST" && url.pathname === "/api/runner-name") {
      if (hasDatabase && !coach) return authRequired(res);
      const body = await readBody(req);
      const session = await getCoachSession(body.sessionId || "demo", coach);
      if (!session) return json(res, 404, { error: "Session not found." });
      const runnerName = String(body.runnerName || "").trim().slice(0, 80);
      if (!runnerName) return json(res, 400, { error: "Runner name is required." });

      session.runnerName = runnerName;
      session.runnerNameEditedByCoach = true;
      if (hasDatabase && session.coachId) {
        updateLiveSessionStatus(session.id, { runnerName }).catch(() => {});
      }
      const serialized = serializeSession(session);
      broadcastCoach("session", serialized);
      broadcastRunner(session.id, "session", serialized);
      return json(res, 200, { ok: true, session: serialized });
    }

    if (req.method === "POST" && url.pathname === "/api/pause") {
      const body = await readBody(req);
      const session = await loadSession(body.sessionId || "demo");
      if (hasDatabase && !session.coachId) return json(res, 404, { error: "Session not found." });
      const now = Date.now();
      finalizeTracking(session, now);
      session.status = "paused";
      if (hasDatabase && session.coachId) {
        updateLiveSessionStatus(session.id, { status: session.status, elapsedMs: session.elapsedMs }).catch(() => {});
      }
      recordEvent(session, "pause", now);
      broadcastCoach("session", serializeSession(session));
      return json(res, 200, { ok: true, session: serializeSession(session) });
    }

    if (req.method === "POST" && url.pathname === "/api/stop") {
      const body = await readBody(req);
      const session = await loadSession(body.sessionId || "demo");
      if (hasDatabase && !session.coachId) return json(res, 404, { error: "Session not found." });
      const now = Date.now();
      finalizeTracking(session, now);
      const events = [...(session.events || []), { type: "stop", at: now }].slice(-80);
      const endedSession = serializeSession({
        ...session,
        events,
        status: "stopped",
        lastPoint: session.lastPoint,
        points: [...(session.points || [])],
        cues: [...(session.cues || [])],
        effortSplits: [...(session.effortSplits || [])],
        effortSplit: session.effortSplit ? { ...session.effortSplit, endedAt: now } : null,
      });
      resetSession(session);
      session.events = events;
      if (hasDatabase && session.coachId) {
        updateLiveSessionStatus(session.id, { status: "stopped", elapsedMs: endedSession.elapsedMs }).catch(() => {});
      }
      broadcastCoach("ended-session", endedSession);
      broadcastRunner(session.id, "reset", serializeSession(session));
      return json(res, 200, { ok: true, session: serializeSession(session) });
    }

    if (req.method === "POST" && url.pathname === "/api/cue") {
      if (hasDatabase && !coach) return authRequired(res);
      const body = await readBody(req);
      const session = await getCoachSession(body.sessionId || "demo", coach);
      if (!session) return json(res, 404, { error: "Session not found." });
      const cue = {
        text: String(body.text || "").trim().slice(0, 180),
        at: Date.now(),
      };
      if (!cue.text) return json(res, 400, { error: "Note text is required." });
      session.cues.push(cue);
      if (session.cues.length > 50) session.cues.shift();
      broadcastCoach("session", serializeSession(session));
      return json(res, 200, { ok: true, cue });
    }

    if (req.method === "POST" && url.pathname === "/api/effort-split") {
      if (hasDatabase && !coach) return authRequired(res);
      const body = await readBody(req);
      const session = await getCoachSession(body.sessionId || "demo", coach);
      if (!session) return json(res, 404, { error: "Session not found." });
      const now = Date.now();
      const targetMeters = Number(body.targetMeters || 0);
      const completedSplits = session.effortSplits || [];
      const current = session.effortSplit;
      const canCompleteFromStart = !current && (session.startedAt || session.points[0]?.at);

      if (current || canCompleteFromStart) {
        const startedAt = current?.startedAt || session.startedAt || session.points[0].at;
        const elapsed = current ? effortElapsedMs(current, now) : elapsedMs(session, now);
        completedSplits.push({
          number: current?.number || completedSplits.length + 1,
          startedAt,
          endedAt: now,
          startedPointIndex: current?.startedPointIndex || 0,
          endPointIndex: session.points.length,
          elapsedMs: elapsed,
          targetMeters: Number.isFinite(targetMeters) && targetMeters > 0 ? targetMeters : current?.targetMeters || null,
        });
      }

      session.effortSplits = completedSplits;
      session.effortSplit = {
        number: completedSplits.length + 1,
        startedAt: now,
        startedPointIndex: session.points.length,
        elapsedMs: 0,
        trackingStartedAt: session.status === "live" ? now : null,
        targetMeters: Number.isFinite(targetMeters) && targetMeters > 0 ? targetMeters : null,
      };

      broadcastCoach("session", serializeSession(session));
      return json(res, 200, { ok: true, session: serializeSession(session) });
    }

    if (req.method === "GET" && hasDatabase && isProtectedPage(url.pathname) && !coach) {
      res.writeHead(302, { location: `/login.html?next=${encodeURIComponent(url.pathname + url.search)}` });
      res.end();
      return;
    }

    if (
      req.method === "GET" &&
      hasDatabase &&
      coach &&
      (url.pathname === "/coach" || url.pathname === "/coach.html") &&
      url.searchParams.get("session")
    ) {
      const liveSession = await getLiveSession(url.searchParams.get("session"));
      if (!liveSession || liveSession.coach_id !== coach.id) {
        res.writeHead(302, { location: "/coach" });
        res.end();
        return;
      }
    }

    if (
      req.method === "GET" &&
      hasDatabase &&
      coach &&
      (url.pathname === "/coach" || url.pathname === "/coach.html") &&
      !url.searchParams.get("session")
    ) {
      const session = await createCoachLiveSession(coach);
      res.writeHead(302, { location: `/coach?session=${encodeURIComponent(session.id)}` });
      res.end();
      return;
    }

    const filePath = safeFilePath(url.pathname);
    const data = await readFile(filePath);
    res.writeHead(200, { "content-type": mime[extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      json(res, 404, { error: "Not found" });
      return;
    }
    console.error(error);
    json(res, 500, { error: "Something went wrong." });
  }
});

initDatabase()
  .then(() => {
    server.listen(port, host, () => {
      console.log(`Coach Live Map is running on ${host}:${port}`);
    });
  })
  .catch((error) => {
    console.error("Database startup failed", error);
    process.exitCode = 1;
  });
