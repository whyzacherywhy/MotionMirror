const routePoints = [
  { lat: 40.7812, lng: -73.9665, altitude: 58 },
  { lat: 40.7817, lng: -73.9659, altitude: 62 },
  { lat: 40.7824, lng: -73.9652, altitude: 69 },
  { lat: 40.7831, lng: -73.9647, altitude: 77 },
  { lat: 40.7839, lng: -73.9643, altitude: 91 },
  { lat: 40.7847, lng: -73.9639, altitude: 104 },
  { lat: 40.7856, lng: -73.9636, altitude: 116 },
  { lat: 40.7863, lng: -73.9632, altitude: 121 },
  { lat: 40.7869, lng: -73.9628, altitude: 118 },
  { lat: 40.7875, lng: -73.9621, altitude: 110 },
  { lat: 40.7881, lng: -73.9614, altitude: 102 },
  { lat: 40.7887, lng: -73.9608, altitude: 96 },
];

const el = {
  splitPace: document.querySelector("#splitPace"),
  splitProgress: document.querySelector("#splitProgress"),
  averagePace: document.querySelector("#averagePace"),
  distance: document.querySelector("#distance"),
  elevation: document.querySelector("#elevation"),
  grade: document.querySelector("#grade"),
  accuracy: document.querySelector("#accuracy"),
  updatedAt: document.querySelector("#updatedAt"),
  mileOne: document.querySelector("#mileOne"),
  currentSplit: document.querySelector("#currentSplit"),
  currentGain: document.querySelector("#currentGain"),
  latestCue: document.querySelector("#latestCue"),
  mapReadout: document.querySelector("#mapReadout"),
  heading: document.querySelector("#heading"),
  layerName: document.querySelector("#layerName"),
  timeline: document.querySelector("#timeline"),
  startDemo: document.querySelector("#startDemo"),
  pauseDemo: document.querySelector("#pauseDemo"),
  resetDemo: document.querySelector("#resetDemo"),
  streetLayer: document.querySelector("#streetLayer"),
  terrainLayer: document.querySelector("#terrainLayer"),
};

const map = L.map("map", { zoomControl: false }).setView([40.7849, -73.964], 16);
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

const completedRoute = L.polyline([], {
  color: "#3de0cd",
  weight: 6,
  opacity: 0.95,
}).addTo(map);

const plannedRoute = L.polyline(
  routePoints.map((point) => [point.lat, point.lng]),
  {
    color: "#8d9ba6",
    weight: 3,
    opacity: 0.58,
    dashArray: "8 10",
  },
).addTo(map);

