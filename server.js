import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./public", import.meta.url));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";

const sessions = new Map();
const coachStreams = new Set();
const runnerStreams = new Map();

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
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
    runnerName: previous.runnerName || "Runner",
    startedAt: null,
    lastPoint: null,
    points: [],
    cues: [],
    events: [],
    effortSplit: null,
    effortSplits: [],
    coachConnections: previous.coachConnections || 0,
    runnerConnections: previous.runnerConnections || 0,
    elapsedMs: 0,
    trackingStartedAt: null,
    status: "idle",
  };
}

function resetSession(session) {
  const fresh = createSession(session.id, session);
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

function snapshot() {
  return [...sessions.values()].map((session) => ({
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

function safeFilePath(urlPath) {
  const requested = urlPath === "/" ? "/index.html" : urlPath;
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
    if (req.method === "GET" && url.pathname === "/api/sessions") {
      return json(res, 200, snapshot());
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      const sessionId = url.searchParams.get("sessionId");
      const session = sessionId ? getSession(sessionId) : null;
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
      sendSse(res, "snapshot", snapshot());
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
      const session = getSession(sessionId);
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
      const session = getSession(body.sessionId || "demo");
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

      const previousStatus = session.status;
      const isFirstPoint = !session.startedAt;

      session.runnerName = body.runnerName || session.runnerName;
      session.startedAt ||= point.at;
      if (isFirstPoint) {
        session.events = [];
        recordEvent(session, "start", point.at);
      } else if (previousStatus === "paused") {
        recordEvent(session, "resume", point.at);
      }
      startTracking(session, point.at);
      session.lastPoint = point;
      session.points.push(point);
      if (session.points.length > 2000) session.points.shift();

      broadcastCoach("session", serializeSession(session));
      return json(res, 200, { ok: true, session: serializeSession(session) });
    }

    if (req.method === "POST" && url.pathname === "/api/pause") {
      const body = await readBody(req);
      const session = getSession(body.sessionId || "demo");
      const now = Date.now();
      finalizeTracking(session, now);
      session.status = "paused";
      recordEvent(session, "pause", now);
      broadcastCoach("session", serializeSession(session));
      return json(res, 200, { ok: true, session: serializeSession(session) });
    }

    if (req.method === "POST" && url.pathname === "/api/stop") {
      const body = await readBody(req);
      const session = getSession(body.sessionId || "demo");
      const now = Date.now();
      finalizeTracking(session, now);
      const events = [...(session.events || []), { type: "stop", at: now }].slice(-80);
      resetSession(session);
      session.events = events;
      broadcastCoach("session", serializeSession(session));
      broadcastRunner(session.id, "reset", serializeSession(session));
      return json(res, 200, { ok: true, session: serializeSession(session) });
    }

    if (req.method === "POST" && url.pathname === "/api/cue") {
      const body = await readBody(req);
      const session = getSession(body.sessionId || "demo");
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
      const body = await readBody(req);
      const session = getSession(body.sessionId || "demo");
      const now = Date.now();
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
        });
      }

      session.effortSplits = completedSplits;
      session.effortSplit = {
        number: completedSplits.length + 1,
        startedAt: now,
        startedPointIndex: session.points.length,
        elapsedMs: 0,
        trackingStartedAt: session.status === "live" ? now : null,
      };

      broadcastCoach("session", serializeSession(session));
      return json(res, 200, { ok: true, session: serializeSession(session) });
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

server.listen(port, host, () => {
  console.log(`Coach Live Map is running on ${host}:${port}`);
});
