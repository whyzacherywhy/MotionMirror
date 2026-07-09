const metersToMiles = (meters) => meters / 1609.344;
const metersToFeet = (meters) => meters * 3.28084;
const splitDistanceMiles = 1;
const maxReliableAccuracyMeters = 65;
const maxRunningSpeedMetersPerSecond = 8.5;
const minElevationChangeFeet = 3;

function distanceMeters(a, b) {
  const earth = 6371000;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.asin(Math.sqrt(h));
}

function segmentSeconds(a, b) {
  return Math.max(0, ((b?.at || 0) - (a?.at || 0)) / 1000);
}

function usableSegmentMeters(a, b) {
  const meters = distanceMeters(a, b);
  if (!Number.isFinite(meters) || meters < 1) return 0;

  const seconds = segmentSeconds(a, b);
  if (seconds <= 0) return 0;

  const accuracy = Math.max(Number(a.accuracy || 0), Number(b.accuracy || 0));
  const speed = meters / Math.max(1, seconds);

  if (accuracy > maxReliableAccuracyMeters && meters < accuracy) return 0;
  if (speed > maxRunningSpeedMetersPerSecond && meters > 25) return 0;

  return meters;
}

function usableElevationDeltaMeters(a, b) {
  if (!Number.isFinite(a?.altitude) || !Number.isFinite(b?.altitude)) return 0;
  if (usableSegmentMeters(a, b) <= 0) return 0;

  const deltaMeters = b.altitude - a.altitude;
  if (Math.abs(metersToFeet(deltaMeters)) < minElevationChangeFeet) return 0;

  return deltaMeters;
}

function elevationGainLossFeet(points) {
  let gainMeters = 0;
  let lossMeters = 0;

  for (let i = 1; i < points.length; i += 1) {
    const delta = usableElevationDeltaMeters(points[i - 1], points[i]);
    if (delta > 0) gainMeters += delta;
    else if (delta < 0) lossMeters += Math.abs(delta);
  }

  return {
    gain: metersToFeet(gainMeters),
    loss: metersToFeet(lossMeters),
  };
}

function sessionStats(points, startedAt, elapsedSeconds) {
  let meters = 0;
  let splitStartAt = startedAt || points[0]?.at || 0;
  let currentSplitMiles = 0;
  let nextSplitBoundaryMeters = 1609.344;

  for (let i = 1; i < points.length; i += 1) {
    const segmentMeters = usableSegmentMeters(points[i - 1], points[i]);
    const beforeMeters = meters;
    const afterMeters = meters + segmentMeters;

    while (afterMeters >= nextSplitBoundaryMeters && segmentMeters > 0) {
      const segmentRatio = (nextSplitBoundaryMeters - beforeMeters) / segmentMeters;
      const segmentStart = points[i - 1].at || splitStartAt;
      const segmentEnd = points[i].at || segmentStart;
      splitStartAt = segmentStart + (segmentEnd - segmentStart) * segmentRatio;
      nextSplitBoundaryMeters += splitDistanceMiles * 1609.344;
    }

    meters = afterMeters;
  }

  const elevation = elevationGainLossFeet(points);
  const referenceTime =
    Number.isFinite(elapsedSeconds) && startedAt
      ? startedAt + elapsedSeconds * 1000
      : points.at(-1)?.at || Date.now();
  const elapsedMinutes = Number.isFinite(elapsedSeconds)
    ? Math.max(0.01, elapsedSeconds / 60)
    : startedAt
      ? Math.max(0.01, (referenceTime - startedAt) / 60000)
      : 0;
  const miles = metersToMiles(meters);
  const averagePace = miles > 0.02 ? elapsedMinutes / miles : 0;
  currentSplitMiles = miles % splitDistanceMiles;
  if (miles > 0 && currentSplitMiles === 0) currentSplitMiles = splitDistanceMiles;
  const splitElapsedMinutes = splitStartAt
    ? Math.max(0.01, (referenceTime - splitStartAt) / 60000)
    : 0;
  const splitPace = currentSplitMiles > 0.02 ? splitElapsedMinutes / currentSplitMiles : 0;

  return {
    meters,
    miles,
    elevationFeet: elevation.gain,
    elevationGainFeet: elevation.gain,
    elevationLossFeet: elevation.loss,
    averagePace,
    splitDistanceMiles,
    currentSplitMiles,
    splitNumber: Math.floor(miles / splitDistanceMiles) + 1,
    splitPace,
  };
}

function effortSplitStats(points, effortSplit) {
  if (!effortSplit?.startedAt) {
    return {
      meters: 0,
      miles: 0,
      pace: 0,
      elapsedSeconds: 0,
    };
  }

  const splitPoints = points.filter((point) => {
    const at = point.at || 0;
    return at >= effortSplit.startedAt && (!effortSplit.endedAt || at <= effortSplit.endedAt);
  });
  let meters = 0;

  for (let i = 1; i < splitPoints.length; i += 1) {
    meters += usableSegmentMeters(splitPoints[i - 1], splitPoints[i]);
  }

  const elapsedSeconds = Math.max(
    0,
    Number.isFinite(effortSplit.elapsedMs)
      ? effortSplit.elapsedMs / 1000
      : (Date.now() - effortSplit.startedAt) / 1000,
  );
  const elapsedMinutes = Math.max(0.01, elapsedSeconds / 60);
  const miles = metersToMiles(meters);

  return {
    meters,
    miles,
    pace: miles > 0.02 ? elapsedMinutes / miles : 0,
    elapsedSeconds,
  };
}

function formatPace(minutesPerMile) {
  if (!minutesPerMile || !Number.isFinite(minutesPerMile)) return "--";
  const minutes = Math.floor(minutesPerMile);
  const seconds = Math.round((minutesPerMile - minutes) * 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}/mi`;
}

function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatDuration(seconds) {
  const totalSeconds = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function createMap(elementId) {
  if (!window.L) return null;
  const map = L.map(elementId, { zoomControl: false }).setView([40.7128, -74.006], 14);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);
  return map;
}
