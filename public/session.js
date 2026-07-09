document.querySelectorAll("[data-logout]").forEach((button) => {
  button.addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/login.html";
  });
});
