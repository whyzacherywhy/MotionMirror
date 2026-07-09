const sessionId = new URLSearchParams(location.search).get("session") || "demo";
const map = L.map("map", { zoomControl: false }).setView([40.7128, -74.006], 14);
L.control.zoom({ position: "bottomright" }).addTo(map);

const streetLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap",
});

const terrainLayer = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
  maxZoom: 17,
  attribution: "Map data: &copy; OpenStreetMap, SRTM | Style: &copy; OpenTopoMap",
});

streetLayer.addTo(map);

const runnerIcon = L.divIcon({
  className: "",
  html: '<div class="runner-marker"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

let marker;
let pathLine;
let activeSession = { id: sessionId, points: [], cues: [], status: "idle" };
let lastSaveableSession = loadRunDraft(sessionId);
let selectedTrackMeters = 200;
let holdEndedSession = false;

const el = {
  runnerName: document.querySelector("#runnerName"),
  runnerNameForm: document.querySelector("#runnerNameForm"),
  runnerNameEdit: document.querySelector("#runnerNameEdit"),
  runnerAvatar: document.querySelector("#runnerAvatar"),
  statusPill: document.querySelector("#statusPill"),
  connectionState: document.querySelector("#connectionState"),
  trackingState: document.querySelector("#trackingState"),
  runnerPresence: document.querySelector("#runnerPresence"),
  runTime: document.querySelector("#runTime"),
  distance: document.querySelector("#distance"),
  splitPace: document.querySelector("#splitPace"),
  averagePace: document.querySelector("#averagePace"),
  splitProgress: document.querySelector("#splitProgress"),
  elevation: document.querySelector("#elevation"),
  grade: document.querySelector("#grade"),
  accuracy: document.querySelector("#accuracy"),
  updatedAt: document.querySelector("#updatedAt"),
  currentSplit: document.querySelector("#currentSplit"),
  currentGain: document.querySelector("#currentGain"),
  effortTitle: document.querySelector("#effortTitle"),
  effortPace: document.querySelector("#effortPace"),
  effortDistance: document.querySelector("#effortDistance"),
  effortMeters: document.querySelector("#effortMeters"),
  effortElapsed: document.querySelector("#effortElapsed"),
  startEffortSplit: document.querySelector("#startEffortSplit"),
  trackRepControl: document.querySelector("#trackRepControl"),
  latestCue: document.querySelector("#latestCue"),
  cueForm: document.querySelector("#cueForm"),
  cueInput: document.querySelector("#cueInput"),
  cueLog: document.querySelector("#cueLog"),
  runnerLink: document.querySelector("#runnerLink"),
  copyLink: document.querySelector("#copyLink"),
  newSession: document.querySelector("#newSession"),
  saveRun: document.querySelector("#saveRun"),
  saveModal: document.querySelector("#saveModal"),
  closeSaveModal: document.querySelector("#closeSaveModal"),
  newProfileName: document.querySelector("#newProfileName"),
  saveNewProfile: document.querySelector("#saveNewProfile"),
  existingProfile: document.querySelector("#existingProfile"),
  saveExistingProfile: document.querySelector("#saveExistingProfile"),
  saveStatus: document.querySelector("#saveStatus"),
  mapReadout: document.querySelector("#mapReadout"),
  heading: document.querySelector("#heading"),
  streetLayer: document.querySelector("#streetLayer"),
  terrainLayer: document.querySelector("#terrainLayer"),
};

const runnerUrl = `${location.origin}/runner?session=${encodeURIComponent(sessionId)}`;
el.runnerLink.href = runnerUrl;

function isTrackingFresh(session) {
  if (session.status !== "live" || !session.lastPoint?.at) return false;
  return Date.now() - session.lastPoint.at < 15000;
}

function updateConnectionUi(session) {
  const runnerConnected = Boolean(session.presence?.runnerConnected || session.runnerConnections > 0);
  const tracking = isTrackingFresh(session);

  el.connectionState.textContent = runnerConnected ? "Runner connected" : "Runner disconnected";
  el.connectionState.classList.toggle("is-connected", runnerConnected);
  el.runnerPresence.textContent = runnerConnected ? "Connected" : "Disconnected";

  el.trackingState.textContent = tracking ? "Tracking" : "Tracking off";
  el.trackingState.classList.toggle("is-tracking", tracking);
}

function syncRunnerNameInput(name) {
  if (document.activeElement === el.runnerNameEdit) return;
  el.runnerNameEdit.value = name === "Runner" ? "" : name;
}

function compassDirection(degrees) {
  if (!Number.isFinite(degrees)) return "--";
  const directions = [
    "North",
    "North east",
    "East",
    "South east",
    "South",
    "South west",
    "West",
    "North west",
  ];
  const normalized = ((degrees % 360) + 360) % 360;
  return directions[Math.round(normalized / 45) % directions.length];
}

function clearMap() {
  if (pathLine) {
    map.removeLayer(pathLine);
    pathLine = null;
  }
  if (marker) {
    map.removeLayer(marker);
    marker = null;
  }
}

function sessionElapsedSeconds(session) {
  if (!session.startedAt) return 0;
  const baseSeconds = (session.elapsedMs || 0) / 1000;
  if (session.status === "live" && session.receivedAt) {
    return baseSeconds + (Date.now() - session.receivedAt) / 1000;
  }
  return baseSeconds;
}

function activeCoachSplit(session) {
  if (session.effortSplit) return session.effortSplit;
  const startedAt = session.startedAt || session.points?.[0]?.at;
  if (!startedAt) return null;
  return {
    number: (session.effortSplits || []).length + 1,
    startedAt,
    startedPointIndex: 0,
    elapsedMs: session.elapsedMs || 0,
    trackingStartedAt: session.status === "live" && session.trackingStartedAt ? session.trackingStartedAt : null,
  };
}

function liveCoachSplit(session) {
  const split = activeCoachSplit(session);
  if (!split) return null;
  if (session.status === "live" && split.trackingStartedAt && session.receivedAt) {
    return {
      ...split,
      elapsedMs: (split.elapsedMs || 0) + Date.now() - session.receivedAt,
    };
  }
  return split;
}

function snapshotForSave(session) {
  const snapshot = JSON.parse(JSON.stringify(session));
  snapshot.elapsedMs = Math.round(sessionElapsedSeconds(session) * 1000);
  const split = displayedCoachSplit(session);
  snapshot.effortSplit = split ? { ...split, elapsedMs: Math.round(split.elapsedMs || 0) } : null;
  delete snapshot.receivedAt;
  return snapshot;
}

function displayedCoachSplit(session) {
  const split = liveCoachSplit(session);
  if (!split) return null;
  if (session.mode !== "track") return split;
  return {
    ...split,
    targetMeters: Number(split.targetMeters || selectedTrackMeters),
  };
}

function initials(name) {
  return (name || "R")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function recentGrade(points) {
  const last = points.at(-1);
  const previous = points.at(-2);
  if (!last || !previous) return "--";
  if (!Number.isFinite(last.altitude) || !Number.isFinite(previous.altitude)) return "--";
  return (((last.altitude - previous.altitude) / Math.max(1, usableSegmentMeters(previous, last))) * 100).toFixed(1);
}

function currentGainFeet(points) {
  return elevationGainLossFeet(points).gain;
}

function interpolatePoint(a, b, ratio) {
  return {
    lat: a.lat + (b.lat - a.lat) * ratio,
    lng: a.lng + (b.lng - a.lng) * ratio,
    altitude:
      Number.isFinite(a.altitude) && Number.isFinite(b.altitude)
        ? a.altitude + (b.altitude - a.altitude) * ratio
        : null,
    at: (a.at || 0) + ((b.at || a.at || 0) - (a.at || 0)) * ratio,
  };
}

function splitMileSegments(points) {
  if (points.length < 2) return [];

  const segments = [];
  let mileStart = points[0];
  let totalMeters = 0;
  let nextBoundary = 1609.344;
  let mileNumber = 1;

  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    const segmentMeters = usableSegmentMeters(previous, current);
    const beforeMeters = totalMeters;
    const afterMeters = totalMeters + segmentMeters;

    while (segmentMeters > 0 && afterMeters >= nextBoundary) {
      const ratio = (nextBoundary - beforeMeters) / segmentMeters;
      const mileEnd = interpolatePoint(previous, current, ratio);
      segments.push({
        number: mileNumber,
        start: mileStart,
        end: mileEnd,
        seconds: Math.max(0, ((mileEnd.at || 0) - (mileStart.at || 0)) / 1000),
        elevationFeet:
          Number.isFinite(mileStart.altitude) && Number.isFinite(mileEnd.altitude)
            ? metersToFeet(mileEnd.altitude - mileStart.altitude)
            : null,
      });
      mileStart = mileEnd;
      mileNumber += 1;
      nextBoundary += 1609.344;
    }

    totalMeters = afterMeters;
  }

  return segments;
}

function elevationLabel(feet) {
  if (!Number.isFinite(feet)) return "elev --";
  const rounded = Math.round(feet);
  return `elev ${rounded >= 0 ? "+" : ""}${rounded} ft`;
}

function effortElevationFeet(points, effortSplit) {
  if (!effortSplit?.startedAt) return null;
  const splitPoints = points.filter((point) => {
    const at = point.at || 0;
    return at >= effortSplit.startedAt && (!effortSplit.endedAt || at <= effortSplit.endedAt);
  });
  const first = splitPoints[0];
  const last = splitPoints.at(-1);
  if (!first || !last) return 0;
  if (!Number.isFinite(first.altitude) || !Number.isFinite(last.altitude)) return null;
  return metersToFeet(last.altitude - first.altitude);
}

function escapeHtml(value) {
  const span = document.createElement("span");
  span.textContent = value;
  return span.innerHTML;
}

function eventLabel(type) {
  return (
    {
      start: "Run started",
      resume: "Run resumed",
      pause: "Run paused",
      stop: "Run stopped",
    }[type] || "Run event"
  );
}

function renderHistory(session, points, effort) {
  const items = [];

  for (const event of session.events || []) {
    items.push({
      at: event.at,
      html: `<span>${formatTime(event.at)}</span>${eventLabel(event.type)}`,
    });
  }

  for (const split of session.effortSplits || []) {
    const splitStats = effortSplitStats(points, split);
    items.push({
      at: split.endedAt || split.startedAt,
      html: `<span>${formatTime(split.endedAt || split.startedAt)}</span>Coach split ${split.number}: ${formatDuration(splitStats.elapsedSeconds)} · ${splitStats.miles.toFixed(2)} mi · ${formatPace(splitStats.pace)} · ${elevationLabel(effortElevationFeet(points, split))}`,
    });
  }

  for (const mile of splitMileSegments(points)) {
    items.push({
      at: mile.end.at,
      html: `<span>${formatTime(mile.end.at)}</span>Mile ${mile.number}: ${formatDuration(mile.seconds)} · ${elevationLabel(mile.elevationFeet)}`,
    });
  }

  for (const cue of session.cues || []) {
    items.push({
      at: cue.at,
      html: `<span>${formatTime(cue.at)}</span>Note: ${escapeHtml(cue.text)}`,
    });
  }

  items.sort((a, b) => b.at - a.at);
  el.cueLog.innerHTML = "";
  for (const item of items.slice(0, 80)) {
    const row = document.createElement("li");
    row.innerHTML = item.html;
    el.cueLog.append(row);
  }
}

function drawSession(session) {
  holdEndedSession = session.status === "stopped";
  activeSession = { ...session, receivedAt: Date.now() };
  document.body.classList.toggle("track-mode", session.mode === "track");
  el.trackRepControl.hidden = session.mode !== "track";
  const points = session.points || [];
  if (points.length > 1 && session.startedAt) {
    lastSaveableSession = snapshotForSave(activeSession);
    saveRunDraft(sessionId, lastSaveableSession);
  }
  const elapsedSeconds = sessionElapsedSeconds(activeSession);
  const stats = sessionStats(points, session.startedAt, elapsedSeconds);
  const currentCoachSplit = displayedCoachSplit(activeSession);
  const effort = effortSplitStats(points, currentCoachSplit);
  const last = session.lastPoint;
  const grade = recentGrade(points);
  const name = session.runnerName || "Runner";

  updateConnectionUi(session);
  el.runnerName.textContent = name;
  syncRunnerNameInput(name);
  el.runnerAvatar.textContent = initials(name);
  el.statusPill.textContent = session.status === "live" ? "LIVE" : (session.status || "IDLE").toUpperCase();
  el.runTime.textContent = formatDuration(elapsedSeconds);
  el.distance.textContent = stats.miles.toFixed(2);
  el.splitPace.textContent = formatPace(stats.splitPace);
  el.averagePace.textContent = formatPace(stats.averagePace);
  el.splitProgress.textContent = `Mile ${stats.splitNumber} · ${stats.currentSplitMiles.toFixed(2)}/${stats.splitDistanceMiles} mi`;
  el.elevation.textContent = `+${Math.round(stats.elevationGainFeet)} / -${Math.round(stats.elevationLossFeet)} ft`;
  el.grade.textContent = `grade ${grade === "--" ? "--" : `${grade}%`}`;
  el.accuracy.textContent = last?.accuracy ? `${Math.round(metersToFeet(last.accuracy))} ft` : "-- ft";
  el.updatedAt.textContent = last ? formatTime(last.at) : "waiting";
  el.currentSplit.textContent = formatPace(stats.splitPace);
  el.currentGain.textContent = `+${Math.round(currentGainFeet(points))} ft`;
  el.effortTitle.textContent = currentCoachSplit
    ? `Split ${currentCoachSplit.number} measuring`
    : "Waiting for runner";
  el.effortPace.textContent = formatPace(effort.pace);
  el.effortDistance.textContent = `${effort.miles.toFixed(2)} mi`;
  el.effortMeters.textContent = `${Math.round(effort.meters)} m`;
  el.effortElapsed.textContent = formatDuration(effort.elapsedSeconds);
  el.heading.textContent = compassDirection(Number(last?.heading));
  el.mapReadout.textContent = last
    ? `${stats.miles.toFixed(2)} mi · ${formatPace(stats.splitPace)} mile split · ${formatPace(effort.pace)} coach split`
    : "Waiting for runner";

  const latestCue = session.cues?.at(-1);
  el.latestCue.textContent = latestCue?.text || "No notes yet";

  renderHistory(session, points, effort);

  if (!last) {
    clearMap();
    return;
  }
  const latLng = [last.lat, last.lng];
  if (!marker) {
    marker = L.marker(latLng, { icon: runnerIcon }).addTo(map);
  } else {
    marker.setLatLng(latLng);
  }
  marker.setZIndexOffset(1000);
  marker.bindPopup(`${name}<br>${formatPace(stats.splitPace)} split`);

  const route = points.map((point) => [point.lat, point.lng]);
  if (!pathLine) {
    pathLine = L.polyline(route, { color: "#3de0cd", weight: 6, opacity: 0.95 }).addTo(map);
  } else {
    pathLine.setLatLngs(route);
  }
  pathLine.bringToFront();

  map.setView(latLng, Math.max(map.getZoom(), 15), { animate: true });
}

async function sendCue(text) {
  const response = await fetch("/api/cue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, text }),
  });
  if (!response.ok) throw new Error("Note failed");
}

async function updateRunnerName(event) {
  event.preventDefault();
  const runnerName = el.runnerNameEdit.value.trim();
  if (!runnerName) return;

  const response = await fetch("/api/runner-name", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, runnerName }),
  });
  if (!response.ok) return;

  const payload = await response.json();
  drawSession(payload.session);
}

