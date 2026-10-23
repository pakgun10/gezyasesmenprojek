/** Footer global — otomatis disuntik ke semua halaman. */
function buildFooter() {
  if (document.body.classList.contains("no-footer")) return;
  if (document.querySelector(".global-footer")) return;
  const el = document.createElement("footer");
  el.className = "global-footer";
  // Gaya tengah ditulis inline juga, supaya footer tetap di tengah
  // walau browser masih menyimpan cache style.css versi lama.
  el.style.cssText =
    "text-align:center;color:#6b7a8d;font-size:0.82rem;" +
    "padding:1.6rem 1rem 1.4rem;margin-top:2rem;border-top:1px solid #dbe3ec;";
  el.innerHTML =
    '<div>&copy; 2026 GezyTech App &middot; Dikembangkan oleh <b>PakGun</b></div>' +
    '<div class="foot-sub">GezyAspro &mdash; SMP Negeri 1 Punggur</div>';
  document.body.appendChild(el);
}
buildFooter();
