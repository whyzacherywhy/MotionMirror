const params = new URLSearchParams(location.search);

function emptyState(text) {
  const div = document.createElement("div");
  div.className = "empty-state";
  div.textContent = text;
  return div;
}

async function renderProfilesPage() {
  const list = document.querySelector("#profilesList");
  if (!list) return;
  const profiles = await loadProfiles();
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

  document.querySelector("#createProfile")?.addEventListener("click", async () => {
    const name = prompt("Runner name");
    if (!name?.trim()) return;
    const profile = await createRunnerProfile(name);
    location.href = `/profile.html?id=${encodeURIComponent(profile.id)}`;
  });
}

async function renderProfilePage() {
  const runsList = document.querySelector("#runsList");
  if (!runsList) return;
  const profile = await findProfile(params.get("id"));
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
    const row = document.createElement("div");
    row.className = "run-row";
    row.innerHTML = `
      <a href="/run.html?profile=${encodeURIComponent(profile.id)}&run=${encodeURIComponent(run.id)}">
        <strong>${run.dateLabel || fullDate(run.startedAt)}</strong>
        <span>${run.distanceMiles.toFixed(2)} mi</span>
        <span>${formatPace(run.averagePace)}</span>
      </a>
      <button class="delete-run" type="button" data-run-id="${run.id}">Delete</button>
    `;
    runsList.append(row);
  }

  runsList.querySelectorAll(".delete-run").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("Delete this run entry? This cannot be undone.")) return;
      button.disabled = true;
      const deleted = await deleteRunFromProfile(profile.id, button.dataset.runId);
      if (deleted) {
        button.closest(".run-row")?.remove();
        if (!runsList.querySelector(".run-row")) {
          runsList.append(emptyState("No runs saved to this profile yet."));
        }
      } else {
        button.disabled = false;
        alert("Could not delete this run.");
      }
    });
  });
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
  const deleteButton = document.querySelector("#deleteProfile");
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
    reader.addEventListener("load", async () => {
      await updateRunnerProfile(profile.id, { photo: reader.result });
      renderProfilePhoto(photoPreview, { ...profile, photo: reader.result });
    });
    reader.readAsDataURL(file);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!isEditing) {
      setProfileEditing(true);
      nameInput.focus();
      return;
    }
    const updated = await updateRunnerProfile(profile.id, {
      name: nameInput.value.trim() || "Runner",
      age: ageInput.value.trim(),
      location: locationInput.value.trim(),
      goals: goalsInput.value.trim(),
      coachNotes: coachNotesInput.value.trim(),
    });
    document.querySelector("#profileName").textContent = updated?.name || "Runner";
    setProfileEditing(false);
    saveButton.textContent = "Saved";
    setTimeout(() => (saveButton.textContent = "Edit profile"), 900);
  });

  deleteButton.addEventListener("click", async () => {
    const confirmed = confirm(
      `Delete ${profile.name}? This will delete the profile and all saved runs. This cannot be undone.`,
    );
    if (!confirmed) return;
    deleteButton.disabled = true;
    deleteButton.textContent = "Deleting";
    const deleted = await deleteRunnerProfile(profile.id);
    if (deleted) {
      location.href = "/profiles.html";
      return;
    }
    deleteButton.disabled = false;
    deleteButton.textContent = "Delete profile";
    alert("Could not delete this profile.");
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

async function renderRunPage() {
  const title = document.querySelector("#runTitle");
  if (!title) return;
  const profile = await findProfile(params.get("profile"));
  const run = profile ? await loadRun(profile.id, params.get("run")) : null;
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
  const receiptNotes = document.querySelector("#receiptNotes");
  const receiptHomework = document.querySelector("#receiptTakeaway");
  const receiptNotesButton = document.querySelector("#saveReceiptNotes");
  const receiptHomeworkButton = document.querySelector("#saveReceiptHomework");
  let notesEditing = false;
  notes.value = run.notes || "";
  setNotesEditing(false);
  notesButton.addEventListener("click", async () => {
    if (!notesEditing) {
      setNotesEditing(true);
      notes.focus();
      return;
    }
    await updateRunNotes(profile.id, run.id, notes.value, receiptHomework?.value || run.homework || "");
    run.notes = notes.value;
    run.homework = receiptHomework?.value || run.homework || "";
    if (receiptNotes) receiptNotes.value = run.notes;
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
  setupReceiptDownload(profile, run, {
    notesInput: notes,
    receiptNotes,
    receiptHomework,
    receiptNotesButton,
    receiptHomeworkButton,
  });
}

function setupReceiptDownload(profile, run, fields) {
  const notes = fields.receiptNotes;
  const takeaway = fields.receiptHomework;
  const jpgButton = document.querySelector("#downloadReceiptJpg");
  const pngButton = document.querySelector("#downloadReceiptPng");
  if (!notes || !takeaway || !jpgButton || !pngButton) return;

  notes.value = fields.notesInput.value || run.notes || "";
  takeaway.value = run.homework || "";
  setupSavedTextBox({
    textarea: notes,
    button: fields.receiptNotesButton,
    editLabel: "Edit notes",
    saveLabel: "Save notes",
    onSave: async () => {
      fields.notesInput.value = notes.value;
      run.notes = notes.value;
      await updateRunNotes(profile.id, run.id, notes.value, takeaway.value);
    },
  });
  setupSavedTextBox({
    textarea: takeaway,
    button: fields.receiptHomeworkButton,
    editLabel: "Edit homework",
    saveLabel: "Save homework",
    onSave: async () => {
      run.homework = takeaway.value;
      await updateRunNotes(profile.id, run.id, notes.value, takeaway.value);
    },
  });

  jpgButton.addEventListener("click", () => downloadReceipt(profile, run, notes, takeaway, "jpg"));
  pngButton.addEventListener("click", () => downloadReceipt(profile, run, notes, takeaway, "png"));
}

function setupSavedTextBox({ textarea, button, editLabel, saveLabel, onSave }) {
  if (!textarea || !button) return;
  let editing = false;
  setEditing(false);
  button.addEventListener("click", async () => {
    if (!editing) {
      setEditing(true);
      textarea.focus();
      return;
    }
    await onSave();
    setEditing(false);
    button.textContent = "Saved";
    setTimeout(() => (button.textContent = editLabel), 900);
  });

  function setEditing(nextValue) {
    editing = nextValue;
    textarea.readOnly = !editing;
    textarea.classList.toggle("is-editing", editing);
    button.textContent = editing ? saveLabel : editLabel;
  }
}

let receiptAssetsPromise;
let coachNamePromise;

function loadTransparentImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(transparentReceiptImage(image));
    image.onerror = reject;
    image.src = src;
  });
}

function loadReceiptAssets() {
  receiptAssetsPromise ||= Promise.all([
    loadTransparentImage("/motion-mirror-receipt-ghost-large.png"),
    loadTransparentImage("/motion-mirror-receipt-wordmark.png"),
  ]).then(([ghost, wordmark]) => ({ ghost, wordmark }));
  return receiptAssetsPromise;
}

function loadCoachName() {
  coachNamePromise ||= fetch("/api/auth/me")
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => String(data?.coach?.displayName || "Coach").trim() || "Coach")
    .catch(() => "Coach");
  return coachNamePromise;
}