async function startEffortSplit() {
  const response = await fetch("/api/effort-split", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId,
      targetMeters: activeSession.mode === "track" ? selectedTrackMeters : null,
    }),
  });
  if (!response.ok) throw new Error("Effort split failed");
}

async function populateProfileSelect() {
  const profiles = await loadProfiles();
  el.existingProfile.innerHTML = "";
  if (!profiles.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No profiles yet";
    el.existingProfile.append(option);
    el.saveExistingProfile.disabled = true;
    return;
  }
  el.saveExistingProfile.disabled = false;
  for (const profile of profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name;
    el.existingProfile.append(option);
  }
}

async function openSaveModal() {
  if (activeSession?.points?.length) {
    lastSaveableSession = snapshotForSave(activeSession);
    saveRunDraft(sessionId, lastSaveableSession);
  }
  lastSaveableSession ||= loadRunDraft(sessionId);
  if (!lastSaveableSession?.points?.length) {
    el.saveStatus.textContent = "No route data has been recorded yet.";
  } else {
    el.saveStatus.textContent = "Run data will include route, splits, history, elevation, weather, and notes.";
  }
  el.newProfileName.value = lastSaveableSession?.runnerName || "";
  await populateProfileSelect();
  el.saveModal.hidden = false;
}

function closeSaveModal() {
  el.saveModal.hidden = true;
}

