const params = new URLSearchParams(location.search);

function emptyState(text) {
  const div = document.createElement("div");
  div.className = "empty-state";
  div.textContent = text;
  return div;
}

function renderProfilesPage() {
  const list = document.querySelector("#profilesList");
  if (!list) return;
  const profiles = loadProfiles();
  list.innerHTML = "";

  if (!profiles.length) {
    list.append(emptyState("No runner profiles saved yet."));
  }

  for (const profile of profiles) {
    const latest = profile.runs?.[0];
    const card = document.createElement("a");
    card.className = "profile-card";
    card.href = `/profile.html?id=${encodeURIComponent(profile.id)}`;
    card.innerHTML = `
      <p>${profile.runs?.length || 0} saved runs</p>
      <strong>${profile.name}</strong>
      <span>${latest ? latest.title : "No runs saved yet"}</span>
    `;
    list.append(card);
  }

  document.querySelector("#createProfile")?.addEventListener("click", () => {
    const name = prompt("Runner name");
    if (!name?.trim()) return;
    const profile = createRunnerProfile(name);
    location.href = `/profile.html?id=${encodeURIComponent(profile.id)}`;
  });
}

function renderProfilePage() {
  const runsList = document.querySelector("#runsList");
  if (!runsList) return;
  const profile = findProfile(params.get("id"));
  document.querySelector("#profileName").textContent = profile?.name || "Profile not found";
  runsList.innerHTML = "";

  if (!profile) {
    document.querySelector(".profile-overview")?.remove();
    runsList.append(emptyState("This profile could not be found."));
    return;
  }

  renderProfileOverview(profile);

  if (!profile.runs?.length) {
    runsList.append(emptyState("No runs saved to this profile yet."));
    return;
  }

  for (const run of profile.runs) {
    const row = document.createElement("a");
    row.className = "run-row";
    row.href = `/run.html?profile=${encodeURIComponent(profile.id)}&run=${encodeURIComponent(run.id)}`;
    row.innerHTML = `
      <strong>${run.dateLabel || fullDate(run.startedAt)}</strong>
      <span>${run.distanceMiles.toFixed(2)} mi</span>
      <span>${formatPace(run.averagePace)}</span>
    `;
    runsList.append(row);
  }
}

function renderProfileOverview(profile) {
  const photoPreview = document.querySelector("#profilePhotoPreview");
  const photoInput = document.querySelector("#profilePhotoInput");
  const photoUploadLabel = document.querySelector("#photoUploadLabel");
  const form = document.querySelector("#profileForm");
  const nameInput = document.querySelector("#profileRunnerName");
  const ageInput = document.querySelector("#profileAge");
  const locationInput = document.querySelector("#profileLocation");
  const goalsInput = document.querySelector("#profileGoals");
  const coachNotesInput = document.querySelector("#profileCoachNotes");
  const saveButton = document.querySelector("#saveProfileInfo");
  const profileFields = [nameInput, ageInput, locationInput, goalsInput, coachNotesInput];
  let isEditing = false;

  nameInput.value = profile.name || "";
  ageInput.value = profile.age || "";
  locationInput.value = profile.location || "";
  goalsInput.value = profile.goals || "";
  coachNotesInput.value = profile.coachNotes || "";
  renderProfilePhoto(photoPreview, profile);
  setProfileEditing(false);

  photoInput.addEventListener("change", () => {
    if (!isEditing) return;
    const file = photoInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      updateRunnerProfile(profile.id, { photo: reader.result });
      renderProfilePhoto(photoPreview, { ...profile, photo: reader.result });
    });
    reader.readAsDataURL(file);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!isEditing) {
      setProfileEditing(true);
      nameInput.focus();
      return;
    }
    const updated = updateRunnerProfile(profile.id, {
      name: nameInput.value.trim() || "Runner",
      age: ageInput.value.trim(),
      location: locationInput.value.trim(),
      goals: goalsInput.value.trim(),
      coachNotes: coachNotesInput.value.trim(),
    });
    document.querySelector("#profileName").textContent = updated.name;
    setProfileEditing(false);
    saveButton.textContent = "Saved";
    setTimeout(() => (saveButton.textContent = "Edit profile"), 900);
  });

  function setProfileEditing(nextValue) {
    isEditing = nextValue;
    for (const field of profileFields) {
      field.readOnly = !isEditing;
    }
    photoInput.disabled = !isEditing;
    photoUploadLabel.classList.toggle("is-locked", !isEditing);
    form.classList.toggle("is-editing", isEditing);
    saveButton.textContent = isEditing ? "Save profile" : "Edit profile";
  }
}

function renderProfilePhoto(photoPreview, profile) {
  if (!photoPreview) return;
  photoPreview.innerHTML = "";
  if (profile.photo) {
    const image = document.createElement("img");
    image.src = profile.photo;
    image.alt = `${profile.name || "Runner"} profile photo`;
    photoPreview.append(image);
    return;
  }
  photoPreview.textContent = initialsForProfile(profile.name);
}

