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
let coachConnected = false;

const el = {
  name: document.querySelector("#runnerNameInput"),
  start: document.querySelector("#startBtn"),
  pause: document.querySelector("#pauseBtn"),
  stop: document.querySelector("#stopBtn"),
  demo: document.querySelector("#demoBtn"),
  mapToggle: document.querySelector("#mapToggle"),
  hideMap: document.querySelector("#hideMap"),
  mapPanel: document.querySelector("#runnerMapPanel"),
  runTime: document.querySelector("#runTime"),
  distance: document.querySelector("#distance"),
  splitPace: document.querySelector("#splitPace"),
  averagePace: document.querySelector("#averagePace"),
  splitProgress: document.querySelector("#splitProgress"),
  elevation: document.querySelector("#elevation"),
  coachConnection: document.querySelector("#coachConnection"),
  trackingStatus: document.querySelector("#trackingStatus"),
};

function updateStatusBadges() {
  el.coachConnection.textContent = coachConnected ? "Coach connected" : "Coach disconnected";
  el.coachConnection.classList.toggle("is-connected", coachConnected);
  el.trackingStatus.textContent = isTracking ? "Tracking" : "Tracking off";
  el.trackingStatus.classList.toggle("is-tracking", isTracking);
}

function activeElapsedSeconds() {
  if (isTracking && trackingStartedAt) {
    return (elapsedMs + Date.now() - trackingStartedAt) / 1000;
  }
  return elapsedMs / 1000;
}

function beginLocalTracking() {
  if (!startedAt) startedAt = Date.now();
  if (!trackingStartedAt) trackingStartedAt = Date.now();
  isTracking = true;
  updateStatusBadges();
}

function freezeLocalTracking() {
  if (isTracking && trackingStartedAt) {
    elapsedMs += Date.now() - trackingStartedAt;
  }
  trackingStartedAt = null;
  isTracking = false;
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

async function sendPoint(point) {
  beginLocalTracking();
  drawPoint(point);
  await fetch("/api/location", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId,
      runnerName: el.name.value.trim() || "Runner",
      ...point,
    }),
  });
}

function startGps() {
  if (!navigator.geolocation) {
    el.trackingStatus.textContent = "GPS unavailable";
    return;
  }
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  el.trackingStatus.textContent = "Requesting GPS";
  watchId = navigator.geolocation.watchPosition(
    (position) => {
      beginLocalTracking();
      const { latitude, longitude, accuracy, altitude, speed, heading } = position.coords;
      sendPoint({
        lat: latitude,
        lng: longitude,
        accuracy,
        altitude,
        speed,
        heading,
      });
    },
    () => {
      freezeLocalTracking();
      el.trackingStatus.textContent = "GPS blocked";
      el.trackingStatus.classList.remove("is-tracking");
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 },
  );
}

async function pauseRun() {
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

el.start.addEventListener("click", startGps);
el.pause.addEventListener("click", pauseRun);
el.stop.addEventListener("click", stopRun);
el.demo.addEventListener("click", startDemo);
el.mapToggle.addEventListener("click", () => setMapVisible(el.mapPanel.classList.contains("is-hidden")));
el.hideMap.addEventListener("click", () => setMapVisible(false));

const events = new EventSource(`/api/runner-events/${encodeURIComponent(sessionId)}`);
events.addEventListener("open", () => {
  updateStatusBadges();
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