async function downloadReceipt(profile, run, notes, takeaway, format) {
  if (!notes.value.trim()) {
    alert("Add coach notes/reflection before downloading the receipt.");
    notes.focus();
    return;
  }
  if (!takeaway.value.trim()) {
    alert("Add homework for the runner before downloading the receipt.");
    takeaway.focus();
    return;
  }

  const [receiptAssets, coachName] = await Promise.all([loadReceiptAssets(), loadCoachName()]);
  const canvas = drawReceiptCanvas(profile, run, {
    notes: notes.value.trim(),
    takeaway: takeaway.value.trim(),
    coachName,
  }, receiptAssets);
  const link = document.createElement("a");
  const safeName = (profile.name || "runner").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  link.download = `motion-mirror-${safeName || "runner"}-${run.dateLabel || "receipt"}.${format === "jpg" ? "jpg" : "png"}`;
  link.href = format === "jpg" ? canvas.toDataURL("image/jpeg", 0.82) : canvas.toDataURL("image/png");
  link.click();
}

function transparentReceiptImage(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const red = pixels.data[i];
    const green = pixels.data[i + 1];
    const blue = pixels.data[i + 2];
    if (red > 225 && green > 225 && blue > 225) pixels.data[i + 3] = 0;
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

function drawReceiptCanvas(profile, run, receipt, receiptAssets) {
  const width = 720;
  const draft = document.createElement("canvas");
  draft.width = width;
  draft.height = 6000;
  const ctx = draft.getContext("2d");
  const margin = 54;
  let y = 28;

  ctx.fillStyle = "#fbf5df";
  ctx.fillRect(0, 0, draft.width, draft.height);
  ctx.fillStyle = "#06183a";
  ctx.strokeStyle = "#06183a";
  ctx.lineWidth = 2;
  const ghostSize = 58;
  ctx.drawImage(receiptAssets.ghost, (width - ghostSize) / 2, y, ghostSize, ghostSize);
  y += ghostSize + 8;
  const wordmarkWidth = 560;
  const wordmarkHeight = wordmarkWidth * (receiptAssets.wordmark.height / receiptAssets.wordmark.width);
  ctx.drawImage(receiptAssets.wordmark, (width - wordmarkWidth) / 2, y, wordmarkWidth, wordmarkHeight);
  y += wordmarkHeight + 8;
  ctx.font = "900 20px Courier New, monospace";
  ctx.textAlign = "center";
  ctx.fillText(`COACHED BY ${String(receipt.coachName || "COACH").toUpperCase()}`, width / 2, y + 20);
  y += 30;
  y = receiptDivider(ctx, y, width, margin);

  ctx.textAlign = "left";
  y = receiptLine(ctx, "RUNNER", profile.name || "Runner", y, margin);
  y = receiptLine(ctx, "DATE", run.dateLabel || fullDate(run.startedAt), y, margin);
  y = receiptLine(ctx, "TIME", formatTime(run.startedAt), y, margin);
  y = receiptLine(ctx, "DISTANCE", `${run.distanceMiles.toFixed(2)} mi`, y, margin);
  y = receiptLine(ctx, "TOTAL TIME", formatDuration(run.elapsedSeconds), y, margin);
  y = receiptLine(ctx, "AVG PACE", formatPace(run.averagePace), y, margin);
  y = receiptLine(
    ctx,
    "ELEVATION",
    `+${Math.round(run.elevationGainFeet)} / -${Math.round(run.elevationLossFeet)} ft`,
    y,
    margin,
  );
  y = receiptDivider(ctx, y, width, margin);

  y = receiptHeading(ctx, "ROUTE MAP", y, margin);
  y = receiptRoute(ctx, run.route || [], y, margin, width - margin * 2);
  y = receiptDivider(ctx, y, width, margin);

  y = receiptHeading(ctx, "MILE SPLITS", y, margin);
  y = receiptSplits(ctx, run.mileSplits || [], y, margin, (mile) => [
    mile.label || `Mile ${mile.number}`,
    `${formatDuration(mile.seconds)} / ${formatPace(mile.pace)} / ${signedFeet(mile.elevationFeet)}`,
  ]);
  y = receiptDivider(ctx, y, width, margin);

  y = receiptHeading(ctx, "COACH SPLITS", y, margin);
  y = receiptSplits(ctx, run.coachSplits || [], y, margin, (split) => [
    `Split ${split.number}`,
    `${formatDuration(split.elapsedSeconds)} / ${split.distanceMiles.toFixed(2)} mi / ${formatPace(split.pace)}`,
  ]);
  y = receiptDivider(ctx, y, width, margin);

  y = receiptBlock(ctx, "COACH NOTES / REFLECTION", receipt.notes, y, margin, width);
  y = receiptDivider(ctx, y, width, margin);
  y = receiptBlock(ctx, "HOMEWORK FOR RUNNER", receipt.takeaway, y, margin, width);

  y = receiptCheckerboard(ctx, y + 22, width, margin);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.min(y, draft.height);
  canvas.getContext("2d").drawImage(draft, 0, 0);
  return canvas;
}

function receiptDivider(ctx, y, width, margin) {
  ctx.font = "700 24px Courier New, monospace";
  ctx.textAlign = "left";
  ctx.fillText("-".repeat(43), margin, y + 28);
  return y + 54;
}

function receiptCheckerboard(ctx, y, width, margin) {
  const square = 18;
  const rows = 2;
  const columns = Math.floor((width - margin * 2) / square);
  const startX = margin + ((width - margin * 2) - columns * square) / 2;
  ctx.save();
  ctx.fillStyle = "#06183a";
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if ((row + column) % 2 === 0) ctx.fillRect(startX + column * square, y + row * square, square, square);
    }
  }
  ctx.restore();
  return y + rows * square + 34;
}