async function createSavedRun() {
  if (activeSession?.points?.length) {
    lastSaveableSession = snapshotForSave(activeSession);
    saveRunDraft(sessionId, lastSaveableSession);
  }
  const session = lastSaveableSession || loadRunDraft(sessionId);
  if (!session?.points?.length) throw new Error("No run data to save yet.");
  el.saveStatus.textContent = "Saving route and weather...";
  const weather = await fetchRunWeather(session.points || []);
  return buildRunSummary(session, weather);
}

async function saveCurrentRunToNewProfile() {
  try {
    const name = el.newProfileName.value.trim();
    if (!name) {
      el.saveStatus.textContent = "Add a runner name first.";
      return;
    }
    const run = await createSavedRun();
    const profile = await createRunnerProfile(name);
    const saved = await saveRunToProfile(profile.id, run);
    location.href = `/run.html?profile=${encodeURIComponent(profile.id)}&run=${encodeURIComponent(saved.id)}`;
  } catch (error) {
    el.saveStatus.textContent = error.message;
  }
}

async function saveCurrentRunToExistingProfile() {
  try {
    const profileId = el.existingProfile.value;
    if (!profileId) {
      el.saveStatus.textContent = "Choose an existing profile first.";
      return;
    }
    const run = await createSavedRun();
    const saved = await saveRunToProfile(profileId, run);
    location.href = `/run.html?profile=${encodeURIComponent(profileId)}&run=${encodeURIComponent(saved.id)}`;
  } catch (error) {
    el.saveStatus.textContent = error.message;
  }
}

