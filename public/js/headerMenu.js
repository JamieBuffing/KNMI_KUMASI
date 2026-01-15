// public/js/headerMenu.js

document.addEventListener("DOMContentLoaded", () => {
  const menu = document.querySelector(".header-menu");
  if (!menu) return;

  const btn = menu.querySelector(".header-button");
  const dropdown = menu.querySelector(".header-dropdown");
  if (!btn || !dropdown) return;

  const setOpen = (open) => {
    menu.classList.toggle("is-open", open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  };

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(!menu.classList.contains("is-open"));
  });

  // Close when clicking outside
  document.addEventListener("click", (e) => {
    if (!menu.classList.contains("is-open")) return;
    if (menu.contains(e.target)) return;
    setOpen(false);
  });

  // Close on escape
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!menu.classList.contains("is-open")) return;
    setOpen(false);
    btn.focus();
  });

  // Close after choosing a link
  dropdown.addEventListener("click", (e) => {
    const link = e.target.closest("a");
    if (!link) return;
    setOpen(false);
  });
});
