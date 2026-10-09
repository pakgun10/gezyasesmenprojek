/* Penilaian Projek — panel Admin (vanilla JS, tanpa module) */
(function () {
  "use strict";

  var loaded = {};
  var state = { hasilData: null, hasilKelasId: null, hasilKelasNama: "", siswaKelompokId: null };

  // Cache daftar cabang produk (GET /api/cabang)
  async function ensureCabang(force) {
    if (window.__cabangCache && !force) return window.__cabangCache;
    var d = await apiJson("/api/cabang");
    window.__cabangCache = d.cabang || [];
    return window.__cabangCache;
  }

  function fillCabangSelects() {
    var list = window.__cabangCache || [];
    $("kelompok-cabang").innerHTML = list.map(function (c) {
      return '<option value="' + c.id + '">' + esc(c.nama) + "</option>";
    }).join("") || '<option value="">(belum ada cabang — tambahkan di tab Cabang Produk)</option>';
  }

  // ---------- util ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }
  function $(id) { return document.getElementById(id); }
  function loadingRow(cols, msg) {
    return '<tr><td colspan="' + cols + '"><div class="loading"><span class="spinner"></span><br>' + esc(msg || "Memuat…") + "</div></td></tr>";
  }

  function showAlert(msg, kind) {
    var a = $("alert");
    if (!msg) { a.className = "alert hidden"; a.textContent = ""; return; }
    a.className = "alert alert-" + (kind || "error");
    a.textContent = msg;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toLogin() {
    $("view-app").classList.add("hidden");
    $("view-login").classList.remove("hidden");
    $("admin-nama").textContent = "";
    $("btn-logout").classList.add("hidden");
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
    if (e && e.status === 401) { toLogin(); showAlert("Sesi berakhir. Silakan login lagi."); return; }
    showAlert(e && e.message ? e.message : "Terjadi kesalahan");
  }

  // ---------- login ----------
  async function boot() {
    try {
      var me = await apiJson("/api/me");
      afterLogin(me.user);
    } catch (e) {
      toLogin();
    }
  }

  function afterLogin(user) {
    $("admin-nama").textContent = "👤 " + (user.username || "admin");
    $("btn-logout").classList.remove("hidden");
    $("view-login").classList.add("hidden");
    $("view-app").classList.remove("hidden");
    switchTab("dasbor");
  }

  $("form-login").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    showAlert(null);
    var btn = $("btn-login");
    btn.disabled = true; btn.textContent = "Memeriksa…";
    try {
      var d = await apiJson("/api/login", "POST", { username: $("username").value.trim(), password: $("password").value });
      $("password").value = "";
      afterLogin(d.user);
    } catch (e) { showAlert(e.message); }
    finally { btn.disabled = false; btn.textContent = "Masuk"; }
  });

  $("btn-logout").addEventListener("click", async function () {
    try { await apiJson("/api/logout", "POST"); } catch (e) {}
    toLogin();
  });

  // ---------- tab ----------
  function switchTab(name) {
    document.querySelectorAll("#tabs .tab-btn").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-tab") === name);
    });
    document.querySelectorAll(".tab-panel").forEach(function (p) {
      p.classList.toggle("active", p.id === "tab-" + name);
    });
    showAlert(null);
    if (name === "dasbor") loadDasbor();
    else if (name === "kelas") loadKelasTab();
    else if (name === "cabang") loadCabangTab();
    else if (name === "kelompok") loadKelompokTab();
    else if (name === "juri") loadJuriTab();
    else if (name === "kriteria") loadKriteriaTab();
    // tab hasil dimuat manual via tombol
  }

  document.querySelectorAll("#tabs .tab-btn").forEach(function (b) {
    b.addEventListener("click", function () { switchTab(b.getAttribute("data-tab")); });
  });

  // ---------- DASBOR ----------
  async function loadDasbor() {
    $("stat-grid").innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    $("tbl-dasbor").querySelector("tbody").innerHTML = loadingRow(4, "Memuat dasbor…");
    try {
      var d = await apiJson("/api/dashboard");
      var stats = [
        ["🏫", d.total_kelas, "Kelas"],
        ["👥", d.total_kelompok, "Kelompok"],
        ["🎒", d.total_siswa, "Siswa"],
        ["🧑‍⚖️", d.total_juri, "Juri"],
        ["📝", d.total_penilaian, "Nilai masuk"],
        ["📷", d.total_foto, "Foto"]
      ];
      $("stat-grid").innerHTML = stats.map(function (s) {
        return '<div class="stat"><div class="num">' + esc(s[0]) + " " + esc(s[1]) + '</div><div class="lbl">' + esc(s[2]) + "</div></div>";
      }).join("");
      var rows = (d.per_kelas || []).map(function (k) {
        return "<tr><td><b>" + esc(k.nama) + "</b> <span class=\"muted small\">(tingkat " + esc(k.tingkat || "-") + ")</span></td>" +
          '<td class="num">' + esc(k.kelompok) + '</td><td class="num">' + esc(k.siswa) + '</td><td class="num">' + esc(k.nilai_masuk) + "</td></tr>";
      }).join("");
      $("tbl-dasbor").querySelector("tbody").innerHTML = rows || '<tr><td colspan="4" class="muted">Belum ada data kelas.</td></tr>';
    } catch (e) { handleErr(e); }
  }

  // ---------- KELAS ----------
  function resetKelasForm() {
    $("kelas-id").value = "";
    $("kelas-nama").value = "";
    $("kelas-tingkat").value = "7";
    $("kelas-form-title").textContent = "Tambah Kelas";
    $("kelas-submit").textContent = "Tambah";
    $("kelas-batal").classList.add("hidden");
  }

  async function loadKelasTab() {
    resetKelasForm();
    var tb = $("tbl-kelas").querySelector("tbody");
    tb.innerHTML = loadingRow(5, "Memuat kelas…");
    try {
      var d = await apiJson("/api/kelas");
      tb.innerHTML = (d.kelas || []).map(function (k) {
        return "<tr><td><b>" + esc(k.nama) + "</b></td><td>" + esc(k.tingkat || "-") + "</td>" +
          '<td class="num">' + esc(k.jml_kelompok) + '</td><td class="num">' + esc(k.jml_siswa) + "</td>" +
          '<td><button type="button" class="btn btn-ghost btn-sm" data-kedit="' + k.id + '">✏️</button> ' +
          '<button type="button" class="btn btn-danger btn-sm" data-kdel="' + k.id + '">🗑️</button></td></tr>';
      }).join("") || '<tr><td colspan="5" class="muted">Belum ada kelas. Tambahkan lewat form di atas.</td></tr>';
      tb.querySelectorAll("[data-kedit]").forEach(function (b) {
        b.addEventListener("click", function () { editKelas(Number(b.getAttribute("data-kedit"))); });
      });
      tb.querySelectorAll("[data-kdel]").forEach(function (b) {
        b.addEventListener("click", function () { hapusKelas(Number(b.getAttribute("data-kdel"))); });
      });
      // cache untuk dropdown lain
      window.__kelasCache = d.kelas || [];
      fillKelasSelects();
    } catch (e) { handleErr(e); }
  }

  async function editKelas(id) {
    try {
      var d = await apiJson("/api/kelas");
      var k = (d.kelas || []).find(function (x) { return x.id === id; });
      if (!k) return;
      $("kelas-id").value = k.id;
      $("kelas-nama").value = k.nama;
      $("kelas-tingkat").value = k.tingkat || "7";
      $("kelas-form-title").textContent = "Ubah Kelas";
      $("kelas-submit").textContent = "💾 Simpan";
      $("kelas-batal").classList.remove("hidden");
      window.scrollTo(0, 0);
    } catch (e) { handleErr(e); }
  }

  async function hapusKelas(id) {
    if (!confirm("Hapus kelas ini? Semua kelompok, siswa, dan nilainya ikut terhapus!")) return;
    try {
      await apiJson("/api/kelas/" + id, "DELETE");
      loadKelasTab();
    } catch (e) { handleErr(e); }
  }

  $("form-kelas").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var id = $("kelas-id").value;
    var body = { nama: $("kelas-nama").value.trim(), tingkat: $("kelas-tingkat").value };
    try {
      if (id) await apiJson("/api/kelas/" + id, "PUT", body);
      else await apiJson("/api/kelas", "POST", body);
      showAlert(id ? "Kelas diperbarui." : "Kelas ditambahkan.", "success");
      loadKelasTab();
    } catch (e) { handleErr(e); }
  });
  $("kelas-batal").addEventListener("click", resetKelasForm);

  function fillKelasSelects() {
    var list = window.__kelasCache || [];
    var opts = list.map(function (k) { return '<option value="' + k.id + '">' + esc(k.nama) + "</option>"; }).join("");
    $("flt-kelas").innerHTML = '<option value="">Semua kelas</option>' + opts;
    $("kelompok-kelas").innerHTML = opts || '<option value="">(belum ada kelas)</option>';
    var cur = $("hasil-kelas").value;
    $("hasil-kelas").innerHTML = '<option value="">— pilih —</option>' + opts;
    if (cur) $("hasil-kelas").value = cur;
  }

  // ---------- CABANG PRODUK ----------
  function resetCabangForm() {
    $("cabang-id").value = "";
    $("cabang-nama").value = "";
    $("cabang-deskripsi").value = "";
    $("cabang-form-title").textContent = "Tambah Cabang Produk";
    $("cabang-submit").textContent = "Tambah";
    $("cabang-batal").classList.add("hidden");
  }

  async function loadCabangTab() {
    resetCabangForm();
    var tb = $("tbl-cabang").querySelector("tbody");
    tb.innerHTML = loadingRow(4, "Memuat cabang produk…");
    try {
      var list = await ensureCabang(true);
      tb.innerHTML = list.map(function (c) {
        return "<tr><td><b>" + esc(c.nama) + "</b></td>" +
          "<td><code>" + esc(c.kode) + "</code></td>" +
          "<td>" + esc(c.deskripsi || "-") + "</td>" +
          '<td style="white-space:nowrap"><button type="button" class="btn btn-ghost btn-sm" data-cedit="' + c.id + '">✏️</button> ' +
          '<button type="button" class="btn btn-danger btn-sm" data-cdel="' + c.id + '">🗑️</button></td></tr>';
      }).join("") || '<tr><td colspan="4" class="muted">Belum ada cabang produk.</td></tr>';
      tb.querySelectorAll("[data-cedit]").forEach(function (b) {
        b.addEventListener("click", function () { editCabang(Number(b.getAttribute("data-cedit"))); });
      });
      tb.querySelectorAll("[data-cdel]").forEach(function (b) {
        b.addEventListener("click", function () { hapusCabang(Number(b.getAttribute("data-cdel"))); });
      });
      fillCabangSelects();
    } catch (e) { handleErr(e); }
  }

  function editCabang(id) {
    var c = (window.__cabangCache || []).find(function (x) { return x.id === id; });
    if (!c) return;
    $("cabang-id").value = c.id;
    $("cabang-nama").value = c.nama;
    $("cabang-deskripsi").value = c.deskripsi || "";
    $("cabang-form-title").textContent = "Ubah Cabang Produk";
    $("cabang-submit").textContent = "💾 Simpan";
    $("cabang-batal").classList.remove("hidden");
    window.scrollTo(0, 0);
  }

  async function hapusCabang(id) {
    if (!confirm("Hapus cabang produk ini?")) return;
    try {
      await apiJson("/api/cabang/" + id, "DELETE");
      showAlert("Cabang produk dihapus.", "success");
      await loadCabangTab();
      loadKelompokTable();
    } catch (e) { handleErr(e); }
  }

  $("form-cabang").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var id = $("cabang-id").value;
    var body = { nama: $("cabang-nama").value.trim(), deskripsi: $("cabang-deskripsi").value.trim() };
    try {
      if (id) await apiJson("/api/cabang/" + id, "PUT", body);
      else await apiJson("/api/cabang", "POST", body);
      showAlert(id ? "Cabang produk diperbarui." : "Cabang produk ditambahkan.", "success");
      await loadCabangTab();
    } catch (e) { handleErr(e); }
  });
  $("cabang-batal").addEventListener("click", resetCabangForm);

  // ---------- KELOMPOK ----------
  function resetKelompokForm() {
    $("kelompok-id").value = "";
    $("kelompok-nama").value = "";
    $("kelompok-produk").value = "";
    $("kelompok-form-title").textContent = "Tambah Kelompok";
    $("kelompok-submit").textContent = "Tambah";
    $("kelompok-batal").classList.add("hidden");
  }

  async function loadKelompokTab() {
    resetKelompokForm();
    $("siswa-panel").classList.add("hidden");
    try {
      if (!window.__kelasCache) {
        var d = await apiJson("/api/kelas");
        window.__kelasCache = d.kelas || [];
        fillKelasSelects();
      } else fillKelasSelects();
      await ensureCabang();
      fillCabangSelects();
    } catch (e) { handleErr(e); return; }
    loadKelompokTable();
  }

  async function loadKelompokTable() {
    var tb = $("tbl-kelompok").querySelector("tbody");
    tb.innerHTML = loadingRow(8, "Memuat kelompok…");
    var kelasId = $("flt-kelas").value;
    var q = $("flt-q").value.trim();
    var url = "/api/kelompok?" + (kelasId ? "kelas_id=" + encodeURIComponent(kelasId) + "&" : "") + "q=" + encodeURIComponent(q);
    try {
      var d = await apiJson(url);
      var list = d.kelompok || [];
      $("kelompok-count").textContent = "(" + list.length + " kelompok)";
      tb.innerHTML = list.map(function (g) {
        return "<tr><td><b>" + esc(g.nama_kelompok) + "</b></td>" +
          "<td>" + esc(g.kelas_nama) + "</td>" +
          '<td><span class="badge badge-blue">' + esc(g.cabang_nama || "-") + "</span></td>" +
          "<td>" + esc(g.nama_produk || "-") + "</td>" +
          '<td class="num">' + esc(g.jml_siswa) + '</td><td class="num">' + esc(g.jml_juri) + '</td><td class="num">' + esc(g.jml_foto) + "</td>" +
          '<td style="white-space:nowrap">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-gedit="' + g.id + '" title="Ubah">✏️</button> ' +
          '<button type="button" class="btn btn-ghost btn-sm" data-gsiswa="' + g.id + '" title="Kelola siswa">👥</button> ' +
          '<button type="button" class="btn btn-danger btn-sm" data-gdel="' + g.id + '" title="Hapus">🗑️</button></td></tr>';
      }).join("") || '<tr><td colspan="8" class="muted">Tidak ada kelompok. Tambahkan manual atau impor CSV.</td></tr>';
      tb.querySelectorAll("[data-gedit]").forEach(function (b) {
        b.addEventListener("click", function () { editKelompok(Number(b.getAttribute("data-gedit"))); });
      });
      tb.querySelectorAll("[data-gsiswa]").forEach(function (b) {
        b.addEventListener("click", function () { bukaSiswaPanel(Number(b.getAttribute("data-gsiswa"))); });
      });
      tb.querySelectorAll("[data-gdel]").forEach(function (b) {
        b.addEventListener("click", function () { hapusKelompok(Number(b.getAttribute("data-gdel"))); });
      });
    } catch (e) { handleErr(e); }
  }

  $("btn-cari").addEventListener("click", loadKelompokTable);
  $("flt-kelas").addEventListener("change", loadKelompokTable);
  var cariT = null;
  $("flt-q").addEventListener("input", function () {
    clearTimeout(cariT);
    cariT = setTimeout(loadKelompokTable, 500);
  });

  async function editKelompok(id) {
    try {
      await ensureCabang();
      fillCabangSelects();
      var d = await apiJson("/api/kelompok/" + id);
      var g = d.kelompok;
      $("kelompok-id").value = g.id;
      $("kelompok-kelas").value = g.kelas_id;
      $("kelompok-nama").value = g.nama_kelompok;
      if (g.cabang_id) $("kelompok-cabang").value = g.cabang_id;
      $("kelompok-produk").value = g.nama_produk || "";
      $("kelompok-form-title").textContent = "Ubah Kelompok";
      $("kelompok-submit").textContent = "💾 Simpan";
      $("kelompok-batal").classList.remove("hidden");
      window.scrollTo(0, 0);
    } catch (e) { handleErr(e); }
  }

  async function hapusKelompok(id) {
    if (!confirm("Hapus kelompok ini? Siswa, nilai, dan fotonya ikut terhapus!")) return;
    try {
      await apiJson("/api/kelompok/" + id, "DELETE");
      loadKelompokTable();
    } catch (e) { handleErr(e); }
  }

  $("form-kelompok").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var id = $("kelompok-id").value;
    var body = {
      kelas_id: Number($("kelompok-kelas").value),
      nama_kelompok: $("kelompok-nama").value.trim(),
      cabang_id: Number($("kelompok-cabang").value),
      nama_produk: $("kelompok-produk").value.trim()
    };
    if (!body.cabang_id) { showAlert("Pilih cabang produk dulu."); return; }
    try {
      if (id) await apiJson("/api/kelompok/" + id, "PUT", body);
      else await apiJson("/api/kelompok", "POST", body);
      showAlert(id ? "Kelompok diperbarui." : "Kelompok ditambahkan.", "success");
      loadKelompokTab();
    } catch (e) { handleErr(e); }
  });
  $("kelompok-batal").addEventListener("click", resetKelompokForm);

  // ----- kelola siswa -----
  async function bukaSiswaPanel(id) {
    try {
      var d = await apiJson("/api/kelompok/" + id);
      state.siswaKelompokId = id;
      $("siswa-kelompok-nama").textContent = d.kelompok.nama_kelompok + " (Kelas " + d.kelompok.kelas_nama + ")";
      var names = (d.siswa || []).map(function (s) { return s.nama; });
      renderSiswaRows(names.length ? names : [""]);
      $("siswa-panel").classList.remove("hidden");
      $("siswa-panel").scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) { handleErr(e); }
  }

  function renderSiswaRows(names) {
    var box = $("siswa-rows");
    box.innerHTML = "";
    names.forEach(function (n) { tambahBarisSiswa(n); });
  }

  function tambahBarisSiswa(nama) {
    var box = $("siswa-rows");
    if (box.querySelectorAll(".siswa-row").length >= 12) { showAlert("Maksimal 12 murid per kelompok."); return; }
    var div = document.createElement("div");
    div.className = "siswa-row";
    var inp = document.createElement("input");
    inp.type = "text";
    inp.placeholder = "Nama murid";
    inp.value = nama || "";
    inp.maxLength = 100;
    var del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn-danger btn-sm";
    del.textContent = "×";
    del.title = "Hapus baris";
    del.addEventListener("click", function () { div.remove(); renumberSiswa(); });
    var num = document.createElement("span");
    num.className = "muted small siswa-num";
    num.style.minWidth = "28px";
    div.appendChild(num);
    div.appendChild(inp);
    div.appendChild(del);
    box.appendChild(div);
    renumberSiswa();
  }

  function renumberSiswa() {
    $("siswa-rows").querySelectorAll(".siswa-row").forEach(function (row, i) {
      row.querySelector(".siswa-num").textContent = (i + 1) + ".";
    });
  }

  $("btn-siswa-tambah").addEventListener("click", function () { tambahBarisSiswa(""); });
  $("btn-siswa-tutup").addEventListener("click", function () {
    $("siswa-panel").classList.add("hidden");
    state.siswaKelompokId = null;
  });
  $("btn-siswa-simpan").addEventListener("click", async function () {
    var names = [];
    $("siswa-rows").querySelectorAll("input").forEach(function (inp) {
      var v = inp.value.trim();
      if (v) names.push(v);
    });
    if (names.length < 4) { showAlert("Minimal 4 murid per kelompok (terisi: " + names.length + ")."); return; }
    if (names.length > 12) { showAlert("Maksimal 12 murid per kelompok."); return; }
    try {
      var r = await apiJson("/api/kelompok/" + state.siswaKelompokId + "/siswa", "PUT", { names: names });
      showAlert("Daftar siswa disimpan (" + r.jumlah + " murid).", "success");
      loadKelompokTable();
    } catch (e) { handleErr(e); }
  });

  // ----- impor CSV -----
  $("btn-import").addEventListener("click", async function () {
    var csv = $("csv-text").value;
    var box = $("import-hasil");
    box.innerHTML = "";
    if (!csv.trim()) { showAlert("Tempel isi CSV dulu."); return; }
    var btn = $("btn-import");
    btn.disabled = true; btn.textContent = "Mengimpor…";
    try {
      var r = await apiJson("/api/kelompok/import", "POST", { csv: csv });
      var html = '<div class="alert alert-success">✅ Berhasil diimpor: <b>' + esc(r.diimpor) + "</b> kelompok.</div>";
      if ((r.peringatan || []).length) {
        html += '<div class="alert alert-info">⚠️ Peringatan:<br>' + r.peringatan.map(function (p) { return "• " + esc(p); }).join("<br>") + "</div>";
      }
      box.innerHTML = html;
      $("csv-text").value = "";
      loadKelompokTable();
      // refresh cache kelas karena impor bisa menambah kelas baru
      var d = await apiJson("/api/kelas");
      window.__kelasCache = d.kelas || [];
      fillKelasSelects();
    } catch (e) {
      box.innerHTML = '<div class="alert alert-error">❌ ' + esc(e.message) + "</div>";
    } finally {
      btn.disabled = false; btn.textContent = "⬆️ Impor";
    }
  });

  // ---------- JURI ----------
  function resetJuriForm() {
    $("juri-id").value = "";
    $("juri-kode").value = "";
    $("juri-kode").disabled = false;
    $("juri-nama").value = "";
    $("juri-pin").value = "";
    $("juri-ket").value = "";
    $("juri-form-title").textContent = "Tambah Juri";
    $("juri-submit").textContent = "Tambah";
    $("juri-batal").classList.add("hidden");
  }

  async function loadJuriTab() {
    resetJuriForm();
    var tb = $("tbl-juri").querySelector("tbody");
    tb.innerHTML = loadingRow(5, "Memuat juri…");
    try {
      var d = await apiJson("/api/juri");
      tb.innerHTML = (d.juri || []).map(function (j) {
        return "<tr><td><b>" + esc(j.kode) + "</b></td><td>" + esc(j.nama) + "</td>" +
          "<td>" + esc(j.keterangan || "-") + "</td>" +
          '<td class="num">' + esc(j.jml_kelompok_dinilai) + "</td>" +
          '<td style="white-space:nowrap"><button type="button" class="btn btn-ghost btn-sm" data-jedit="' + j.id + '">✏️</button> ' +
          '<button type="button" class="btn btn-danger btn-sm" data-jdel="' + j.id + '">🗑️</button></td></tr>';
      }).join("") || '<tr><td colspan="5" class="muted">Belum ada juri.</td></tr>';
      tb.querySelectorAll("[data-jedit]").forEach(function (b) {
        b.addEventListener("click", function () { editJuri(Number(b.getAttribute("data-jedit"))); });
      });
      tb.querySelectorAll("[data-jdel]").forEach(function (b) {
        b.addEventListener("click", function () { hapusJuri(Number(b.getAttribute("data-jdel"))); });
      });
    } catch (e) { handleErr(e); }
  }

  async function editJuri(id) {
    try {
      var d = await apiJson("/api/juri");
      var j = (d.juri || []).find(function (x) { return x.id === id; });
      if (!j) return;
      $("juri-id").value = j.id;
      $("juri-kode").value = j.kode;
      $("juri-kode").disabled = true;
      $("juri-nama").value = j.nama;
      $("juri-pin").value = "";
      $("juri-ket").value = j.keterangan || "";
      $("juri-form-title").textContent = "Ubah Juri";
      $("juri-submit").textContent = "💾 Simpan";
      $("juri-batal").classList.remove("hidden");
      window.scrollTo(0, 0);
    } catch (e) { handleErr(e); }
  }

  async function hapusJuri(id) {
    if (!confirm("Hapus juri ini? Semua nilai dan fotonya ikut terhapus!")) return;
    try {
      await apiJson("/api/juri/" + id, "DELETE");
      loadJuriTab();
    } catch (e) { handleErr(e); }
  }

  $("form-juri").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var id = $("juri-id").value;
    var pin = $("juri-pin").value.trim();
    if (!id && !/^[0-9]{4,8}$/.test(pin)) { showAlert("PIN harus 4–8 digit angka."); return; }
    if (id && pin && !/^[0-9]{4,8}$/.test(pin)) { showAlert("PIN harus 4–8 digit angka."); return; }
    var body = { nama: $("juri-nama").value.trim(), keterangan: $("juri-ket").value.trim() };
    if (!id) { body.kode = $("juri-kode").value.trim(); body.pin = pin; }
    else if (pin) body.pin = pin;
    try {
      if (id) await apiJson("/api/juri/" + id, "PUT", body);
      else await apiJson("/api/juri", "POST", body);
      showAlert(id ? "Juri diperbarui." : "Juri ditambahkan.", "success");
      loadJuriTab();
    } catch (e) { handleErr(e); }
  });
  $("juri-batal").addEventListener("click", resetJuriForm);

  // ---------- KRITERIA ----------
  async function loadKriteriaTab() {
    var box = $("kriteria-list");
    box.innerHTML = '<div class="loading"><span class="spinner"></span><br>Memuat kriteria…</div>';
    try {
      var d = await apiJson("/api/kategori");
      box.innerHTML = (d.kategori || []).map(function (kat) {
        var kris = (kat.kriteria || []).map(function (kr) {
          return '<div class="card" id="kri-' + kr.id + '">' +
            '<div class="form-group"><label>Nama kriteria</label><input type="text" data-f="nama" value="' + esc(kr.nama) + '"></div>' +
            '<div class="form-group"><label>Deskripsi</label><input type="text" data-f="deskripsi" value="' + esc(kr.deskripsi) + '"></div>' +
            '<div class="form-row">' +
            '<div class="form-group"><label>Min</label><input type="number" data-f="skor_min" min="0" max="100" value="' + esc(kr.skor_min) + '"></div>' +
            '<div class="form-group"><label>Max</label><input type="number" data-f="skor_max" min="0" max="100" value="' + esc(kr.skor_max) + '"></div>' +
            '<div class="form-group"><label>Default</label><input type="number" data-f="skor_default" min="0" max="100" value="' + esc(kr.skor_default) + '"></div>' +
            "</div>" +
            '<button type="button" class="btn btn-primary btn-sm" data-krisimpan="' + kr.id + '">💾 Simpan kriteria</button> ' +
            '<span class="small muted" data-krimsg="' + kr.id + '"></span>' +
            "</div>";
        }).join("");
        return '<div class="card"><h3>🎯 ' + esc(kat.nama) + "</h3>" + kris + "</div>";
      }).join("");
      box.querySelectorAll("[data-krisimpan]").forEach(function (b) {
        b.addEventListener("click", function () { simpanKriteria(Number(b.getAttribute("data-krisimpan")), b); });
      });
    } catch (e) { handleErr(e); }
  }

  async function simpanKriteria(id, btn) {
    var card = $("kri-" + id);
    var msg = card.querySelector('[data-krimsg="' + id + '"]');
    msg.textContent = "";
    function val(f) { return card.querySelector('[data-f="' + f + '"]').value; }
    var body = {
      nama: val("nama").trim(),
      deskripsi: val("deskripsi").trim(),
      skor_min: Number(val("skor_min")),
      skor_max: Number(val("skor_max")),
      skor_default: Number(val("skor_default"))
    };
    if (body.skor_min > body.skor_max) { msg.textContent = "⚠️ Min tidak boleh lebih dari Max."; return; }
    if (body.skor_default < body.skor_min || body.skor_default > body.skor_max) { msg.textContent = "⚠️ Default harus di dalam rentang Min–Max."; return; }
    btn.disabled = true; btn.textContent = "Menyimpan…";
    try {
      await apiJson("/api/kriteria/" + id, "PUT", body);
      msg.textContent = "✅ Tersimpan.";
    } catch (e) { msg.textContent = "❌ " + e.message; }
    finally { btn.disabled = false; btn.textContent = "💾 Simpan kriteria"; }
  }

  // ---------- HASIL ----------
  $("btn-hasil").addEventListener("click", async function () {
    var id = $("hasil-kelas").value;
    if (!id) { showAlert("Pilih kelas dulu."); return; }
    var area = $("hasil-area");
    area.innerHTML = '<div class="card"><div class="loading"><span class="spinner"></span><br>Menghitung hasil…</div></div>';
    try {
      var d = await apiJson("/api/hasil?kelas_id=" + id);
      state.hasilData = d;
      state.hasilKelasId = id;
      var sel = $("hasil-kelas");
      state.hasilKelasNama = sel.options[sel.selectedIndex].text;
      renderHasil(d);
      loadBeritaAcara(id);
    } catch (e) { handleErr(e); }
  });

  $("hasil-kelas").addEventListener("change", function () {
    state.hasilData = null;
    $("hasil-area").innerHTML = "";
  });

  function renderHasil(d) {
    var kats = d.kategori || [];
    var lengkap = d.hasil.filter(function (h) { return h.lengkap; });
    var belum = d.hasil.filter(function (h) { return !h.lengkap; });
    var head = "<tr><th>Peringkat</th><th>Kelompok</th><th>Cabang</th><th>Nama Produk</th>" +
      kats.map(function (k) { return '<th class="num">' + esc(k.nama) + "</th>"; }).join("") +
      '<th class="num">Total (maks 400)</th><th class="num">Juri</th></tr>';
    function row(h) {
      return "<tr" + (h.lengkap ? "" : ' class="total-belum"') + "><td>" +
        (h.peringkat != null ? "🏆 <b>" + esc(h.peringkat) + "</b>" : "—") + "</td>" +
        "<td><b>" + esc(h.nama_kelompok) + "</b></td>" +
        "<td>" + esc(h.cabang_nama || "-") + "</td>" +
        "<td>" + esc(h.nama_produk || "-") + "</td>" +
        kats.map(function (k) {
          var v = h.nilai[k.kode];
          return '<td class="num">' + (v == null ? "—" : esc(v)) + "</td>";
        }).join("") +
        '<td class="num"><b>' + (h.total == null ? "—" : esc(h.total)) + "</b></td>" +
        '<td class="num">' + esc(h.jml_juri) + "</td></tr>";
    }
    var html = '<div class="card"><h3>🏆 Peringkat — Kelas ' + esc(d.kelas.nama) + "</h3>" +
      '<div class="table-wrap"><table class="data"><thead>' + head + "</thead><tbody>" +
      lengkap.map(row).join("") +
      (belum.length ? '<tr><td colspan="' + (6 + kats.length) + '" style="background:var(--gold-soft);font-weight:700">Kelompok yang nilainya belum lengkap:</td></tr>' + belum.map(row).join("") : "") +
      "</tbody></table></div></div>";
    $("hasil-area").innerHTML = html;
  }

  $("btn-csv").addEventListener("click", async function () {
    var id = $("hasil-kelas").value;
    if (!id) { showAlert("Pilih kelas dulu."); return; }
    try {
      var r = await fetch("/api/hasil/export.csv?kelas_id=" + id, { credentials: "same-origin" });
      if (r.status === 401) { toLogin(); showAlert("Sesi berakhir. Silakan login lagi."); return; }
      if (!r.ok) {
        var dj = {};
        try { dj = await r.json(); } catch (e) {}
        throw apiErr(r.status, dj.error || "Gagal mengunduh CSV");
      }
      var blob = await r.blob();
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "hasil-" + state.hasilKelasNama.replace(/\s+/g, "") + ".csv";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } catch (e) { handleErr(e); }
  });

  // ---------- BERITA ACARA ----------
  async function loadBeritaAcara(kelasId) {
    var fields = ["nomor", "tempat", "tanggal", "tahu-nama", "tahu-nip", "tahu-jabatan", "dibuat"];
    try {
      var d = await apiJson("/api/berita-acara?kelas_id=" + kelasId);
      var ba = d.berita_acara || {};
      $("ba-nomor").value = ba.nomor || "";
      $("ba-tempat").value = ba.tempat || "";
      $("ba-tanggal").value = ba.tanggal || "";
      $("ba-tahu-nama").value = ba.mengetahui_nama || "";
      $("ba-tahu-nip").value = ba.mengetahui_nip || "";
      $("ba-tahu-jabatan").value = ba.mengetahui_jabatan || "";
      $("ba-dibuat").value = ba.dibuat_nama || "";
    } catch (e) {
      if (e.status !== 401) fields.forEach(function () {});
      if (e.status === 401) { toLogin(); }
    }
  }

  $("form-ba").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    if (!state.hasilKelasId) { showAlert("Pilih kelas dan tampilkan hasil dulu."); return; }
    var body = {
      kelas_id: Number(state.hasilKelasId),
      nomor: $("ba-nomor").value.trim(),
      tempat: $("ba-tempat").value.trim(),
      tanggal: $("ba-tanggal").value.trim(),
      mengetahui_nama: $("ba-tahu-nama").value.trim(),
      mengetahui_nip: $("ba-tahu-nip").value.trim(),
      mengetahui_jabatan: $("ba-tahu-jabatan").value.trim(),
      dibuat_nama: $("ba-dibuat").value.trim()
    };
    try {
      await apiJson("/api/berita-acara", "PUT", body);
      showAlert("Berita acara disimpan.", "success");
    } catch (e) { handleErr(e); }
  });

  $("btn-cetak").addEventListener("click", function () {
    if (!state.hasilData || !state.hasilKelasId) { showAlert("Pilih kelas dan tampilkan hasil dulu."); return; }
    renderBeritaAcara();
    window.print();
  });

  function renderBeritaAcara() {
    var d = state.hasilData;
    var kats = d.kategori || [];
    var lengkap = d.hasil.filter(function (h) { return h.lengkap; });
    var juara = lengkap.slice(0, 3);
    var juaraLabel = ["Juara 1", "Juara 2", "Juara 3"];
    var nomor = $("ba-nomor").value.trim();
    var tempat = $("ba-tempat").value.trim();
    var tanggal = $("ba-tanggal").value.trim();
    var tahuNama = $("ba-tahu-nama").value.trim();
    var tahuNip = $("ba-tahu-nip").value.trim();
    var tahuJabatan = $("ba-tahu-jabatan").value.trim();
    var dibuat = $("ba-dibuat").value.trim();

    var h = "<h2>BERITA ACARA HASIL PENILAIAN PROJEK</h2>" +
      '<div class="ba-nomor">Nomor: ' + esc(nomor || "—") + "</div>" +
      "<p>Pada hari ini, <b>" + esc(tanggal || "—") + "</b>, bertempat di <b>" + esc(tempat || "—") +
      "</b>, telah dilaksanakan penilaian projek siswa <b>Kelas " + esc(d.kelas.nama) + "</b> " +
      "(produk olahan nanas dan makanan ringan) oleh dewan juri. " +
      "Penilaian meliputi 4 kategori: " + esc(kats.map(function (k) { return k.nama; }).join(", ")) +
      ", masing-masing dengan skala 0–100. Berdasarkan rekapitulasi nilai, ditetapkan peringkat sebagai berikut:</p>";

    h += "<h3>A. Juara</h3><table><thead><tr><th>Juara</th><th>Kelompok</th><th>Produk</th><th>Total Nilai</th></tr></thead><tbody>";
    juara.forEach(function (j, i) {
      h += "<tr><td>" + juaraLabel[i] + "</td><td>" + esc(j.nama_kelompok) + "</td><td>" + esc(j.nama_produk || "-") + "</td><td>" + esc(j.total) + "</td></tr>";
    });
    h += "</tbody></table>";

    h += "<h3>B. Daftar Lengkap Hasil Penilaian</h3><table><thead><tr><th>No</th><th>Kelompok</th><th>Cabang</th><th>Nama Produk</th>" +
      kats.map(function (k) { return "<th>" + esc(k.nama) + "</th>"; }).join("") +
      "<th>Total</th></tr></thead><tbody>";
    d.hasil.forEach(function (r, i) {
      h += "<tr><td>" + (i + 1) + "</td><td>" + esc(r.nama_kelompok) + "</td>" +
        "<td>" + esc(r.cabang_nama || "-") + "</td>" +
        "<td>" + esc(r.nama_produk || "-") + "</td>" +
        kats.map(function (k) {
          var v = r.nilai[k.kode];
          return "<td>" + (v == null ? "—" : esc(v)) + "</td>";
        }).join("") +
        "<td><b>" + (r.total == null ? "—" : esc(r.total)) + "</b></td></tr>";
    });
    h += "</tbody></table>";

    h += "<p>Demikian berita acara ini dibuat dengan sebenarnya untuk dipergunakan sebagaimana mestinya.</p>";
    h += '<div class="ba-sign"><div>Mengetahui,<br>' + esc(tahuJabatan || "—") +
      '<div class="ttd-space"></div><b><u>' + esc(tahuNama || "—") + "</u></b><br>NIP. " + esc(tahuNip || "—") + "</div>" +
      "<div>" + esc(tempat || "—") + ", " + esc(tanggal || "—") + "<br>Dibuat oleh," +
      '<div class="ttd-space"></div><b><u>' + esc(dibuat || "—") + "</u></b></div></div>";

    $("ba-doc").innerHTML = h;
  }

  // ---------- start ----------
  boot();
})();