function setLayer(layer) {
  if (layer === "terrain") {
    map.removeLayer(streetLayer);
    terrainLayer.addTo(map);
    el.terrainLayer.classList.add("active");
    el.streetLayer.classList.remove("active");
  } else {
    map.removeLayer(terrainLayer);
    streetLayer.addTo(map);
    el.streetLayer.classList.add("active");
    el.terrainLayer.classList.remove("active");
  }
  pathLine?.bringToFront();
  marker?.setZIndexOffset(1000);
}

el.cueForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = el.cueInput.value.trim();
  if (!text) return;
  await sendCue(text);
  el.cueInput.value = "";
});

el.runnerNameForm.addEventListener("submit", updateRunnerName);
el.startEffortSplit.addEventListener("click", startEffortSplit);
document.querySelectorAll("[data-track-meters]").forEach((button) => {
  button.addEventListener("click", () => {
    selectedTrackMeters = Number(button.dataset.trackMeters);
    document.querySelectorAll("[data-track-meters]").forEach((item) => item.classList.toggle("active", item === button));
  });
  button.classList.toggle("active", Number(button.dataset.trackMeters) === selectedTrackMeters);
});
el.saveRun.addEventListener("click", openSaveModal);
el.closeSaveModal.addEventListener("click", closeSaveModal);
el.saveModal.addEventListener("click", (event) => {
  if (event.target === el.saveModal) closeSaveModal();
});
el.saveNewProfile.addEventListener("click", saveCurrentRunToNewProfile);
el.saveExistingProfile.addEventListener("click", saveCurrentRunToExistingProfile);
el.streetLayer.addEventListener("click", () => setLayer("street"));
el.terrainLayer.addEventListener("click", () => setLayer("terrain"));