const runnerIcon = L.divIcon({
  className: "",
  html: '<div class="runner-marker"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

let marker = L.marker([routePoints[0].lat, routePoints[0].lng], { icon: runnerIcon }).addTo(map);
let timer = null;
let index = 0;
let startedAt = null;
let points = [];

function interpolate(a, b, ratio) {
  return {
    lat: a.lat + (b.lat - a.lat) * ratio,
    lng: a.lng + (b.lng - a.lng) * ratio,
    altitude: a.altitude + (b.altitude - a.altitude) * ratio,
  };
}

function buildPoint() {
  const segment = Math.min(routePoints.length - 2, Math.floor(index / 4));
  const ratio = (index % 4) / 4;
  const point = interpolate(routePoints[segment], routePoints[segment + 1], ratio);
  return {
    ...point,
    accuracy: 7 + Math.sin(index / 3) * 2,
    heading: Math.round(35 + Math.sin(index / 4) * 18),
    speed: null,
    at: Date.now(),
  };
}

function addTimeline(text) {
  const item = document.createElement("li");
  const seconds = Math.floor(((Date.now() - startedAt) || 0) / 1000);
  item.innerHTML = `<span>${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}</span>${text}`;
  el.timeline.prepend(item);
  while (el.timeline.children.length > 5) el.timeline.lastElementChild.remove();
}

function updateStats() {
  const stats = sessionStats(points, startedAt);
  const last = points.at(-1);
  const firstAltitude = points[0]?.altitude ?? last?.altitude ?? 0;
  const currentGain = Math.max(0, (last?.altitude ?? 0) - firstAltitude);
  const previous = points.at(-2);
  const grade =
    previous && last
      ? (((last.altitude - previous.altitude) / Math.max(1, distanceMeters(previous, last))) * 100).toFixed(1)
      : "--";

  el.splitPace.textContent = formatPace(stats.splitPace);
  el.splitProgress.textContent = `Mile ${stats.splitNumber} · ${stats.currentSplitMiles.toFixed(2)}/1 mi`;
  el.averagePace.textContent = formatPace(stats.averagePace);
  el.distance.textContent = `${stats.miles.toFixed(2)} mi`;
  el.elevation.textContent = `${Math.round(stats.elevationFeet)} ft`;
  el.grade.textContent = `grade ${grade === "--" ? "--" : `${grade}%`}`;
  el.accuracy.textContent = last ? `${Math.round(metersToFeet(last.accuracy))} ft` : "-- ft";
  el.updatedAt.textContent = last ? formatTime(last.at) : "waiting";
  el.mileOne.textContent = stats.miles >= 1 ? "7:41" : "building";
  el.currentSplit.textContent = formatPace(stats.splitPace);
  el.currentGain.textContent = `+${Math.round(metersToFeet(currentGain))} ft`;
  el.heading.textContent = last?.heading ? `${last.heading} deg` : "--";
  el.mapReadout.textContent = last
    ? `${stats.miles.toFixed(2)} mi · ${formatPace(stats.splitPace)} split · ${Math.round(metersToFeet(last.accuracy))} ft GPS`
    : "Waiting for runner";
}

function drawPoint(point) {
  points.push(point);
  completedRoute.setLatLngs(points.map((item) => [item.lat, item.lng]));
  marker.setLatLng([point.lat, point.lng]);
  map.panTo([point.lat, point.lng], { animate: true });
  updateStats();
}

function tick() {
  if (!startedAt) {
    startedAt = Date.now() - 1000;
    points = [];
    el.timeline.innerHTML = "<li><span>0:00</span>Run started</li>";
  }

  drawPoint(buildPoint());
  index += 1;

  if (index === 5) addTimeline("Entering north climb");
  if (index === 12) {
    el.latestCue.textContent = "Hold effort until the crest.";
    addTimeline("Cue sent: hold effort");
  }
  if (index === 24) addTimeline("Approaching turn");

  if (index >= (routePoints.length - 1) * 4) {
    clearInterval(timer);
    timer = null;
    addTimeline("Demo route complete");
  }
}

function startDemo() {
  if (timer) return;
  timer = setInterval(tick, 1200);
  tick();
}

function pauseDemo() {
  clearInterval(timer);
  timer = null;
}

function resetDemo() {
  pauseDemo();
  index = 0;
  startedAt = null;
  points = [];
  completedRoute.setLatLngs([]);
  marker.setLatLng([routePoints[0].lat, routePoints[0].lng]);
  map.setView([40.7849, -73.964], 16);
  el.timeline.innerHTML = "<li><span>00:00</span>Run started</li>";
  updateStats();
}

function setLayer(layer) {
  if (layer === "terrain") {
    map.removeLayer(streetLayer);
    terrainLayer.addTo(map);
    el.terrainLayer.classList.add("active");
    el.streetLayer.classList.remove("active");
    el.layerName.textContent = "Terrain";
  } else {
    map.removeLayer(terrainLayer);
    streetLayer.addTo(map);
    el.streetLayer.classList.add("active");
    el.terrainLayer.classList.remove("active");
    el.layerName.textContent = "Street";
  }
  plannedRoute.bringToFront();
  completedRoute.bringToFront();
  marker.setZIndexOffset(1000);
}

document.querySelectorAll("[data-cue]").forEach((button) => {
  button.addEventListener("click", () => {
    el.latestCue.textContent = button.dataset.cue;
    if (startedAt) addTimeline(`Cue sent: ${button.textContent}`);
  });
});

el.startDemo.addEventListener("click", startDemo);
el.pauseDemo.addEventListener("click", pauseDemo);
el.resetDemo.addEventListener("click", resetDemo);
el.streetLayer.addEventListener("click", () => setLayer("street"));
el.terrainLayer.addEventListener("click", () => setLayer("terrain"));

resetDemo();
setTimeout(startDemo, 600);