function receiptLine(ctx, label, value, y, margin) {
  ctx.font = "700 26px Courier New, monospace";
  ctx.textAlign = "left";
  ctx.fillText(label, margin, y);
  ctx.textAlign = "right";
  ctx.fillText(String(value || "--"), 720 - margin, y);
  return y + 38;
}

function receiptHeading(ctx, text, y, margin) {
  ctx.font = "900 30px Courier New, monospace";
  ctx.textAlign = "left";
  ctx.fillText(text, margin, y);
  return y + 38;
}

function receiptRoute(ctx, route, y, margin, mapWidth) {
  const pad = 14;
  let mapHeight = 180;
  if (route.length < 2) {
    ctx.strokeRect(margin, y, mapWidth, mapHeight);
    ctx.font = "700 24px Courier New, monospace";
    ctx.textAlign = "center";
    ctx.fillText("NO ROUTE", margin + mapWidth / 2, y + mapHeight / 2);
    ctx.textAlign = "left";
    return y + mapHeight + 26;
  }

  const meanLat = route.reduce((sum, point) => sum + point.lat, 0) / route.length;
  const metersPerLng = 111320 * Math.cos((meanLat * Math.PI) / 180);
  const projected = route.map((point) => ({
    x: point.lng * metersPerLng,
    y: point.lat * 110540,
  }));
  const minMapHeight = 160;
  const maxDrawableWidth = mapWidth - pad * 2;

  function rotatePoints(points, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return points.map((point) => ({
      x: point.x * cos - point.y * sin,
      y: point.x * sin + point.y * cos,
    }));
  }

  function boundsFor(points) {
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return {
      minX,
      maxX,
      minY,
      maxY,
      width: maxX - minX || 1,
      height: maxY - minY || 1,
    };
  }

  let best = null;
  for (let degrees = -89; degrees <= 89; degrees += 1) {
    const angle = (degrees * Math.PI) / 180;
    const rotated = rotatePoints(projected, angle);
    const bounds = boundsFor(rotated);
    const height = bounds.height * (maxDrawableWidth / bounds.width) + pad * 2;
    if (!best || height < best.height) best = { angle, rotated, bounds, height };
  }

  const rotated = best.rotated;
  const { minX, maxX, minY, maxY, width: routeWidthMeters, height: routeHeightMeters } = best.bounds;
  mapHeight = Math.max(minMapHeight, best.height);

  ctx.strokeRect(margin, y, mapWidth, mapHeight);

  const scale = Math.min((mapWidth - pad * 2) / routeWidthMeters, (mapHeight - pad * 2) / routeHeightMeters);
  const routeWidth = routeWidthMeters * scale;
  const routeHeight = routeHeightMeters * scale;
  const xOffset = margin + (mapWidth - routeWidth) / 2;
  const yOffset = y + (mapHeight - routeHeight) / 2;

  function mapPoint(point) {
    return {
      x: xOffset + (point.x - minX) * scale,
      y: yOffset + (maxY - point.y) * scale,
    };
  }

  ctx.beginPath();
  rotated.forEach((point, index) => {
    const routePoint = mapPoint(point);
    if (index === 0) ctx.moveTo(routePoint.x, routePoint.y);
    else ctx.lineTo(routePoint.x, routePoint.y);
  });
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.lineWidth = 2;
  const start = mapPoint(rotated[0]);
  const finish = mapPoint(rotated.at(-1));
  ctx.fillStyle = "#fbf5df";
  ctx.beginPath();
  ctx.arc(start.x, start.y, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(start.x, start.y, 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(finish.x, finish.y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#06183a";
  ctx.beginPath();
  ctx.arc(finish.x, finish.y, 7, 0, Math.PI * 2);
  ctx.fill();
  drawReceiptCompass(ctx, margin + mapWidth - 28, y + mapHeight - 28, best.angle);
  ctx.textAlign = "left";
  return y + mapHeight + 30;
}

function drawReceiptCompass(ctx, x, y, routeRotation) {
  const northVector = {
    x: -Math.sin(routeRotation),
    y: -Math.cos(routeRotation),
  };
  const northAngle = Math.atan2(northVector.y, northVector.x);

  function point(angle, distance) {
    return {
      x: x + Math.cos(angle) * distance,
      y: y + Math.sin(angle) * distance,
    };
  }

  function drawShape(points, fill) {
    ctx.beginPath();
    points.forEach((shapePoint, index) => {
      if (index === 0) ctx.moveTo(shapePoint.x, shapePoint.y);
      else ctx.lineTo(shapePoint.x, shapePoint.y);
    });
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.stroke();
  }

  const rightAngle = northAngle + Math.PI / 2;
  const southAngle = northAngle + Math.PI;
  const westAngle = northAngle - Math.PI / 2;
  const northLong = 21;
  const sideLong = 17;
  const southLong = 19;
  const shortLong = 10;
  const center = { x, y };
  const white = "#fbf5df";
  const ink = "#06183a";

  ctx.save();
  ctx.lineJoin = "miter";
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = white;
  [
    [center, point(northAngle - 0.13, northLong), point(northAngle, northLong + 3), point(northAngle + 0.13, northLong)],
    [center, point(rightAngle - 0.12, sideLong), point(rightAngle, sideLong + 8), point(rightAngle + 0.12, sideLong)],
    [center, point(southAngle - 0.12, southLong), point(southAngle, southLong + 3), point(southAngle + 0.12, southLong)],
    [center, point(westAngle - 0.12, sideLong), point(westAngle, sideLong + 8), point(westAngle + 0.12, sideLong)],
    [center, point(northAngle + Math.PI / 4 - 0.17, shortLong), point(northAngle + Math.PI / 4, shortLong + 3), point(northAngle + Math.PI / 4 + 0.17, shortLong)],
    [center, point(northAngle + (Math.PI * 3) / 4 - 0.17, shortLong), point(northAngle + (Math.PI * 3) / 4, shortLong + 3), point(northAngle + (Math.PI * 3) / 4 + 0.17, shortLong)],
    [center, point(northAngle - Math.PI / 4 - 0.17, shortLong), point(northAngle - Math.PI / 4, shortLong + 3), point(northAngle - Math.PI / 4 + 0.17, shortLong)],
    [center, point(northAngle - (Math.PI * 3) / 4 - 0.17, shortLong), point(northAngle - (Math.PI * 3) / 4, shortLong + 3), point(northAngle - (Math.PI * 3) / 4 + 0.17, shortLong)],
  ].forEach((shape) => drawShape(shape, white));

  ctx.lineWidth = 1.2;
  ctx.strokeStyle = ink;
  drawShape([center, point(northAngle - 0.13, northLong), point(northAngle, northLong + 3), point(northAngle + 0.13, northLong)], ink);
  drawShape([center, point(rightAngle - 0.12, sideLong), point(rightAngle, sideLong + 8), point(rightAngle + 0.12, sideLong)], white);
  drawShape([center, point(southAngle - 0.12, southLong), point(southAngle, southLong + 3), point(southAngle + 0.12, southLong)], white);
  drawShape([center, point(westAngle - 0.12, sideLong), point(westAngle, sideLong + 8), point(westAngle + 0.12, sideLong)], white);
  drawShape([center, point(northAngle + Math.PI / 4 - 0.17, shortLong), point(northAngle + Math.PI / 4, shortLong + 3), point(northAngle + Math.PI / 4 + 0.17, shortLong)], white);
  drawShape([center, point(northAngle + (Math.PI * 3) / 4 - 0.17, shortLong), point(northAngle + (Math.PI * 3) / 4, shortLong + 3), point(northAngle + (Math.PI * 3) / 4 + 0.17, shortLong)], white);
  drawShape([center, point(northAngle - Math.PI / 4 - 0.17, shortLong), point(northAngle - Math.PI / 4, shortLong + 3), point(northAngle - Math.PI / 4 + 0.17, shortLong)], white);
  drawShape([center, point(northAngle - (Math.PI * 3) / 4 - 0.17, shortLong), point(northAngle - (Math.PI * 3) / 4, shortLong + 3), point(northAngle - (Math.PI * 3) / 4 + 0.17, shortLong)], white);
  ctx.restore();
}

function receiptSplits(ctx, rows, y, margin, mapper) {
  if (!rows.length) {
    ctx.font = "700 24px Courier New, monospace";
    ctx.fillText("No data logged", margin, y);
    return y + 36;
  }
  for (const row of rows) {
    const [label, value] = mapper(row);
    y = receiptLine(ctx, label, value, y, margin);
  }
  return y;
}

function receiptBlock(ctx, heading, text, y, margin, width) {
  y = receiptHeading(ctx, heading, y, margin);
  ctx.font = "700 24px Courier New, monospace";
  ctx.textAlign = "left";
  const lines = wrapReceiptText(ctx, text, width - margin * 2);
  for (const line of lines) {
    ctx.fillText(line, margin, y);
    y += 31;
  }
  return y;
}

function wrapReceiptText(ctx, text, maxWidth) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ["--"];
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