el.copyLink.addEventListener("click", async () => {
  await navigator.clipboard.writeText(runnerUrl);
  el.copyLink.textContent = "Copied";
  setTimeout(() => (el.copyLink.textContent = "Copy"), 1200);
});

el.newSession.addEventListener("click", async () => {
  el.newSession.disabled = true;
  el.newSession.textContent = "Creating";
  const response = await fetch("/api/live-sessions", { method: "POST" });
  if (!response.ok) {
    el.newSession.disabled = false;
    el.newSession.textContent = "New session";
    return;
  }
  const payload = await response.json();
  location.href = payload.coachUrl;
});

fetch("/api/sessions")
  .then((response) => response.json())
  .then((sessions) => drawSession(sessions.find((session) => session.id === sessionId) || activeSession));

setInterval(() => {
  fetch("/api/sessions")
    .then((response) => response.json())
    .then((sessions) => {
      const session = sessions.find((item) => item.id === sessionId);
      if (holdEndedSession) return;
      if (session) drawSession(session);
    })
    .catch(() => {});
}, 3000);

setInterval(() => {
  if (!activeSession) return;
  const elapsedSeconds = sessionElapsedSeconds(activeSession);
  el.runTime.textContent = formatDuration(elapsedSeconds);
  const liveEffortSplit = displayedCoachSplit(activeSession);
  const effort = effortSplitStats(activeSession.points || [], liveEffortSplit);
  const stats = sessionStats(activeSession.points || [], activeSession.startedAt, elapsedSeconds);
  el.distance.textContent = stats.miles.toFixed(2);
  el.averagePace.textContent = formatPace(stats.averagePace);
  el.elevation.textContent = `+${Math.round(stats.elevationGainFeet)} / -${Math.round(stats.elevationLossFeet)} ft`;
  el.effortElapsed.textContent = formatDuration(effort.elapsedSeconds);
  el.effortMeters.textContent = `${Math.round(effort.meters)} m`;
  el.effortDistance.textContent = `${effort.miles.toFixed(2)} mi`;
  el.effortPace.textContent = formatPace(effort.pace);
  el.effortTitle.textContent = liveEffortSplit ? `Split ${liveEffortSplit.number} measuring` : "Waiting for runner";
  if (activeSession.points?.length > 1 && activeSession.startedAt) {
    lastSaveableSession = snapshotForSave(activeSession);
    saveRunDraft(sessionId, lastSaveableSession);
  }
  renderHistory({ ...activeSession, effortSplit: liveEffortSplit }, activeSession.points || [], effort);
  updateConnectionUi(activeSession);
}, 1000);

const events = new EventSource(`/api/events?sessionId=${encodeURIComponent(sessionId)}`);
events.addEventListener("snapshot", (event) => {
  const sessions = JSON.parse(event.data);
  drawSession(sessions.find((session) => session.id === sessionId) || activeSession);
});
events.addEventListener("session", (event) => {
  const session = JSON.parse(event.data);
  if (session.id === sessionId) drawSession(session);
});
events.addEventListener("ended-session", (event) => {
  const session = JSON.parse(event.data);
  if (session.id !== sessionId) return;
  lastSaveableSession = snapshotForSave({ ...session, receivedAt: Date.now() });
  saveRunDraft(sessionId, lastSaveableSession);
  drawSession(session);
});
events.addEventListener("presence", (event) => {
  const presence = JSON.parse(event.data);
  if (presence.sessionId !== sessionId) return;
  activeSession = {
    ...activeSession,
    presence,
  };
  updateConnectionUi(activeSession);
});
