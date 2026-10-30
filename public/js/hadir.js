/* Daftar Hadir — halaman Admin (vanilla JS, tanpa module).
   Satu daftar per (modul, rombel, tanggal), dirangkai dari kelompok di
   rombel itu. Khusus admin: /api/me gagal -> kartu "login dulu di
   halaman admin". Tabel edit ada di layar (.no-print); yang tercetak
   adalah tabel statis di #print-area, diperbarui tiap ada perubahan. */
(function () {
  "use strict";

  var state = { modul: "projek", kelasId: null, tanggal: "", data: null, edits: {}, semuaKelas: [] };
  var STATUS = [
    { v: "hadir", label: "Hadir" },
    { v: "izin", label: "Izin" },
    { v: "sakit", label: "Sakit" },
    { v: "alpa", label: "Alpa" },
  ];
  var STATUS_LABEL = { hadir: "Hadir", izin: "Izin", sakit: "Sakit", alpa: "Alpa" };

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
    $("hadir-edit").innerHTML = "";
    $("hadir-cetak").innerHTML = "";
    ["btn-simpan", "btn-semua-hadir", "btn-csv", "btn-cetak"].forEach(function (id) { $(id).disabled = true; });
  }
  function tanggalHariIni() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }
  function tanggalIndo(iso) {
    var p = String(iso || "").split("-");
    if (p.length !== 3) return iso || "";
    return p[2] + "/" + p[1] + "/" + p[0];
  }

  // ---------- kelas & tanggal tersimpan ----------
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
  async function isiTanggalTersimpan() {
    var sel = $("tanggal-tersimpan");
    var kelasId = $("kelas").value;
    if (!kelasId) { sel.innerHTML = '<option value="">— pilih kelas dulu —</option>'; return; }
    try {
      var d = await apiJson("/api/kehadiran/tanggal?modul=" + state.modul + "&kelas_id=" + kelasId);
      sel.innerHTML = (d.tanggal && d.tanggal.length)
        ? '<option value="">— pilih tanggal lama —</option>' + d.tanggal.map(function (t) {
            return '<option value="' + esc(t) + '">' + esc(tanggalIndo(t)) + "</option>";
          }).join("")
        : '<option value="">— belum ada —</option>';
    } catch (e) { sel.innerHTML = '<option value="">— gagal memuat —</option>'; }
  }

  async function boot() {
    try {
      await apiJson("/api/me");
      $("view-butuh-login").classList.add("hidden");
      $("view-app").classList.remove("hidden");
      $("btn-logout").classList.remove("hidden");
      $("tanggal").value = tanggalHariIni();
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
    isiTanggalTersimpan();
  });
  $("kelas").addEventListener("change", isiTanggalTersimpan);
  $("tanggal-tersimpan").addEventListener("change", function () {
    if ($("tanggal-tersimpan").value) {
      $("tanggal").value = $("tanggal-tersimpan").value;
      tampilkan();
    }
  });

  // ---------- tampilkan ----------
  function nilaiEdit(a) {
    var e = state.edits[a.anggota_id];
    if (e) return e;
    // Baris belum tersimpan tampil sebagai Hadir, tetapi belum tersimpan.
    return { status: a.status || "hadir", keterangan: a.keterangan || "" };
  }
  function rekapDariEdit() {
    var r = { hadir: 0, izin: 0, sakit: 0, alpa: 0 };
    state.data.kelompok.forEach(function (kel) {
      kel.anggota.forEach(function (a) { r[nilaiEdit(a).status] += 1; });
    });
    return r;
  }
  function infoText() {
    var d = state.data;
    var r = rekapDariEdit();
    return d.modul_label + " • Kelas " + d.kelas.nama + " • " + tanggalIndo(d.tanggal) + " • " +
      d.jml_kelompok + " kelompok • " + d.jml_murid + " murid • " +
      "Hadir " + r.hadir + " • Izin " + r.izin + " • Sakit " + r.sakit + " • Alpa " + r.alpa +
      (d.ada_tersimpan ? " • Sudah pernah disimpan untuk tanggal ini." : " • Belum pernah disimpan untuk tanggal ini.") +
      " Perubahan baru tersimpan setelah tombol Simpan Kehadiran ditekan.";
  }

  async function tampilkan() {
    var kelasId = $("kelas").value;
    var tanggal = $("tanggal").value;
    if (!kelasId) { showAlert("Pilih kelas dulu."); return; }
    if (!tanggal) { showAlert("Isi tanggal dulu."); return; }
    state.modul = $("modul").value;
    state.kelasId = kelasId;
    state.tanggal = tanggal;
    $("hadir-edit").innerHTML = loadingHTML("Memuat daftar hadir…");
    try {
      state.data = await apiJson("/api/kehadiran?modul=" + state.modul + "&kelas_id=" + kelasId + "&tanggal=" + tanggal);
      state.edits = {};
      ["btn-simpan", "btn-semua-hadir", "btn-csv", "btn-cetak"].forEach(function (id) { $(id).disabled = false; });
      $("hadir-info").textContent = infoText();
      renderEdit();
      renderCetak();
      isiTanggalTersimpan();
    } catch (e) { handleErr(e); }
  }
  $("btn-tampilkan").addEventListener("click", tampilkan);

  function renderEdit() {
    var d = state.data;
    if (!d.kelompok.length) {
      $("hadir-edit").innerHTML = '<div class="card"><p class="muted">Belum ada kelompok di kelas ini.</p></div>';
      return;
    }
    var no = 0;
    var rows = "";
    d.kelompok.forEach(function (kel) {
      kel.anggota.forEach(function (a) {
        no += 1;
        var v = nilaiEdit(a);
        var opts = STATUS.map(function (s) {
          return '<option value="' + s.v + '"' + (v.status === s.v ? " selected" : "") + ">" + s.label + "</option>";
        }).join("");
        rows += "<tr><td>" + no + "</td><td>" + esc(a.nama) + "</td><td>" + (a.nis ? esc(a.nis) : "—") + "</td>" +
          "<td>" + esc(kel.nama_kelompok) + "</td>" +
          '<td><select data-status="' + a.anggota_id + '">' + opts + "</select></td>" +
          '<td><input type="text" data-ket="' + a.anggota_id + '" value="' + esc(v.keterangan) +
          '" placeholder="Keterangan (opsional)" maxlength="200"></td></tr>';
      });
    });
    $("hadir-edit").innerHTML = '<div class="card"><div class="table-wrap"><table class="data"><thead><tr>' +
      "<th>No</th><th>Nama</th><th>NIS</th><th>Kelompok</th><th>Kehadiran</th><th>Keterangan</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table></div></div>";
    $("hadir-edit").querySelectorAll("select[data-status]").forEach(function (el) {
      el.addEventListener("change", function () {
        var id = Number(el.getAttribute("data-status"));
        var cur = state.edits[id] || nilaiEdit(findAnggota(id));
        cur.status = el.value;
        state.edits[id] = cur;
        $("hadir-info").textContent = infoText();
        renderCetak();
      });
    });
    $("hadir-edit").querySelectorAll("input[data-ket]").forEach(function (el) {
      el.addEventListener("input", function () {
        var id = Number(el.getAttribute("data-ket"));
        var cur = state.edits[id] || nilaiEdit(findAnggota(id));
        cur.keterangan = el.value;
        state.edits[id] = cur;
        renderCetak();
      });
    });
  }
  function findAnggota(id) {
    var found = null;
    state.data.kelompok.forEach(function (kel) {
      kel.anggota.forEach(function (a) { if (a.anggota_id === id) found = a; });
    });
    return found;
  }

  function renderCetak() {
    var d = state.data;
    if (!d) { $("hadir-cetak").innerHTML = ""; return; }
    var r = rekapDariEdit();
    var no = 0;
    var rows = "";
    d.kelompok.forEach(function (kel) {
      kel.anggota.forEach(function (a) {
        no += 1;
        var v = nilaiEdit(a);
        rows += "<tr><td>" + no + "</td><td>" + esc(a.nama) + "</td><td>" + esc(kel.nama_kelompok) + "</td>" +
          "<td>" + esc(STATUS_LABEL[v.status] || v.status) + "</td><td>" + esc(v.keterangan) + "</td></tr>";
      });
    });
    $("hadir-cetak").innerHTML =
      "<h2>Daftar Hadir — " + esc(d.modul_label) + " • Kelas " + esc(d.kelas.nama) + "</h2>" +
      "<p>Tanggal: " + esc(tanggalIndo(d.tanggal)) + " • " + d.jml_kelompok + " kelompok • " + d.jml_murid + " murid</p>" +
      '<div class="table-wrap"><table class="data"><thead><tr>' +
      "<th>No</th><th>Nama</th><th>Kelompok</th><th>Kehadiran</th><th>Keterangan</th>" +
      "</tr></thead><tbody>" + (rows || '<tr><td colspan="5">Belum ada murid di kelompok kelas ini.</td></tr>') + "</tbody></table></div>" +
      "<p>Hadir: " + r.hadir + " • Izin: " + r.izin + " • Sakit: " + r.sakit + " • Alpa: " + r.alpa + "</p>";
  }

  // ---------- aksi ----------
  $("btn-semua-hadir").addEventListener("click", function () {
    if (!state.data) return;
    state.data.kelompok.forEach(function (kel) {
      kel.anggota.forEach(function (a) {
        var cur = state.edits[a.anggota_id] || nilaiEdit(a);
        cur.status = "hadir";
        state.edits[a.anggota_id] = cur;
      });
    });
    renderEdit();
    $("hadir-info").textContent = infoText();
    renderCetak();
  });
  $("btn-simpan").addEventListener("click", async function () {
    if (!state.data) return;
    var daftar = [];
    state.data.kelompok.forEach(function (kel) {
      kel.anggota.forEach(function (a) {
        var v = nilaiEdit(a);
        daftar.push({ anggota_id: a.anggota_id, status: v.status, keterangan: v.keterangan });
      });
    });
    if (!daftar.length) { showAlert("Tidak ada murid untuk disimpan."); return; }
    try {
      var res = await apiJson("/api/kehadiran", "POST", {
        modul: state.modul, kelas_id: Number(state.kelasId), tanggal: state.tanggal, daftar: daftar,
      });
      showAlert("Kehadiran tersimpan: " + res.tersimpan + " murid (Hadir " + res.rekap.hadir +
        ", Izin " + res.rekap.izin + ", Sakit " + res.rekap.sakit + ", Alpa " + res.rekap.alpa + ").", "success");
      // Muat ulang supaya penanda "sudah tersimpan" & tanggal tersimpan akurat.
      await tampilkan();
      isiTanggalTersimpan();
    } catch (e) { handleErr(e); }
  });
  $("btn-csv").addEventListener("click", async function () {
    if (!state.data) return;
    try {
      var r = await fetch("/api/kehadiran/export.csv?modul=" + state.modul + "&kelas_id=" + state.kelasId + "&tanggal=" + state.tanggal, { credentials: "same-origin" });
      if (r.status === 401) { tampilButuhLogin(); showAlert("Sesi berakhir. Silakan login lagi lewat halaman admin."); return; }
      if (!r.ok) throw new Error("Gagal mengunduh CSV (HTTP " + r.status + ")");
      var blob = await r.blob();
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "kehadiran-" + state.modul + "-" + state.data.kelas.nama + "-" + state.tanggal + ".csv";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { handleErr(e); }
  });
  $("btn-cetak").addEventListener("click", function () {
    if (!state.data) return;
    renderCetak();
    window.print();
  });

  boot();
})();
