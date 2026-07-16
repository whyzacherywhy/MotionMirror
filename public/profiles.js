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
    await updateRunNotes(profile.id, run.id, notes.value, run.receiptNotes || "", receiptHomework?.value || run.homework || "");
    run.notes = notes.value;
    run.homework = receiptHomework?.value || run.homework || "";
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
  drawSummaryElevationChart(run.route || []);
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
  setupShareDownload(profile, run);
}

function setupReceiptDownload(profile, run, fields) {
  const notes = fields.receiptNotes;
  const takeaway = fields.receiptHomework;
  const jpgButton = document.querySelector("#downloadReceiptJpg");
  const pngButton = document.querySelector("#downloadReceiptPng");
  if (!notes || !takeaway || !jpgButton || !pngButton) return;

  notes.value = run.receiptNotes || "";
  takeaway.value = run.homework || "";
  setupSavedTextBox({
    textarea: notes,
    button: fields.receiptNotesButton,
    editLabel: "Edit notes",
    saveLabel: "Save notes",
    onSave: async () => {
      run.receiptNotes = notes.value;
      await updateRunNotes(profile.id, run.id, fields.notesInput.value, notes.value, takeaway.value);
    },
  });
  setupSavedTextBox({
    textarea: takeaway,
    button: fields.receiptHomeworkButton,
    editLabel: "Edit next steps",
    saveLabel: "Save next steps",
    onSave: async () => {
      run.homework = takeaway.value;
      await updateRunNotes(profile.id, run.id, fields.notesInput.value, notes.value, takeaway.value);
    },
  });

  jpgButton.addEventListener("click", () => downloadReceipt(profile, run, notes, takeaway, "jpg"));
  pngButton.addEventListener("click", () => downloadReceipt(profile, run, notes, takeaway, "png"));
}

function setupShareDownload(profile, run) {
  const button = document.querySelector("#downloadSharePng");
  if (!button) return;
  button.addEventListener("click", () => downloadSharePng(profile, run));
}

