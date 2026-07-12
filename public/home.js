async function updateHomeAuth() {
  const loginLink = document.querySelector("#coachLoginLink");
  const profileLink = document.querySelector("#coachProfileLink");
  const signOutButton = document.querySelector("#coachSignOutButton");
  const response = await fetch("/api/auth/me");
  if (!response.ok) return;
  const state = await response.json();
  if (!state.authenticated) return;

  loginLink.hidden = true;
  profileLink.hidden = false;
  signOutButton.hidden = false;
}

updateHomeAuth().catch(() => {});
