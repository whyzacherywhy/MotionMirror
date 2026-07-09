const params = new URLSearchParams(location.search);
const nextPath = params.get("next") || "/profiles";
const el = {
  title: document.querySelector("#authTitle"),
  subtitle: document.querySelector("#authSubtitle"),
  form: document.querySelector("#authForm"),
  nameField: document.querySelector("#nameField"),
  displayName: document.querySelector("#displayName"),
  email: document.querySelector("#email"),
  password: document.querySelector("#password"),
  submit: document.querySelector("#authSubmit"),
  message: document.querySelector("#authMessage"),
};

let isSetup = false;

async function loadAuthState() {
  const response = await fetch("/api/auth/me");
  const state = await response.json();
  if (state.authenticated) {
    location.href = nextPath;
    return;
  }

  isSetup = Boolean(state.setupRequired);
  el.nameField.hidden = !isSetup;
  el.title.textContent = isSetup ? "Create coach login" : "Coach login";
  el.subtitle.textContent = isSetup
    ? "Make the private coach account for this CoachLink workspace."
    : "Sign in to view private profiles and saved runs.";
  el.submit.textContent = isSetup ? "Create login" : "Sign in";

  if (isSetup && state.suggestedCoach) {
    el.email.value = state.suggestedCoach.email || "";
    el.displayName.value = state.suggestedCoach.displayName || "";
  }
}

el.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  el.message.textContent = "";
  el.submit.disabled = true;

  const response = await fetch(isSetup ? "/api/auth/setup" : "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: el.email.value.trim(),
      displayName: el.displayName.value.trim(),
      password: el.password.value,
    }),
  });

  if (response.ok) {
    location.href = nextPath;
    return;
  }

  const payload = await response.json().catch(() => ({}));
  el.message.textContent = payload.error || "Could not sign in.";
  el.submit.disabled = false;
});

loadAuthState().catch(() => {
  el.message.textContent = "Could not load login.";
});
