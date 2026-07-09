const sessionId = new URLSearchParams(location.search).get("session") || "demo";
const map = createMap("map");
let marker;
let pathLine;
let watchId = null;
let demoTimer = null;
let points = [];
let startedAt = null;
let elapsedMs = 0;
let trackingStartedAt = null;
let isTracking = false;
let isLockingGps = false;
let coachConnected = false;
let gpsRequestId = 0;
let runMode = "free";

const el = {
  name: document.querySelector("#runnerNameInput"),
  start: document.querySelector("#startBtn"),
  trackMode: document.querySelector("#trackModeBtn"),
  pause: document.querySelector("#pauseBtn"),
  stop: document.querySelector("#stopBtn"),
  consent: document.querySelector("#trackingConsent"),
  mapToggle: document.querySelector("#mapToggle"),
  hideMap: document.querySelector("#hideMap"),
  mapPanel: document.querySelector("#runnerMapPanel"),
  runTime: document.querySelector("#runTime"),
  distance: document.querySelector("#distance"),
  splitPace: document.querySelector("#splitPace"),
  modeLabel: document.querySelector("#runnerModeLabel"),
  averagePace: document.querySelector("#averagePace"),
  splitProgress: document.querySelector("#splitProgress"),
  elevation: document.querySelector("#elevation"),
  coachConnection: document.querySelector("#coachConnection"),
  trackingStatus: document.querySelector("#trackingStatus"),
};

function updateStatusBadges() {
  el.coachConnection.textContent = coachConnected ? "Coach connected" : "Coach disconnected";
  el.coachConnection.classList.toggle("is-connected", coachConnected);
  el.trackingStatus.textContent = isLockingGps ? "Locking GPS" : isTracking ? "Tracking" : "Tracking off";
  el.trackingStatus.classList.toggle("is-tracking", isTracking);
  el.start.disabled = !el.consent.checked || isLockingGps;
  el.trackMode.disabled = !el.consent.checked || isLockingGps;
  document.body.classList.toggle("track-mode", runMode === "track");
  el.modeLabel.textContent = runMode === "track" ? "Track mode pace" : "Free run pace";
}

function activeElapsedSeconds() {
  if (isTracking && trackingStartedAt) {
    return (elapsedMs + Date.now() - trackingStartedAt) / 1000;
  }
  return elapsedMs / 1000;
}

function beginLocalTracking(startedAtMs = Date.now()) {
  if (!startedAt) startedAt = startedAtMs;
  if (!trackingStartedAt) trackingStartedAt = startedAtMs;
  isLockingGps = false;
  isTracking = true;
  updateStatusBadges();
}

function freezeLocalTracking() {
  if (isTracking && trackingStartedAt) {
    elapsedMs += Date.now() - trackingStartedAt;
  }
  trackingStartedAt = null;
  isTracking = false;
  isLockingGps = false;
  updateStatusBadges();
}

function updateUi() {
  const stats = sessionStats(points, startedAt, activeElapsedSeconds());
  el.runTime.textContent = formatDuration(activeElapsedSeconds());
  el.distance.textContent = `${stats.miles.toFixed(2)} mi`;
  el.splitPace.textContent = formatPace(stats.splitPace);
  el.averagePace.textContent = formatPace(stats.averagePace);
  el.splitProgress.textContent = `${stats.currentSplitMiles.toFixed(2)}/${stats.splitDistanceMiles} mi`;
  el.elevation.textContent = `${Math.round(stats.elevationFeet)} ft`;
}

function resetLocalSession() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  clearInterval(demoTimer);
  demoTimer = null;
  points = [];
  startedAt = null;
  elapsedMs = 0;
  trackingStartedAt = null;
  isTracking = false;
  isLockingGps = false;
  runMode = "free";
  el.consent.checked = false;
  if (pathLine) pathLine.setLatLngs([]);
  if (marker && map) {
    map.removeLayer(marker);
    marker = null;
  }
  updateStatusBadges();
  updateUi();
}

function setMapVisible(isVisible) {
  el.mapPanel.classList.toggle("is-hidden", !isVisible);
  el.mapToggle.textContent = isVisible ? "Hide map" : "Show map";
  if (isVisible && map) {
    setTimeout(() => map.invalidateSize(), 80);
    const last = points.at(-1);
    if (last) map.setView([last.lat, last.lng], Math.max(map.getZoom(), 16));
  }
}

