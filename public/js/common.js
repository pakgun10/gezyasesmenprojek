/** Footer global — otomatis disuntik ke semua halaman. */
function buildFooter() {
  if (document.body.classList.contains("no-footer")) return;
  if (document.querySelector(".global-footer")) return;
  const el = document.createElement("footer");
  el.className = "global-footer";
  el.innerHTML =
    '<div>&copy; 2026 GezyTech App &middot; Dikembangkan oleh <b>PakGun</b></div>' +
    '<div class="foot-sub">GezyAspro &mdash; SMP Negeri 1 Punggur</div>';
  document.body.appendChild(el);
}
buildFooter();
