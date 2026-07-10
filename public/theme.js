const themeKey = "motionMirrorTheme";
const root = document.documentElement;

function applyTheme(theme) {
  root.dataset.theme = theme;
  localStorage.setItem(themeKey, theme);
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.textContent = theme === "light" ? "☾" : "☀";
    button.setAttribute("aria-label", theme === "light" ? "Switch to night mode" : "Switch to light mode");
  });
}

const savedTheme = localStorage.getItem(themeKey);
applyTheme(savedTheme === "light" ? "light" : "dark");

window.addEventListener("DOMContentLoaded", () => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "theme-toggle";
  button.dataset.themeToggle = "";
  document.body.append(button);
  button.addEventListener("click", () => {
    applyTheme(root.dataset.theme === "light" ? "dark" : "light");
  });
  applyTheme(root.dataset.theme || "dark");
});
