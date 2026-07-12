const form = document.querySelector("#coachProfileForm");
const firstNameInput = document.querySelector("#coachFirstName");
const lastNameInput = document.querySelector("#coachLastName");
const emailInput = document.querySelector("#coachEmail");
const message = document.querySelector("#coachProfileMessage");

function splitCoachName(displayName = "") {
  const parts = String(displayName || "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts.shift() || "",
    lastName: parts.join(" "),
  };
}

async function loadCoachProfile() {
  const response = await fetch("/api/auth/me");
  if (!response.ok) throw new Error("Could not load coach profile.");
  const state = await response.json();
  if (!state.authenticated) {
    location.href = `/login.html?next=${encodeURIComponent(location.pathname)}`;
    return;
  }

  const { firstName, lastName } = splitCoachName(state.coach?.displayName);
  firstNameInput.value = firstName;
  lastNameInput.value = lastName;
  emailInput.value = state.coach?.email || "";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const firstName = firstNameInput.value.trim();
  const lastName = lastNameInput.value.trim();
  const displayName = [firstName, lastName].filter(Boolean).join(" ");
  if (!displayName) {
    message.textContent = "Enter at least a first name.";
    return;
  }

  message.textContent = "Saving...";
  const response = await fetch("/api/auth/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    message.textContent = result.error || "Could not save coach profile.";
    return;
  }

  const saved = splitCoachName(result.coach?.displayName);
  firstNameInput.value = saved.firstName;
  lastNameInput.value = saved.lastName;
  message.textContent = "Coach profile saved.";
});

loadCoachProfile().catch(() => {
  message.textContent = "Could not load coach profile.";
});