function drawPoint(point) {
  points.push(point);
  updateUi();
  if (!map) return;
  const latLng = [point.lat, point.lng];
  if (!marker) marker = L.marker(latLng).addTo(map);
  marker.setLatLng(latLng);
  const route = points.map((item) => [item.lat, item.lng]);
  if (!pathLine) {
    pathLine = L.polyline(route, { color: "#0f766e", weight: 5, opacity: 0.9 }).addTo(map);
  } else {
    pathLine.setLatLngs(route);
  }
  map.setView(latLng, Math.max(map.getZoom(), 16), { animate: true });
}

async function sendPoint(point, action = "track") {
  if (action === "track" && !isTracking) return;
  const pointAt = point.at || Date.now();
  beginLocalTracking(pointAt);
  drawPoint(point);
  await fetch("/api/location", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId,
      runnerName: el.name.value.trim() || "Runner",
      action,
      mode: runMode,
      ...point,
    }),
  });
}

function applySessionUpdate(session) {
  if (session?.runnerName && document.activeElement !== el.name) {
    el.name.value = session.runnerName;
  }
  if (session?.mode) {
    runMode = session.mode;
    updateStatusBadges();
  }
}

function pointFromPosition(position) {
  const { latitude, longitude, accuracy, altitude, speed, heading } = position.coords;
  return {
    lat: latitude,
    lng: longitude,
    accuracy,
    altitude,
    speed,
    heading,
    at: Date.now(),
  };
}

function startWatchingGps(requestId) {
  watchId = navigator.geolocation.watchPosition(
    (position) => {
      if (requestId !== gpsRequestId) return;
      sendPoint(pointFromPosition(position), "track");
    },
    () => {
      freezeLocalTracking();
      el.trackingStatus.textContent = "GPS blocked";
      el.trackingStatus.classList.remove("is-tracking");
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
  );
}

function startGps(mode = runMode) {
  if (!el.consent.checked) {
    el.trackingStatus.textContent = "Consent needed";
    el.trackingStatus.classList.remove("is-tracking");
    return;
  }
  if (!navigator.geolocation) {
    el.trackingStatus.textContent = "GPS unavailable";
    return;
  }
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  runMode = mode;
  isLockingGps = true;
  gpsRequestId += 1;
  const requestId = gpsRequestId;
  const action = startedAt ? "resume" : "start";
  updateStatusBadges();
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (requestId !== gpsRequestId) return;
      sendPoint(pointFromPosition(position), action);
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      startWatchingGps(requestId);
    },
    () => {
      isLockingGps = false;
      el.trackingStatus.textContent = "GPS blocked";
      el.trackingStatus.classList.remove("is-tracking");
      updateStatusBadges();
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
  );
}

async function pauseRun() {
  gpsRequestId += 1;
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  clearInterval(demoTimer);
  demoTimer = null;
  freezeLocalTracking();
  await fetch("/api/pause", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
}

async function stopRun() {
  if (!confirm("Are you sure you want to end this session?")) return;
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  clearInterval(demoTimer);
  demoTimer = null;
  freezeLocalTracking();
  await fetch("/api/stop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  resetLocalSession();
}

function startDemo() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  clearInterval(demoTimer);
  demoTimer = null;
  beginLocalTracking();
  const start = { lat: 40.7829, lng: -73.9654, altitude: 24 };
  let step = 0;
  demoTimer = setInterval(() => {
    step += 1;
    sendPoint({
      lat: start.lat + step * 0.00016,
      lng: start.lng + Math.sin(step / 5) * 0.0005,
      accuracy: 8,
      altitude: start.altitude + Math.max(0, step - 8) * 0.8,
      speed: 3.4,
      heading: 20,
    });
  }, 1500);
}

el.start.addEventListener("click", () => startGps("free"));
el.trackMode.addEventListener("click", () => startGps("track"));
el.consent.addEventListener("change", updateStatusBadges);
el.pause.addEventListener("click", pauseRun);
el.stop.addEventListener("click", stopRun);
el.mapToggle.addEventListener("click", () => setMapVisible(el.mapPanel.classList.contains("is-hidden")));
el.hideMap.addEventListener("click", () => setMapVisible(false));

const events = new EventSource(`/api/runner-events/${encodeURIComponent(sessionId)}`);
events.addEventListener("open", () => {
  updateStatusBadges();
});
events.addEventListener("session", (event) => {
  applySessionUpdate(JSON.parse(event.data));
});
events.addEventListener("presence", (event) => {
  const presence = JSON.parse(event.data);
  if (presence.sessionId !== sessionId) return;
  coachConnected = Boolean(presence.coachConnected);
  updateStatusBadges();
});
events.addEventListener("reset", () => {
  resetLocalSession();
});

updateStatusBadges();
updateUi();
setInterval(updateUi, 1000);