async function downloadSharePng(profile, run) {
  const canvas = drawShareCanvas(run, await loadShareAssets());
  const link = document.createElement("a");
  const safeName = (profile.name || "runner").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  link.download = `motion-mirror-share-${safeName || "runner"}-${run.dateLabel || "run"}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function drawShareCanvas(run, assets) {
  const width = 1080;
  const height = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const ink = "#ffffff";
  const accent = "#3de0cd";

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = ink;
  ctx.strokeStyle = accent;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  drawShareRoute(ctx, run.route || [], 90, 80, width - 180, 700, accent);

  ctx.textAlign = "center";
  ctx.fillStyle = ink;
  const wordmarkWidth = 660;
  const wordmarkHeight = wordmarkWidth * (assets.wordmark.height / assets.wordmark.width);
  drawWhiteImage(ctx, assets.wordmark, (width - wordmarkWidth) / 2, 765, wordmarkWidth, wordmarkHeight);

  const stats = [
    ["Distance", `${run.distanceMiles.toFixed(2)} mi`],
    ["Pace", formatPace(run.averagePace)],
    ["Time", formatDuration(run.elapsedSeconds)],
  ];
  const columnWidth = width / stats.length;
  stats.forEach(([label, value], index) => {
    const x = columnWidth * index + columnWidth / 2;
    ctx.font = "900 32px Helvetica, Arial, sans-serif";
    ctx.fillText(label, x, 1010);
    ctx.font = "900 58px Helvetica, Arial, sans-serif";
    ctx.fillText(value, x, 1080);
  });
  const ghostSize = 92;
  drawWhiteImage(ctx, assets.ghost, (width - ghostSize) / 2, 1140, ghostSize, ghostSize);

  return canvas;
}

function drawWhiteImage(ctx, image, x, y, width, height) {
  const tinted = document.createElement("canvas");
  tinted.width = Math.max(1, Math.round(width));
  tinted.height = Math.max(1, Math.round(height));
  const tintedCtx = tinted.getContext("2d");
  tintedCtx.drawImage(image, 0, 0, tinted.width, tinted.height);
  tintedCtx.globalCompositeOperation = "source-in";
  tintedCtx.fillStyle = "#ffffff";
  tintedCtx.fillRect(0, 0, tinted.width, tinted.height);
  ctx.drawImage(tinted, x, y, width, height);
}

function drawShareRoute(ctx, route, x, y, width, height, color) {
  if (route.length < 2) {
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.font = "900 44px Helvetica, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("NO ROUTE", x + width / 2, y + height / 2);
    ctx.restore();
    return;
  }

  const points = fittedRoutePoints(route, x, y, width, height, { rotate: true, pad: 18 });
  const smoothPoints = smoothReceiptRoute(points);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 16;
  ctx.beginPath();
  smoothPoints.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();

  const start = points[0];
  const finish = points.at(-1);
  ctx.fillStyle = "rgba(0, 0, 0, 0)";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(start.x, start.y, 16, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(finish.x, finish.y, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
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
let shareAssetsPromise;
const receiptQuoteStorageKey = "motionMirror.lastReceiptQuote";
const receiptQuotes = [
  { text: "This is living.", weight: 4 },
  { text: "What a gift.", weight: 4 },
  "Keep it going.",
  "One more mile.",
  "Forward.",
  "Keep showing up.",
  "Keep exploring.",
  "Keep moving.",
  "Trust the process.",
  "Stay curious.",
  "The work is working.",
  "Stay the course.",
  "Onward.",
  "Every run matters.",
  "Tiny steps. Big miles.",
  "Momentum builds.",
  "You were here.",
  "Another story told.",
  "Adventure awaits.",
  "Breathe. Then go.",
  "Find your rhythm.",
  "The trail remembers.",
  "Strong looks different every day.",
  "Keep chasing tomorrow.",
  "Motion creates momentum.",
  "Run with intention.",
  "One foot. Then another.",
  "The miles add up.",
  "You belong here.",
  "The next run starts now.",
  "Progress loves patience.",
  "Consistency wins.",
  "Never waste good legs.",
  "Your future self noticed.",
  "This wasn't luck.",
  "The quiet work counts.",
  "Keep the promise.",
  "The path continues.",
  "North is waiting.",
  "Every finish becomes a start.",
  "Nothing changes if nothing changes.",
  "Take the long way home.",
  "One run closer.",
  "The mirror remembers.",
];

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

function loadShareAssets() {
  shareAssetsPromise ||= Promise.all([
    loadTransparentImage("/motion-mirror-share-ghost.png"),
    loadTransparentImage("/motion-mirror-receipt-wordmark.png"),
  ]).then(([ghost, wordmark]) => ({ ghost, wordmark }));
  return shareAssetsPromise;
}

function loadCoachName() {
  coachNamePromise ||= fetch("/api/auth/me")
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => String(data?.coach?.displayName || "Coach").trim() || "Coach")
    .catch(() => "Coach");
  return coachNamePromise;
}

function randomReceiptQuote() {
  let lastQuote = "";
  try {
    lastQuote = localStorage.getItem(receiptQuoteStorageKey) || "";
  } catch {
    lastQuote = "";
  }
  const choices = receiptQuotes
    .map((entry) => (typeof entry === "string" ? { text: entry, weight: 1 } : entry))
    .filter((entry) => receiptQuotes.length <= 1 || entry.text !== lastQuote);
  const totalWeight = choices.reduce((sum, entry) => sum + (entry.weight || 1), 0);
  let target = Math.random() * totalWeight;
  let quote = choices[0]?.text || "Forward.";
  for (const entry of choices) {
    target -= entry.weight || 1;
    if (target <= 0) {
      quote = entry.text;
      break;
    }
  }
  try {
    localStorage.setItem(receiptQuoteStorageKey, quote);
  } catch {
    // Ignore private browsing/storage failures; the quote can still render.
  }
  return quote;
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
    quote: randomReceiptQuote(),
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
  y = receiptCheckerboard(ctx, y, width, margin, 34);

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

  y = receiptHeading(ctx, "ROUTE", y, margin);
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
    split.label || `Split ${split.number}`,
    `${formatDuration(split.elapsedSeconds)} / ${split.distanceMiles.toFixed(2)} mi / ${formatPace(split.pace)}`,
  ]);
  y = receiptDivider(ctx, y, width, margin);

  y = receiptBlock(ctx, "COACH NOTES", receipt.notes, y, margin, width);
  y = receiptDivider(ctx, y, width, margin);
  y = receiptBlock(ctx, "NEXT STEPS", receipt.takeaway, y, margin, width);

  y = receiptCheckerboard(ctx, y + 10, width, margin);
  y = receiptQuote(ctx, receipt.quote, y + 36, width);

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

function receiptCheckerboard(ctx, y, width, margin, bottomGap = 34) {
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
  return y + rows * square + bottomGap;
}

function receiptQuote(ctx, quote, y, width) {
  ctx.save();
  ctx.fillStyle = "#000000";
  ctx.font = "700 18px Courier New, monospace";
  ctx.textAlign = "center";
  ctx.fillText(String(quote || "Forward."), width / 2, y);
  ctx.restore();
  return y + 32;
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

  const routePoints = smoothReceiptRoute(rotated.map(mapPoint));
  ctx.beginPath();
  routePoints.forEach((routePoint, index) => {
    if (index === 0) ctx.moveTo(routePoint.x, routePoint.y);
    else ctx.lineTo(routePoint.x, routePoint.y);
  });
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
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
  ctx.textAlign = "left";
  return y + mapHeight + 30;
}

function fittedRoutePoints(route, x, y, width, height, options = {}) {
  const pad = options.pad ?? 14;
  const meanLat = route.reduce((sum, point) => sum + point.lat, 0) / route.length;
  const metersPerLng = 111320 * Math.cos((meanLat * Math.PI) / 180);
  const projected = route.map((point) => ({
    x: point.lng * metersPerLng,
    y: point.lat * 110540,
  }));

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

  let best = { rotated: projected, bounds: boundsFor(projected), height: 0 };
  if (options.rotate) {
    for (let degrees = -89; degrees <= 89; degrees += 1) {
      const angle = (degrees * Math.PI) / 180;
      const rotated = rotatePoints(projected, angle);
      const bounds = boundsFor(rotated);
      const projectedHeight = bounds.height * ((width - pad * 2) / bounds.width) + pad * 2;
      if (!best.height || projectedHeight < best.height) best = { rotated, bounds, height: projectedHeight };
    }
  }

  const { minX, maxY, width: routeWidthMeters, height: routeHeightMeters } = best.bounds;
  const scale = Math.min((width - pad * 2) / routeWidthMeters, (height - pad * 2) / routeHeightMeters);
  const routeWidth = routeWidthMeters * scale;
  const routeHeight = routeHeightMeters * scale;
  const xOffset = x + (width - routeWidth) / 2;
  const yOffset = y + (height - routeHeight) / 2;

  return best.rotated.map((point) => ({
    x: xOffset + (point.x - minX) * scale,
    y: yOffset + (maxY - point.y) * scale,
  }));
}

function smoothReceiptRoute(points) {
  if (points.length < 4) return points;
  let smoothed = points;
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const next = [smoothed[0]];
    for (let index = 1; index < smoothed.length - 1; index += 1) {
      const previous = smoothed[index - 1];
      const current = smoothed[index];
      const following = smoothed[index + 1];
      next.push({
        x: previous.x * 0.25 + current.x * 0.5 + following.x * 0.25,
        y: previous.y * 0.25 + current.y * 0.5 + following.y * 0.25,
      });
    }
    next.push(smoothed.at(-1));
    smoothed = next;
  }
  return smoothed;
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

function elevationChartPoints(points) {
  const chartPoints = [];
  let meters = 0;

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!Number.isFinite(point?.altitude)) continue;
    if (index > 0) meters += usableSegmentMeters(points[index - 1], point);
    if (chartPoints.length && meters === chartPoints.at(-1).meters) continue;
    chartPoints.push({ meters, feet: metersToFeet(point.altitude) });
  }

  if (chartPoints.length < 3) return chartPoints;

  return chartPoints.map((point, index) => {
    const neighbors = chartPoints.slice(Math.max(0, index - 2), Math.min(chartPoints.length, index + 3));
    const averageFeet = neighbors.reduce((sum, item) => sum + item.feet, 0) / neighbors.length;
    return { ...point, feet: averageFeet };
  });
}

function drawSummaryElevationChart(points) {
  const canvas = document.querySelector("#summaryElevationChart");
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || canvas.width));
  const height = Math.max(1, Math.round(rect.height || canvas.height));
  const scale = window.devicePixelRatio || 1;
  if (canvas.width !== width * scale || canvas.height !== height * scale) {
    canvas.width = width * scale;
    canvas.height = height * scale;
  }

  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const chartPoints = elevationChartPoints(points);
  if (chartPoints.length < 2) {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--muted").trim() || "#8b969f";
    ctx.font = "700 12px Helvetica, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No elevation data", width / 2, height / 2);
    return;
  }

  const minFeet = Math.min(...chartPoints.map((point) => point.feet));
  const maxFeet = Math.max(...chartPoints.map((point) => point.feet));
  const startMeters = chartPoints[0].meters;
  const endMeters = chartPoints.at(-1).meters;
  const meterRange = Math.max(1, endMeters - startMeters);
  const feetRange = Math.max(10, maxFeet - minFeet);
  const padding = 12;

  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--cyan").trim() || "#3de0cd";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();

  chartPoints.forEach((point, index) => {
    const x = padding + ((point.meters - startMeters) / meterRange) * (width - padding * 2);
    const y = height - padding - ((point.feet - minFeet) / feetRange) * (height - padding * 2);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();
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
  const editButton = document.querySelector("#editCoachSplits");
  let editing = false;
  table.append(tableRow(["Split", "Pace", "Elev"], true));
  if (!run.coachSplits?.length) {
    table.append(tableRow(["--", "No coach splits", "--"]));
    if (editButton) editButton.hidden = true;
    return;
  }
  renderRows();
  if (!editButton) return;
  editButton.addEventListener("click", async () => {
    if (!editing) {
      setEditing(true);
      table.querySelector("input")?.focus();
      return;
    }
    const splits = [...table.querySelectorAll("[data-split-label]")].map((input) => ({
      number: Number(input.dataset.splitLabel),
      label: input.value.trim() || `Split ${input.dataset.splitLabel}`,
    }));
    const updated = await updateRunCoachSplitLabels(params.get("profile"), params.get("run"), splits);
    if (updated?.coachSplits) run.coachSplits = updated.coachSplits;
    else {
      for (const split of run.coachSplits) {
        const next = splits.find((item) => item.number === split.number);
        if (next) split.label = next.label;
      }
    }
    setEditing(false);
    editButton.textContent = "Saved";
    setTimeout(() => (editButton.textContent = "Edit splits"), 900);
  });

  function setEditing(nextValue) {
    editing = nextValue;
    editButton.textContent = editing ? "Save splits" : "Edit splits";
    renderRows();
  }

  function renderRows() {
    table.querySelectorAll(".data-row:not(.data-head)").forEach((row) => row.remove());
    for (const split of run.coachSplits) table.append(splitTableRow(split, editing));
  }
}

function splitTableRow(split, editing = false) {
  const row = document.createElement("div");
  row.className = "data-row split-label-row";
  const label = split.label || `Split ${split.number}`;
  const labelCell = document.createElement("span");
  if (editing) {
    const input = document.createElement("input");
    input.dataset.splitLabel = split.number;
    input.value = label;
    input.maxLength = 24;
    input.setAttribute("aria-label", `Split ${split.number} label`);
    labelCell.append(input);
  } else {
    labelCell.textContent = label;
  }
  const paceCell = document.createElement("span");
  paceCell.textContent = `${formatPace(split.pace)} · ${split.distanceMiles.toFixed(2)} mi`;
  const elevationCell = document.createElement("span");
  elevationCell.textContent = signedFeet(split.elevationFeet);
  row.append(labelCell, paceCell, elevationCell);
  return row;
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
