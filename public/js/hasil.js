/* Hasil Asesmen — halaman Admin (vanilla JS, tanpa module).
   Dua versi dari satu payload /api/hasil-asesmen: Lengkap (kartu per
   kelompok) dan Ringkas (satu baris per murid). Khusus admin: /api/me
   gagal -> kartu "login dulu di halaman admin". */
(function () {
  "use strict";

  var state = { modul: "projek", kelasId: null, data: null, versi: "lengkap", semuaKelas: [] };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>\"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }
  function $(id) { return document.getElementById(id); }
  function loadingHTML(msg) {
    return '<div class="loading"><span class="spinner"></span><br>' + esc(msg || "Memuat…") + "</div>";
  }
  function showAlert(msg, kind) {
    var a = $("alert");
    if (!msg) { a.className = "alert hidden"; a.textContent = ""; return; }
    a.className = "alert alert-" + (kind || "error");
    a.textContent = msg;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function apiErr(status, message) {
    var e = new Error(message || "Terjadi kesalahan");
    e.status = status;
    return e;
  }
  async function apiJson(path, method, body) {
    var opt = { method: method || "GET", credentials: "same-origin", headers: { "Content-Type": "application/json" } };
    if (body !== undefined) opt.body = JSON.stringify(body);
    var r = await fetch(path, opt);
    var data = {};
    try { data = await r.json(); } catch (e) {}
    if (!r.ok) throw apiErr(r.status, data.error || ("Gagal memuat (HTTP " + r.status + ")"));
    return data;
  }
  function handleErr(e) {
    if (e && e.status === 401) { tampilButuhLogin(); showAlert("Sesi berakhir. Silakan login lagi lewat halaman admin."); return; }
    showAlert(e && e.message ? e.message : "Terjadi kesalahan");
  }
  function tampilButuhLogin() {
    $("view-butuh-login").classList.remove("hidden");
    $("view-app").classList.add("hidden");
    $("btn-logout").classList.add("hidden");
    $("hasil-area").innerHTML = "";
    $("btn-csv").disabled = true;
    $("btn-cetak").disabled = true;
  }

  // ---------- kelas ----------
  function isiKelasSelect() {
    var modul = state.modul;
    var list = state.semuaKelas.filter(function (k) {
      if (modul === "senam") return k.tingkat === "7" || !k.tingkat;
      return k.tingkat === "8" || k.tingkat === "9" || !k.tingkat;
    });
    if (!list.length) list = state.semuaKelas;
    var cur = $("kelas").value;
    $("kelas").innerHTML = '<option value="">— pilih —</option>' + list.map(function (k) {
      return '<option value="' + k.id + '">' + esc(k.nama) + "</option>";
    }).join("");
    if (cur && list.some(function (k) { return String(k.id) === cur; })) $("kelas").value = cur;
  }

  async function boot() {
    try {
      await apiJson("/api/me");
      $("view-butuh-login").classList.add("hidden");
      $("view-app").classList.remove("hidden");
      $("btn-logout").classList.remove("hidden");
      var d = await apiJson("/api/kelas");
      state.semuaKelas = d.kelas || [];
      isiKelasSelect();
    } catch (e) {
      tampilButuhLogin();
    }
  }

  $("btn-logout").addEventListener("click", async function () {
    try { await fetch("/api/logout", { method: "POST", credentials: "same-origin" }); } catch (e) {}
    tampilButuhLogin();
  });
  $("modul").addEventListener("change", function () {
    state.modul = $("modul").value;
    isiKelasSelect();
  });

  // ---------- tampilkan ----------
  async function tampilkan() {
    var kelasId = $("kelas").value;
    if (!kelasId) { showAlert("Pilih kelas dulu."); return; }
    state.modul = $("modul").value;
    state.kelasId = kelasId;
    $("hasil-area").innerHTML = loadingHTML("Memuat hasil asesmen…");
    try {
      state.data = await apiJson("/api/hasil-asesmen?modul=" + state.modul + "&kelas_id=" + kelasId);
      $("btn-csv").disabled = false;
      $("btn-cetak").disabled = false;
      var d = state.data;
      var dinilai = d.kelompok.filter(function (k) { return k.nilai_akhir != null; }).length;
      var jmlMurid = d.kelompok.reduce(function (a, k) { return a + k.anggota.length; }, 0);
      $("hasil-info").textContent = d.modul_label + " • Kelas " + d.kelas.nama + " • " +
        d.kelompok.length + " kelompok • " + jmlMurid + " murid • " + dinilai + " kelompok sudah dinilai.";
      render();
    } catch (e) { handleErr(e); }
  }
  $("btn-tampilkan").addEventListener("click", tampilkan);

  function judulCetak() {
    var d = state.data;
    return "<h2>Hasil Asesmen — " + esc(d.modul_label) + " • Kelas " + esc(d.kelas.nama) +
      " <span class=\"muted small\">(versi " + (state.versi === "lengkap" ? "lengkap" : "ringkas") + ")</span></h2>";
  }

  function render() {
    if (!state.data) return;
    $("hasil-area").innerHTML = judulCetak() + (state.versi === "lengkap" ? renderLengkap() : renderRingkas());
    window.scrollTo(0, 0);
  }
  $("btn-versi-lengkap").addEventListener("click", function () {
    if (!state.data) { showAlert("Tampilkan hasil dulu."); return; }
    state.versi = "lengkap";
    render();
  });
  $("btn-versi-ringkas").addEventListener("click", function () {
    if (!state.data) { showAlert("Tampilkan hasil dulu."); return; }
    state.versi = "ringkas";
    render();
  });

  // ---------- versi lengkap: kartu per kelompok ----------
  function renderLengkap() {
    var d = state.data;
    if (!d.kelompok.length) return '<div class="card"><p class="muted">Belum ada kelompok di kelas ini.</p></div>';
    return d.kelompok.map(function (kel) {
      var infoProduk = d.modul === "projek"
        ? "Cabang: " + esc(kel.cabang_nama || "—") + " • Produk: " + esc(kel.nama_produk || "—")
        : "Judul Penampilan / Musik Pengiring: " + esc(kel.judul_penampilan || "—");
      var anggota = kel.anggota.length
        ? kel.anggota.map(function (a) { return esc(a.nama) + (a.nis ? " (" + esc(a.nis) + ")" : " (NIS —)"); }).join(", ")
        : "—";
      var head = "<tr><th>Penilai</th>" + d.kategori.map(function (k) { return "<th>" + esc(k.nama) + "</th>"; }).join("") +
        '<th class="num">Nilai Penilai</th><th>Status</th></tr>';
      var rows = kel.penilai.length ? kel.penilai.map(function (p) {
        var cells = d.kategori.map(function (k) {
          var e = p.nilai[k.id];
          return "<td>" + (e ? esc(e.skor) + ' <span class="muted small">(' + esc(e.kriteria_nama) + ")</span>" : "—") + "</td>";
        }).join("");
        return "<tr><td><b>" + esc(p.kode) + "</b> — " + esc(p.nama) + "</td>" + cells +
          '<td class="num">' + (p.nilai_penilai != null ? esc(p.nilai_penilai) : "—") + "</td>" +
          "<td>" + (p.lengkap ? "✅ Lengkap" : "⏳ " + p.jml_kategori + "/" + d.kategori.length) + "</td></tr>";
      }).join("") : '<tr><td colspan="' + (d.kategori.length + 3) + '" class="muted">Belum ada penilai.</td></tr>';
      var rata = "<tr><td><b>Rata-rata (penilai lengkap)</b></td>" +
        d.kategori.map(function (k) {
          var v = kel.rata_kategori[k.id];
          return '<td><b>' + (v != null ? esc(v) : "—") + "</b></td>";
        }).join("") +
        '<td class="num"><b>' + (kel.nilai_akhir != null ? esc(kel.nilai_akhir) : "—") + "</b></td><td></td></tr>";
      return '<div class="card">' +
        "<h3>" + (kel.peringkat != null ? "🏆 #" + kel.peringkat + " — " : "") + esc(kel.nama_kelompok) +
        ' <span class="badge ' + (kel.nilai_akhir != null ? "badge-green" : "badge-gold") + '">Nilai Akhir: ' +
        (kel.nilai_akhir != null ? esc(kel.nilai_akhir) : "Belum dinilai") + "</span></h3>" +
        '<p class="muted small">' + infoProduk + " • Anggota (" + kel.anggota.length + "): " + anggota +
        " • Penilai lengkap: " + kel.jml_penilai_lengkap + "/" + kel.jml_penilai + " • Foto: " + kel.jml_foto + "</p>" +
        '<div class="table-wrap"><table class="data"><thead>' + head + "</thead><tbody>" + rows + rata + "</tbody></table></div>" +
        '<p class="small" style="margin-top:10px"><b>Deskripsi:</b> ' + esc(kel.deskripsi) + "</p>" +
        "</div>";
    }).join("");
  }

  // ---------- versi ringkas: satu baris per murid ----------
  function renderRingkas() {
    var d = state.data;
    var rows = [];
    var adaBintang = false;
    d.kelompok.forEach(function (kel) {
      kel.anggota.forEach(function (a) {
        var bintang = kel.nilai_akhir != null && kel.jml_penilai_lengkap < 4;
        if (bintang) adaBintang = true;
        rows.push("<tr><td>" + (rows.length + 1) + "</td><td>" + esc(a.nama) + "</td><td>" +
          (a.nis ? esc(a.nis) : "—") + "</td><td>" + esc(d.kelas.nama) + "</td>" +
          '<td class="num">' + (kel.nilai_akhir != null ? esc(kel.nilai_akhir) + (bintang ? " *" : "") : "—") + "</td>" +
          "<td>" + esc(kel.deskripsi) + "</td></tr>");
      });
    });
    if (!rows.length) return '<div class="card"><p class="muted">Belum ada murid di kelompok kelas ini.</p></div>';
    return '<div class="card"><div class="table-wrap"><table class="data"><thead><tr>' +
      "<th>No</th><th>Nama</th><th>NIS</th><th>Kelas</th><th class=\"num\">Nilai Akhir</th><th>Deskripsi</th>" +
      "</tr></thead><tbody>" + rows.join("") + "</tbody></table></div>" +
      (adaBintang
        ? '<p class="muted small" style="margin-top:10px">* Nilai Akhir dihitung dari penilai yang sudah lengkap (4/4 kategori); kelompok bertanda * dinilai kurang dari 4 penilai lengkap.</p>'
        : "") +
      "</div>";
  }

  // ---------- CSV & cetak ----------
  $("btn-csv").addEventListener("click", async function () {
    if (!state.data) return;
    try {
      var r = await fetch("/api/hasil-asesmen/export.csv?modul=" + state.modul + "&kelas_id=" + state.kelasId + "&versi=" + state.versi, { credentials: "same-origin" });
      if (r.status === 401) { tampilButuhLogin(); showAlert("Sesi berakhir. Silakan login lagi lewat halaman admin."); return; }
      if (!r.ok) throw new Error("Gagal mengunduh CSV (HTTP " + r.status + ")");
      var blob = await r.blob();
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "hasil-asesmen-" + state.modul + "-" + state.data.kelas.nama + "-" + state.versi + ".csv";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { handleErr(e); }
  });
  $("btn-cetak").addEventListener("click", function () {
    if (!state.data) return;
    window.print();
  });

  boot();
})();