function initialsForProfile(name) {
  return (name || "Runner")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function tableRow(cells, isHead = false) {
  const row = document.createElement("div");
  row.className = isHead ? "data-row data-head" : "data-row";
  row.innerHTML = cells.map((cell) => `<span>${cell}</span>`).join("");
  return row;
}

function renderRunPage() {
  const title = document.querySelector("#runTitle");
  if (!title) return;
  const profile = findProfile(params.get("profile"));
  const run = profile?.runs?.find((item) => item.id === params.get("run"));
  document.querySelector("#backToProfile").href = profile
    ? `/profile.html?id=${encodeURIComponent(profile.id)}`
    : "/profiles.html";

  if (!profile || !run) {
    title.textContent = "Run not found";
    return;
  }

  title.textContent = `${profile.name} · ${run.title}`;
  document.querySelector("#summaryTime").textContent = formatDuration(run.elapsedSeconds);
  document.querySelector("#summaryDistance").textContent = `${run.distanceMiles.toFixed(2)} mi`;
  document.querySelector("#summaryPace").textContent = formatPace(run.averagePace);
  document.querySelector("#summaryElevation").textContent =
    `+${Math.round(run.elevationGainFeet)} / -${Math.round(run.elevationLossFeet)} ft`;
  document.querySelector("#summaryWeather").textContent = weatherSummary(run.weather);

  const notes = document.querySelector("#runNotes");
  const notesButton = document.querySelector("#saveNotes");
  let notesEditing = false;
  notes.value = run.notes || "";
  setNotesEditing(false);
  notesButton.addEventListener("click", () => {
    if (!notesEditing) {
      setNotesEditing(true);
      notes.focus();
      return;
    }
    updateRunNotes(profile.id, run.id, notes.value);
    setNotesEditing(false);
    notesButton.textContent = "Saved";
    setTimeout(() => (notesButton.textContent = "Edit notes"), 900);
  });

  function setNotesEditing(nextValue) {
    notesEditing = nextValue;
    notes.readOnly = !notesEditing;
    notes.classList.toggle("is-editing", notesEditing);
    notesButton.textContent = notesEditing ? "Save notes" : "Edit notes";
  }

  renderSavedMap(run);
  renderMileTable(run);
  renderSplitTable(run);
  renderSummaryHistory(run);
}

function weatherSummary(weather) {
  if (!weather || weather.label === "Weather unavailable") return "Unavailable";
  const parts = [weather.label];
  if (Number.isFinite(weather.temperature)) parts.push(`${weather.temperature}F`);
  if (Number.isFinite(weather.windMph)) parts.push(`${weather.windMph} mph wind`);
  return parts.join(" · ");
}

function renderSavedMap(run) {
  if (!window.L || !run.route?.length) return;
  const map = L.map("summaryMap", { zoomControl: false });
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);
  const route = run.route.map((point) => [point.lat, point.lng]);
  const line = L.polyline(route, { color: "#3de0cd", weight: 6, opacity: 0.95 }).addTo(map);
  L.marker(route[0]).addTo(map).bindPopup("Start");
  L.marker(route.at(-1)).addTo(map).bindPopup("Finish");
  map.fitBounds(line.getBounds(), { padding: [28, 28] });
}

function renderMileTable(run) {
  const table = document.querySelector("#mileTable");
  table.append(tableRow(["Segment", "Pace", "Elev"], true));
  if (!run.mileSplits?.length) {
    table.append(tableRow(["--", "No mile data", "--"]));
    return;
  }
  for (const mile of run.mileSplits) {
    table.append(
      tableRow([
        mile.label || `Mile ${mile.number}`,
        formatPace(mile.pace),
        signedFeet(mile.elevationFeet),
      ]),
    );
  }
}

function renderSplitTable(run) {
  const table = document.querySelector("#splitTable");
  table.append(tableRow(["Split", "Pace", "Elev"], true));
  if (!run.coachSplits?.length) {
    table.append(tableRow(["--", "No coach splits", "--"]));
    return;
  }
  for (const split of run.coachSplits) {
    table.append(
      tableRow([
        split.number,
        `${formatPace(split.pace)} · ${split.distanceMiles.toFixed(2)} mi`,
        signedFeet(split.elevationFeet),
      ]),
    );
  }
}

function renderSummaryHistory(run) {
  const list = document.querySelector("#summaryHistory");
  if (!run.history?.length) {
    list.append(emptyState("No history logged."));
    return;
  }
  for (const item of run.history) {
    const row = document.createElement("li");
    row.innerHTML = `<span>${formatTime(item.at)}</span>${item.text}`;
    list.append(row);
  }
}

renderProfilesPage();
renderProfilePage();
renderRunPage();
