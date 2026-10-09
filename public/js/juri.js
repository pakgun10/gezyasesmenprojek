/* Penilaian Projek — halaman Juri (vanilla JS, tanpa module) */
(function () {
  "use strict";

  var state = {
    juri: null,
    kelas: [],
    kelasId: null,
    kelasNama: "",
    kelompok: [],
    totalKategori: 4,
    kategori: null,
    kelompokId: null,
    kelompokCabangNama: "",
    nilaiSaya: [],
    fotoSaya: []
  };

  // ---------- util ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }
  function $(id) { return document.getElementById(id); }
  function loadingHTML(msg) {
    return '<div class="loading"><span class="spinner"></span><br>' + esc(msg || "Memuat…") + "</div>";
  }

  var alertBox = null;
  function showAlert(msg, kind) {
    alertBox = $("alert");
    if (!msg) { alertBox.className = "alert hidden"; alertBox.textContent = ""; return; }
    alertBox.className = "alert alert-" + (kind || "error");
    alertBox.textContent = msg;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showView(id) {
    ["view-login", "view-kelas", "view-kelompok", "view-nilai"].forEach(function (v) {
      $(v).classList.toggle("hidden", v !== id);
    });
    showAlert(null);
    window.scrollTo(0, 0);
  }

  function toLogin() {
    state.juri = null;
    $("juri-nama").textContent = "";
    $("btn-logout").classList.add("hidden");
    showView("view-login");
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

  async function apiUpload(formData) {
    var r = await fetch("/api/juri/foto", { method: "POST", credentials: "same-origin", body: formData });
    var data = {};
    try { data = await r.json(); } catch (e) {}
    if (!r.ok) throw apiErr(r.status, data.error || "Gagal mengunggah foto");
    return data;
  }

  function handleErr(e) {
    if (e && e.status === 401) { toLogin(); showAlert("Sesi berakhir. Silakan login lagi."); return; }
    showAlert(e && e.message ? e.message : "Terjadi kesalahan");
  }

  // ---------- 1. login ----------
  async function boot() {
    try {
      var me = await apiJson("/api/juri/me");
      state.juri = me.juri;
      afterLogin();
    } catch (e) {
      toLogin();
    }
  }

  function afterLogin() {
    $("juri-nama").textContent = "👤 " + state.juri.nama + " (" + state.juri.kode + ")";
    $("btn-logout").classList.remove("hidden");
    loadKelas();
  }

  $("form-login").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    showAlert(null);
    var btn = $("btn-login");
    btn.disabled = true; btn.textContent = "Memeriksa…";
    try {
      var d = await apiJson("/api/juri/login", "POST", {
        kode: $("kode").value.trim(),
        pin: $("pin").value
      });
      state.juri = d.juri;
      $("pin").value = "";
      afterLogin();
    } catch (e) {
      showAlert(e.message);
    } finally {
      btn.disabled = false; btn.textContent = "Masuk";
    }
  });

  $("btn-logout").addEventListener("click", async function () {
    try { await apiJson("/api/juri/logout", "POST"); } catch (e) {}
    toLogin();
  });

  // ---------- 2. pilih kelas ----------
  async function loadKelas() {
    showView("view-kelas");
    $("kelas-list").innerHTML = loadingHTML("Memuat daftar kelas…");
    try {
      var d = await apiJson("/api/juri/kelas");
      state.kelas = d.kelas || [];
      if (!state.kelas.length) {
        $("kelas-list").innerHTML = '<div class="card"><p class="muted">Belum ada kelas yang terdaftar.</p></div>';
        return;
      }
      $("kelas-list").innerHTML = state.kelas.map(function (k) {
        return '<button type="button" class="card kel-card" data-kelas="' + k.id + '" style="text-align:left;cursor:pointer;width:100%">' +
          '<span class="nama">🏫 Kelas ' + esc(k.nama) + '</span>' +
          '<span class="meta">Tingkat ' + esc(k.tingkat || "-") + " • " + esc(k.jml_kelompok) + " kelompok</span>" +
          "</button>";
      }).join("");
      $("kelas-list").querySelectorAll("[data-kelas]").forEach(function (b) {
        b.addEventListener("click", function () { pilihKelas(Number(b.getAttribute("data-kelas"))); });
      });
    } catch (e) { handleErr(e); }
  }

  function pilihKelas(id) {
    var k = state.kelas.find(function (x) { return x.id === id; });
    state.kelasId = id;
    state.kelasNama = k ? k.nama : "";
    loadKelompok();
  }

  $("btn-back-kelas").addEventListener("click", loadKelas);

  // ---------- 3. daftar kelompok ----------
  async function loadKelompok() {
    showView("view-kelompok");
    $("kelompok-title").textContent = "Daftar Kelompok — Kelas " + state.kelasNama;
    $("kelompok-list").innerHTML = loadingHTML("Memuat kelompok…");
    try {
      var d = await apiJson("/api/juri/kelompok?kelas_id=" + state.kelasId);
      state.kelompok = d.kelompok || [];
      state.totalKategori = d.total_kategori || 4;
      if (!state.kelompok.length) {
        $("kelompok-list").innerHTML = '<div class="card"><p class="muted">Belum ada kelompok di kelas ini.</p></div>';
        return;
      }
      $("kelompok-list").innerHTML = state.kelompok.map(function (g) {
        var n = Number(g.jml_dinilai || 0);
        var t = state.totalKategori;
        var badge = n >= t
          ? '<span class="badge badge-green">✔ Dinilai ' + n + "/" + t + "</span>"
          : '<span class="badge badge-gray">Dinilai ' + n + "/" + t + "</span>";
        return '<div class="card kel-card">' +
          '<div class="nama">' + esc(g.nama_kelompok) + "</div>" +
          '<div class="meta">🍍 ' + esc(g.nama_produk || "(belum ada nama produk)") +
          ' • <span class="badge badge-blue">' + esc(g.cabang_nama || "-") + "</span></div>" +
          '<div class="meta">👥 ' + esc(g.jml_siswa) + " siswa" + (Number(g.jml_foto) ? " • 📷 " + esc(g.jml_foto) + " foto" : "") + "</div>" +
          '<div class="foot">' + badge +
          '<button type="button" class="btn btn-primary btn-sm" data-nilai="' + g.id + '">' + (n >= t ? "Lihat / Ubah" : "Nilai") + "</button></div>" +
          "</div>";
      }).join("");
      $("kelompok-list").querySelectorAll("[data-nilai]").forEach(function (b) {
        b.addEventListener("click", function () { bukaNilai(Number(b.getAttribute("data-nilai"))); });
      });
    } catch (e) { handleErr(e); }
  }

  $("btn-back-kelompok").addEventListener("click", loadKelompok);

  // ---------- 4. form nilai ----------
  async function ensureKategori() {
    if (state.kategori) return state.kategori;
    var d = await apiJson("/api/juri/kategori");
    state.kategori = d.kategori || [];
    return state.kategori;
  }

  async function bukaNilai(kelompokId) {
    showView("view-nilai");
    $("nilai-head").innerHTML = loadingHTML("Memuat data kelompok…");
    $("kategori-list").innerHTML = "";
    $("foto-section").classList.add("hidden");
    var dariDaftar = state.kelompok.find(function (g) { return g.id === kelompokId; });
    state.kelompokCabangNama = (dariDaftar && dariDaftar.cabang_nama) || "";
    try {
      var kats = await ensureKategori();
      var d = await apiJson("/api/juri/kelompok/" + kelompokId);
      var kel = d.kelompok;
      state.kelompokId = kelompokId;
      state.nilaiSaya = kel.nilai_saya || [];
      state.fotoSaya = kel.foto_saya || [];
      renderNilaiHead(kel);
      renderKategori(kats);
      renderFoto();
    } catch (e) { handleErr(e); }
  }

  function renderNilaiHead(kel) {
    var siswa = (kel.siswa || []).map(function (s) { return esc(s.nama); }).join(", ");
    $("nilai-head").innerHTML =
      "<h3>" + esc(kel.nama_kelompok) + ' <span class="badge badge-blue">' + esc(kel.cabang_nama || state.kelompokCabangNama || "-") + "</span></h3>" +
      "<div class=\"meta\">🍍 <b>" + esc(kel.nama_produk || "-") + "</b> • Kelas " + esc(kel.kelas_nama) + "</div>" +
      '<div class="meta small">👥 ' + (siswa || "-") + "</div>" +
      '<div class="progress"><div id="nilai-progress" style="width:0%"></div></div>' +
      '<div class="small muted" id="nilai-progress-txt"></div>';
    updateProgress();
  }

  function nilaiUntuk(katId) {
    return state.nilaiSaya.find(function (n) { return Number(n.kategori_id) === Number(katId); }) || null;
  }

  function renderKategori(kats) {
    var html = kats.map(function (kat) {
      var saved = nilaiUntuk(kat.id);
      var opts = (kat.kriteria || []).map(function (kr) {
        var checked = saved && Number(saved.kriteria_id) === Number(kr.id) ? " checked" : "";
        return '<label class="kriteria-opt' + (checked ? " selected" : "") + '">' +
          '<input type="radio" name="krit-' + kat.id + '" value="' + kr.id + '"' + checked +
          ' data-min="' + kr.skor_min + '" data-max="' + kr.skor_max + '" data-def="' + kr.skor_default + '">' +
          '<span class="knama">' + esc(kr.nama) + "</span> " +
          '<span class="krange badge badge-gold">' + esc(kr.skor_min) + "–" + esc(kr.skor_max) + "</span>" +
          '<span class="kdesc">' + esc(kr.deskripsi) + "</span>" +
          "</label>";
      }).join("");
      var skorVal = saved ? saved.skor : "";
      return '<div class="kat-card' + (saved ? " saved" : "") + '" id="kat-' + kat.id + '">' +
        "<h3>" + esc(kat.nama) + (saved ? ' <span class="badge badge-green">✔ tersimpan: ' + esc(saved.skor) + " (" + esc(saved.kriteria_nama) + ")</span>" : "") + "</h3>" +
        opts +
        '<div class="skor-row"><label for="skor-' + kat.id + '">Skor (0–100):</label>' +
        '<input type="number" id="skor-' + kat.id + '" min="0" max="100" step="1" value="' + esc(skorVal) + '" placeholder="cth: 85">' +
        '<button type="button" class="btn btn-primary btn-sm" data-simpan="' + kat.id + '">💾 Simpan Nilai</button></div>' +
        '<div class="small muted" id="msg-' + kat.id + '"></div>' +
        "</div>";
    }).join("");
    $("kategori-list").innerHTML = html;

    kats.forEach(function (kat) {
      // sorot opsi terpilih + set skor default saat radio berubah
      var radios = document.querySelectorAll('input[name="krit-' + kat.id + '"]');
      radios.forEach(function (r) {
        r.addEventListener("change", function () {
          document.querySelectorAll('input[name="krit-' + kat.id + '"]').forEach(function (x) {
            x.closest(".kriteria-opt").classList.toggle("selected", x.checked);
          });
          if (r.checked) {
            var inp = $("skor-" + kat.id);
            inp.min = r.getAttribute("data-min");
            inp.max = r.getAttribute("data-max");
            if (!inp.value) inp.value = r.getAttribute("data-def");
          }
        });
      });
      // batasi min/max input sesuai kriteria terpilih awal
      var terpilih = document.querySelector('input[name="krit-' + kat.id + '"]:checked');
      if (terpilih) {
        var inp0 = $("skor-" + kat.id);
        inp0.min = terpilih.getAttribute("data-min");
        inp0.max = terpilih.getAttribute("data-max");
      }
      var btn = document.querySelector('[data-simpan="' + kat.id + '"]');
      btn.addEventListener("click", function () { simpanNilai(kat.id, btn); });
    });
  }

  function updateProgress() {
    var n = state.nilaiSaya.length, t = (state.kategori || []).length || state.totalKategori;
    var bar = $("nilai-progress"), txt = $("nilai-progress-txt");
    if (!bar) return;
    bar.style.width = Math.round((n / t) * 100) + "%";
    txt.textContent = "Kategori dinilai: " + n + "/" + t;
    if (n >= t && t > 0) {
      $("foto-section").classList.remove("hidden");
    }
  }

  async function simpanNilai(katId, btn) {
    var msg = $("msg-" + katId);
    msg.textContent = "";
    var radio = document.querySelector('input[name="krit-' + katId + '"]:checked');
    if (!radio) { msg.textContent = "⚠️ Pilih salah satu kriteria dulu."; return; }
    var min = Number(radio.getAttribute("data-min"));
    var max = Number(radio.getAttribute("data-max"));
    var skor = Number($("skor-" + katId).value);
    if (!isFinite(skor)) { msg.textContent = "⚠️ Isi skor berupa angka."; return; }
    if (skor < 0 || skor > 100) { msg.textContent = "⚠️ Skor harus 0–100."; return; }
    if (skor < min || skor > max) {
      msg.textContent = "⚠️ Skor harus dalam rentang kriteria terpilih (" + min + "–" + max + ").";
      return;
    }
    btn.disabled = true; btn.textContent = "Menyimpan…";
    try {
      await apiJson("/api/juri/nilai", "POST", {
        kelompok_id: state.kelompokId,
        kategori_id: katId,
        kriteria_id: Number(radio.value),
        skor: skor
      });
      // perbarui state lokal
      var ex = nilaiUntuk(katId);
      var namaKriteria = radio.closest(".kriteria-opt").querySelector(".knama").textContent;
      if (ex) { ex.kriteria_id = Number(radio.value); ex.skor = skor; ex.kriteria_nama = namaKriteria; }
      else state.nilaiSaya.push({ kategori_id: katId, kriteria_id: Number(radio.value), skor: skor, kriteria_nama: namaKriteria });
      var card = $("kat-" + katId);
      card.classList.add("saved");
      var h3 = card.querySelector("h3");
      h3.innerHTML = h3.textContent.replace(/\s*✔.*$/, "") + ' <span class="badge badge-green">✔ tersimpan: ' + esc(skor) + " (" + esc(namaKriteria) + ")</span>";
      updateProgress();
    } catch (e) {
      if (e.status === 401) { toLogin(); return; }
      msg.textContent = "❌ " + e.message;
    } finally {
      btn.disabled = false; btn.textContent = "💾 Simpan Nilai";
    }
  }

  $("btn-selesai").addEventListener("click", loadKelompok);

  // ---------- 5. foto ----------
  function renderFoto() {
    var list = $("foto-list");
    if (!state.fotoSaya.length) {
      list.innerHTML = '<p class="muted small">Belum ada foto. Ambil foto produk dengan tombol di bawah.</p>';
    } else {
      list.innerHTML = state.fotoSaya.map(function (f) {
        return '<div class="foto-item">' +
          '<img src="/api/uploads/' + esc(f.filename) + '" alt="Foto produk" loading="lazy">' +
          (f.caption ? '<span class="cap">' + esc(f.caption) + "</span>" : "") +
          '<button type="button" class="del" data-delfoto="' + f.id + '" title="Hapus foto">×</button>' +
          "</div>";
      }).join("");
      list.querySelectorAll("[data-delfoto]").forEach(function (b) {
        b.addEventListener("click", function () { hapusFoto(Number(b.getAttribute("data-delfoto"))); });
      });
    }
  }

  async function hapusFoto(id) {
    if (!confirm("Hapus foto ini?")) return;
    try {
      await apiJson("/api/juri/foto/" + id, "DELETE");
      state.fotoSaya = state.fotoSaya.filter(function (f) { return f.id !== id; });
      renderFoto();
    } catch (e) { handleErr(e); }
  }

  $("btn-upload").addEventListener("click", async function () {
    var files = $("foto-input").files;
    var info = $("upload-info");
    info.textContent = "";
    if (!files.length) { info.textContent = "⚠️ Pilih foto dulu."; return; }
    var caption = $("foto-caption").value.trim().slice(0, 200);
    var btn = $("btn-upload");
    btn.disabled = true;
    var sukses = 0, gagal = [];
    for (var i = 0; i < files.length; i++) {
      info.textContent = "Mengunggah " + (i + 1) + "/" + files.length + "…";
      var fd = new FormData();
      fd.append("kelompok_id", String(state.kelompokId));
      fd.append("caption", caption);
      fd.append("foto", files[i], files[i].name);
      try {
        var r = await apiUpload(fd);
        state.fotoSaya.push({ id: r.id, filename: r.filename, caption: caption, uploaded_at: "" });
        sukses++;
      } catch (e) {
        if (e.status === 401) { toLogin(); return; }
        gagal.push(files[i].name + ": " + e.message);
      }
    }
    btn.disabled = false;
    $("foto-input").value = "";
    renderFoto();
    info.textContent = sukses ? "✅ " + sukses + " foto terunggah." : "";
    if (gagal.length) info.textContent += " ❌ " + gagal.join("; ");
  });

  // ---------- start ----------
  boot();
})();
