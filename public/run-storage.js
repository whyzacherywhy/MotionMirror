const profilesStorageKey = "coachLive.profiles.v1";
const runDraftPrefix = "coachLive.runDraft.";

function loadLocalProfiles() {
  try {
    return JSON.parse(localStorage.getItem(profilesStorageKey)) || [];
  } catch {
    return [];
  }
}

function saveLocalProfiles(profiles) {
  localStorage.setItem(profilesStorageKey, JSON.stringify(profiles));
}

async function apiJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (response.status === 401) {
    location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    throw new Error("Coach login required");
  }
  if (!response.ok) throw new Error("Database unavailable");
  return response.json();
}

function profileId() {
  return `profile-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function runId() {
  return `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function loadProfiles() {
  try {
    const payload = await apiJson("/api/profiles");
    return payload.profiles || [];
  } catch {
    return loadLocalProfiles();
  }
}

async function createRunnerProfile(name) {
  try {
    const payload = await apiJson("/api/profiles", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    return payload.profile;
  } catch {
    return createLocalRunnerProfile(name);
  }
}

function createLocalRunnerProfile(name) {
  const profiles = loadLocalProfiles();
  const profile = {
    id: profileId(),
    name: (name || "Runner").trim(),
    age: "",
    location: "",
    goals: "",
    coachNotes: "",
    photo: "",
    createdAt: Date.now(),
    runs: [],
  };
  profiles.unshift(profile);
  saveLocalProfiles(profiles);
  return profile;
}

async function findProfile(id) {
  if (!id) return null;
  try {
    const payload = await apiJson(`/api/profiles/${encodeURIComponent(id)}`);
    return payload.profile;
  } catch {
    return loadLocalProfiles().find((profile) => profile.id === id) || null;
  }
}

async function updateRunnerProfile(profileIdValue, updates) {
  try {
    const payload = await apiJson(`/api/profiles/${encodeURIComponent(profileIdValue)}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
    return payload.profile;
  } catch {
    return updateLocalRunnerProfile(profileIdValue, updates);
  }
}

function updateLocalRunnerProfile(profileIdValue, updates) {
  const profiles = loadLocalProfiles();
  const profile = profiles.find((item) => item.id === profileIdValue);
  if (!profile) return null;
  Object.assign(profile, updates, { updatedAt: Date.now() });
  saveLocalProfiles(profiles);
  return profile;
}

async function deleteRunnerProfile(profileIdValue) {
  try {
    await apiJson(`/api/profiles/${encodeURIComponent(profileIdValue)}`, {
      method: "DELETE",
    });
    return true;
  } catch {
    return deleteLocalRunnerProfile(profileIdValue);
  }
}

function deleteLocalRunnerProfile(profileIdValue) {
  const profiles = loadLocalProfiles();
  const nextProfiles = profiles.filter((profile) => profile.id !== profileIdValue);
  if (nextProfiles.length === profiles.length) return false;
  saveLocalProfiles(nextProfiles);
  return true;
}

async function saveRunToProfile(profileIdValue, run) {
  try {
    const payload = await apiJson(`/api/profiles/${encodeURIComponent(profileIdValue)}/runs`, {
      method: "POST",
      body: JSON.stringify({ run }),
    });
    return payload.run;
  } catch {
    return saveLocalRunToProfile(profileIdValue, run);
  }
}

function saveLocalRunToProfile(profileIdValue, run) {
  const profiles = loadLocalProfiles();
  const profile = profiles.find((item) => item.id === profileIdValue);
  if (!profile) return null;
  profile.runs ||= [];
  profile.runs.unshift({
    ...run,
    id: run.id || runId(),
    savedAt: Date.now(),
    notes: run.notes || "",
    receiptNotes: run.receiptNotes || "",
    homework: run.homework || "",
  });
  profile.runs.sort((a, b) => (b.startedAt || b.savedAt || 0) - (a.startedAt || a.savedAt || 0));
  saveLocalProfiles(profiles);
  return profile.runs[0];
}

async function loadRun(profileIdValue, runIdValue) {
  try {
    const payload = await apiJson(
      `/api/profiles/${encodeURIComponent(profileIdValue)}/runs/${encodeURIComponent(runIdValue)}`,
    );
    return payload.run;
  } catch {
    const profile = loadLocalProfiles().find((item) => item.id === profileIdValue);
    return profile?.runs?.find((item) => item.id === runIdValue) || null;
  }
}

async function updateRunNotes(profileIdValue, runIdValue, notes, receiptNotes = "", homework = "") {
  try {
    const payload = await apiJson(
      `/api/profiles/${encodeURIComponent(profileIdValue)}/runs/${encodeURIComponent(runIdValue)}/notes`,
      {
        method: "PATCH",
        body: JSON.stringify({ notes, receiptNotes, homework }),
      },
    );
    return payload.run;
  } catch {
    return updateLocalRunNotes(profileIdValue, runIdValue, notes, receiptNotes, homework);
  }
}

function updateLocalRunNotes(profileIdValue, runIdValue, notes, receiptNotes = "", homework = "") {
  const profiles = loadLocalProfiles();
  const profile = profiles.find((item) => item.id === profileIdValue);
  const run = profile?.runs?.find((item) => item.id === runIdValue);
  if (!run) return null;
  run.notes = notes;
  run.receiptNotes = receiptNotes;
  run.homework = homework;
  run.notesUpdatedAt = Date.now();
  saveLocalProfiles(profiles);
  return run;
}

async function deleteRunFromProfile(profileIdValue, runIdValue) {
  try {
    await apiJson(`/api/profiles/${encodeURIComponent(profileIdValue)}/runs/${encodeURIComponent(runIdValue)}`, {
      method: "DELETE",
    });
    return true;
  } catch {
    return deleteLocalRunFromProfile(profileIdValue, runIdValue);
  }
}

function deleteLocalRunFromProfile(profileIdValue, runIdValue) {
  const profiles = loadLocalProfiles();
  const profile = profiles.find((item) => item.id === profileIdValue);
  if (!profile?.runs) return false;
  const before = profile.runs.length;
  profile.runs = profile.runs.filter((run) => run.id !== runIdValue);
  if (profile.runs.length === before) return false;
  profile.updatedAt = Date.now();
  saveLocalProfiles(profiles);
  return true;
}

function saveRunDraft(sessionId, session) {
  if (!session?.points?.length) return;
  localStorage.setItem(`${runDraftPrefix}${sessionId}`, JSON.stringify(session));
}

function loadRunDraft(sessionId) {
  try {
    return JSON.parse(localStorage.getItem(`${runDraftPrefix}${sessionId}`));
  } catch {
    return null;
  }
}

function fullDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function routeDistanceMeters(points) {
  let meters = 0;
  for (let i = 1; i < points.length; i += 1) {
    meters += usableSegmentMeters(points[i - 1], points[i]);
  }
  return meters;
}

function elevationChangeFeet(points) {
  return elevationGainLossFeet(points);
}

function interpolateRoutePoint(a, b, ratio) {
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

function mileSplits(points) {
  if (points.length < 2) return [];
  const segments = [];
  let mileStart = points[0];
  let mileStartMeters = 0;
  let totalMeters = 0;
  let boundaryMeters = 1609.344;
  let number = 1;

  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    const segmentMeters = usableSegmentMeters(previous, current);
    const beforeMeters = totalMeters;
    const afterMeters = totalMeters + segmentMeters;

    while (segmentMeters > 0 && afterMeters >= boundaryMeters) {
      const ratio = (boundaryMeters - beforeMeters) / segmentMeters;
      const mileEnd = interpolateRoutePoint(previous, current, ratio);
      const seconds = Math.max(0, ((mileEnd.at || 0) - (mileStart.at || 0)) / 1000);
      const elevationFeet =
        Number.isFinite(mileStart.altitude) && Number.isFinite(mileEnd.altitude)
          ? metersToFeet(mileEnd.altitude - mileStart.altitude)
          : null;
      segments.push({
        number,
        label: `Mile ${number}`,
        distanceMeters: 1609.344,
        distanceMiles: 1,
        isPartial: false,
        endedAt: mileEnd.at,
        seconds,
        pace: seconds > 0 ? seconds / 60 : 0,
        elevationFeet,
      });
      mileStart = mileEnd;
      mileStartMeters = boundaryMeters;
      boundaryMeters += 1609.344;
      number += 1;
    }

    totalMeters = afterMeters;
  }

  const finalDistanceMeters = totalMeters - mileStartMeters;
  if (finalDistanceMeters >= 25) {
    const finalPoint = points.at(-1);
    const finalDistanceMiles = metersToMiles(finalDistanceMeters);
    const seconds = Math.max(0, ((finalPoint.at || 0) - (mileStart.at || 0)) / 1000);
    const elevationFeet =
      Number.isFinite(mileStart.altitude) && Number.isFinite(finalPoint.altitude)
        ? metersToFeet(finalPoint.altitude - mileStart.altitude)
        : null;

    segments.push({
      number,
      label: `Final ${finalDistanceMiles.toFixed(2)} mi`,
      distanceMeters: finalDistanceMeters,
      distanceMiles: finalDistanceMiles,
      isPartial: true,
      endedAt: finalPoint.at,
      seconds,
      pace: finalDistanceMiles > 0.02 ? seconds / 60 / finalDistanceMiles : 0,
      elevationFeet,
    });
  }

  return segments;
}

function eventLabelForSummary(type) {
  return (
    {
      start: "Run started",
      resume: "Run resumed",
      pause: "Run paused",
      stop: "Run stopped",
    }[type] || "Run event"
  );
}

function buildHistoryRows(session, summary) {
  const rows = [];
  for (const event of session.events || []) {
    rows.push({ at: event.at, text: eventLabelForSummary(event.type) });
  }
  for (const split of summary.coachSplits) {
    rows.push({
      at: split.endedAt || split.startedAt,
      text: `Coach split ${split.number}: ${formatDuration(split.elapsedSeconds)} · ${split.distanceMiles.toFixed(2)} mi · ${formatPace(split.pace)} · elev ${signedFeet(split.elevationFeet)}`,
    });
  }
  for (const mile of summary.mileSplits) {
    rows.push({
      at: mile.endedAt || session.startedAt,
      text: `${mile.label || `Mile ${mile.number}`}: ${formatDuration(mile.seconds)} · ${formatPace(mile.pace)} · elev ${signedFeet(mile.elevationFeet)}`,
    });
  }
  for (const cue of session.cues || []) {
    rows.push({ at: cue.at, text: `Note: ${cue.text}` });
  }
  return rows.sort((a, b) => a.at - b.at);
}

function splitElevationFeet(points, split) {
  const splitPoints = points.filter((point) => {
    const at = point.at || 0;
    return at >= split.startedAt && (!split.endedAt || at <= split.endedAt);
  });
  const first = splitPoints[0];
  const last = splitPoints.at(-1);
  if (!first || !last) return 0;
  if (!Number.isFinite(first.altitude) || !Number.isFinite(last.altitude)) return null;
  return metersToFeet(last.altitude - first.altitude);
}

function buildRunSummary(session, weather) {
  const points = session.points || [];
  const elapsedSeconds = (session.elapsedMs || 0) / 1000 || Math.max(0, ((points.at(-1)?.at || Date.now()) - (session.startedAt || points[0]?.at || Date.now())) / 1000);
  const stats = sessionStats(points, session.startedAt || points[0]?.at, elapsedSeconds);
  const elevation = elevationChangeFeet(points);
  const splitRecords = [...(session.effortSplits || [])];
  if (session.effortSplit?.startedAt) {
    const activeSplitStats = effortSplitStats(points, session.effortSplit);
    const alreadyCompleted = splitRecords.some((split) => split.number === session.effortSplit.number);
    if (!alreadyCompleted && activeSplitStats.elapsedSeconds > 0) {
      splitRecords.push({
        ...session.effortSplit,
        endedAt: session.effortSplit.endedAt || session.endedAt || points.at(-1)?.at || Date.now(),
      });
    }
  }
  const coachSplits = splitRecords
    .sort((a, b) => a.number - b.number)
    .map((split) => {
      const splitStats = effortSplitStats(points, split);
      return {
        number: split.number,
        startedAt: split.startedAt,
        endedAt: split.endedAt,
        elapsedSeconds: splitStats.elapsedSeconds,
        distanceMeters: splitStats.meters,
        distanceMiles: splitStats.miles,
        pace: splitStats.pace,
        elevationFeet: splitElevationFeet(points, split),
      };
    });
  const miles = mileSplits(points);
  const summary = {
    id: runId(),
    runnerName: session.runnerName || "Runner",
    startedAt: session.startedAt || points[0]?.at || Date.now(),
    endedAt: points.at(-1)?.at || Date.now(),
    dateLabel: fullDate(session.startedAt || points[0]?.at || Date.now()),
    title: `${fullDate(session.startedAt || points[0]?.at || Date.now())} · ${stats.miles.toFixed(2)} mi · ${formatPace(stats.averagePace)}`,
    distanceMiles: stats.miles,
    elapsedSeconds,
    averagePace: stats.averagePace,
    elevationGainFeet: elevation.gain,
    elevationLossFeet: elevation.loss,
    mileSplits: miles,
    coachSplits,
    weather,
    route: points.map((point) => ({
      lat: point.lat,
      lng: point.lng,
      altitude: point.altitude,
      at: point.at,
    })),
    history: [],
    notes: "",
    receiptNotes: "",
    homework: "",
  };
  summary.history = buildHistoryRows(session, summary);
  return summary;
}

function signedFeet(value) {
  if (!Number.isFinite(value)) return "--";
  const rounded = Math.round(value);
  return `${rounded >= 0 ? "+" : "-"}${Math.abs(rounded)} ft`;
}

function weatherCodeLabel(code) {
  const labels = {
    0: "Clear",
    1: "Mostly clear",
    2: "Partly cloudy",
    3: "Cloudy",
    45: "Fog",
    48: "Fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Heavy drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    80: "Rain showers",
    81: "Rain showers",
    82: "Heavy showers",
    95: "Thunderstorm",
  };
  return labels[code] || "Weather logged";
}

async function fetchRunWeather(points) {
  const point = points?.at(-1) || points?.[0];
  if (!point) return { label: "Weather unavailable" };
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", point.lat);
    url.searchParams.set("longitude", point.lng);
    url.searchParams.set("current", "temperature_2m,weather_code,wind_speed_10m");
    url.searchParams.set("temperature_unit", "fahrenheit");
    url.searchParams.set("wind_speed_unit", "mph");
    const response = await fetch(url);
    if (!response.ok) throw new Error("Weather unavailable");
    const data = await response.json();
    const current = data.current || {};
    return {
      label: weatherCodeLabel(current.weather_code),
      temperature: Number.isFinite(current.temperature_2m) ? Math.round(current.temperature_2m) : null,
      windMph: Number.isFinite(current.wind_speed_10m) ? Math.round(current.wind_speed_10m) : null,
      at: current.time || null,
    };
  } catch {
    return { label: "Weather unavailable" };
  }
}
