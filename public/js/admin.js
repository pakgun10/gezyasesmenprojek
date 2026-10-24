/* Penilaian Projek — panel Admin (vanilla JS, tanpa module) */
(function () {
  "use strict";

  var loaded = {};
  var state = { hasilData: null, hasilKelasId: null, hasilKelasNama: "", siswaKelompokId: null };
  // Halaman Kelas 8 / Kelas 9 memakai panel projek yang sama; yang berbeda
  // hanya saringan tingkatnya (projekSemua = saringan dimatikan sementara).
  var projekTingkat = null;
  var projekSemua = false;

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
    var panelId = (name === "kelas8" || name === "kelas9") ? "kelas89" : name;
    document.querySelectorAll(".tab-panel").forEach(function (p) {
      p.classList.toggle("active", p.id === "tab-" + panelId);
    });
    showAlert(null);
    if (name === "dasbor") loadDasbor();
    else if (name === "kelas") loadKelasTab();
    else if (name === "kelas8" || name === "kelas9") {
      projekTingkat = name === "kelas8" ? "8" : "9";
      projekSemua = false;
      perbaruiJudulProjek();
      loadKelompokTab();
      loadCabangTab();
      loadKriteriaTab();
      // hasil projek dimuat manual via tombol di panelnya
    }
    else if (name === "murid") loadMuridTab();
    else if (name === "juri") loadJuriTab();
    else if (name === "senam") loadSenamTab();
    else if (name === "log") loadLogTab();
    else if (name === "akun") loadAkunTab();
  }

  function perbaruiJudulProjek() {
    var ikon = projekTingkat === "9" ? "🚀" : "💡";
    var label = projekSemua ? "Semua Tingkat" : "Kelas " + projekTingkat;
    $("projek-judul").textContent = ikon + " Penilaian Projek — " + label;
    $("projek-tingkat-label").textContent = projekSemua ? "semua tingkat (saringan dimatikan)" : "Kelas " + projekTingkat;
    $("btn-projek-semua").textContent = projekSemua ? "↩️ Kembali ke Kelas " + projekTingkat + " saja" : "👀 Tampilkan semua tingkat";
  }

  $("btn-projek-semua").addEventListener("click", function () {
    projekSemua = !projekSemua;
    perbaruiJudulProjek();
    fillKelasSelects();
    loadKelompokTable();
  });

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
        ["🧑‍⚖️", d.total_juri, "Penilai"],
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
    function opsi(dft) {
      return dft.map(function (k) { return '<option value="' + k.id + '">' + esc(k.nama) + "</option>"; }).join("");
    }
    var opts = opsi(list);
    // Dropdown panel projek (Kelas 8/9) tersaring tingkat aktif; selebihnya semua.
    var listProjek = (projekTingkat && !projekSemua) ? list.filter(function (k) { return String(k.tingkat) === projekTingkat; }) : list;
    var optsProjek = opsi(listProjek);
    var labelSemua = projekTingkat && !projekSemua ? "Semua kelas tingkat " + projekTingkat : "Semua kelas";
    var curF = $("flt-kelas").value;
    $("flt-kelas").innerHTML = '<option value="">' + labelSemua + "</option>" + optsProjek;
    if (curF && listProjek.some(function (k) { return String(k.id) === curF; })) $("flt-kelas").value = curF;
    $("kelompok-kelas").innerHTML = optsProjek || '<option value="">(belum ada kelas tingkat ini)</option>';
    var cur = $("hasil-kelas").value;
    $("hasil-kelas").innerHTML = '<option value="">— pilih —</option>' + optsProjek;
    if (cur && listProjek.some(function (k) { return String(k.id) === cur; })) $("hasil-kelas").value = cur;
    // dropdown modul senam (Kelas 7) — tampil semua tingkat, tidak dikunci
    $("senam-kelompok-kelas").innerHTML = opts || '<option value="">(belum ada kelas)</option>';
    var curS = $("senam-hasil-kelas").value;
    $("senam-hasil-kelas").innerHTML = '<option value="">— pilih —</option>' + opts;
    if (curS) $("senam-hasil-kelas").value = curS;
    // dropdown menu Murid
    var curM = $("murid-kelas").value;
    $("murid-kelas").innerHTML = opts || '<option value="">(belum ada kelas)</option>';
    if (curM) $("murid-kelas").value = curM;
    var curMF = $("murid-flt-kelas").value;
    $("murid-flt-kelas").innerHTML = '<option value="">Semua kelas</option>' + opts;
    if (curMF) $("murid-flt-kelas").value = curMF;
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
      if (projekTingkat && !projekSemua && !kelasId) {
        list = list.filter(function (g) { return String(g.tingkat) === projekTingkat; });
      }
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

  // ----- ceklis murid (dipakai panel siswa projek & anggota senam) -----
  // Pilihan datang dari GET /api/murid/pilihan — hanya murid terdaftar di
  // menu Murid pada rombel kelompok itu. Tidak ada ketik nama bebas.
  function renderCeklis(prefix, pilihan) {
    var box = $(prefix + "-rows");
    box.innerHTML = "";
    if (!pilihan.length) {
      box.innerHTML = '<div class="muted small" style="padding:8px 4px">Belum ada murid terdaftar untuk rombel ini. Tambahkan dulu lewat menu 🎒 Murid.</div>';
    }
    pilihan.forEach(function (m) {
      var lab = document.createElement("label");
      lab.className = "cek-item" + (m.status === "kelompok_lain" ? " cek-terpakai" : "");
      lab.setAttribute("data-nama", (m.nama || "").toLowerCase());
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = m.id;
      cb.checked = m.status === "kelompok_ini";
      cb.disabled = m.status === "kelompok_lain";
      cb.addEventListener("change", function () { perbaruiHitungCeklis(prefix, cb); });
      var nm = document.createElement("span");
      nm.className = "cek-nama";
      nm.textContent = m.nama;
      lab.appendChild(cb);
      lab.appendChild(nm);
      if (m.nis) {
        var nis = document.createElement("span");
        nis.className = "badge badge-blue";
        nis.textContent = "NIS " + m.nis;
        lab.appendChild(nis);
      }
      if (m.status === "kelompok_lain") {
        var dipakai = document.createElement("span");
        dipakai.className = "muted small";
        dipakai.textContent = "sudah di " + (m.kelompok_nama || "kelompok lain");
        lab.appendChild(dipakai);
      }
      box.appendChild(lab);
    });
    perbaruiHitungCeklis(prefix, null);
    var cari = $(prefix + "-cari");
    cari.value = "";
    cari.oninput = function () {
      var q = cari.value.trim().toLowerCase();
      box.querySelectorAll(".cek-item").forEach(function (it) {
        it.classList.toggle("cek-sembunyi", !!q && it.getAttribute("data-nama").indexOf(q) < 0);
      });
    };
  }

  function perbaruiHitungCeklis(prefix, cbBaru) {
    var box = $(prefix + "-rows");
    var tercentang = box.querySelectorAll('input[type="checkbox"]:checked');
    if (cbBaru && cbBaru.checked && tercentang.length > 12) {
      cbBaru.checked = false;
      showAlert("Maksimal 12 murid per kelompok.");
      tercentang = box.querySelectorAll('input[type="checkbox"]:checked');
    }
    $(prefix + "-terpilih").textContent = tercentang.length;
  }

  function ambilCeklisIds(prefix) {
    var ids = [];
    $(prefix + "-rows").querySelectorAll('input[type="checkbox"]:checked').forEach(function (cb) {
      ids.push(Number(cb.value));
    });
    return ids;
  }

  // ----- kelola siswa (projek) -----
  async function bukaSiswaPanel(id) {
    try {
      var d = await apiJson("/api/murid/pilihan?modul=projek&kelompok_id=" + id);
      state.siswaKelompokId = id;
      var det = await apiJson("/api/kelompok/" + id);
      $("siswa-kelompok-nama").textContent = det.kelompok.nama_kelompok + " (Kelas " + det.kelompok.kelas_nama + ")";
      renderCeklis("siswa", d.pilihan || []);
      $("siswa-panel").classList.remove("hidden");
      $("siswa-panel").scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) { handleErr(e); }
  }

  $("btn-siswa-tutup").addEventListener("click", function () {
    $("siswa-panel").classList.add("hidden");
    state.siswaKelompokId = null;
  });
  $("btn-ke-murid").addEventListener("click", function () { switchTab("murid"); });
  $("btn-siswa-simpan").addEventListener("click", async function () {
    var ids = ambilCeklisIds("siswa");
    if (ids.length < 4) { showAlert("Minimal 4 murid per kelompok (tercentang: " + ids.length + ")."); return; }
    if (ids.length > 12) { showAlert("Maksimal 12 murid per kelompok."); return; }
    try {
      var r = await apiJson("/api/kelompok/" + state.siswaKelompokId + "/siswa", "PUT", { murid_ids: ids });
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

  // ---------- MURID (master data) ----------
  function resetMuridForm() {
    $("murid-id").value = "";
    $("murid-nama").value = "";
    $("murid-nis").value = "";
    $("murid-form-title").textContent = "Tambah Murid";
    $("murid-submit").textContent = "Tambah";
    $("murid-batal").classList.add("hidden");
  }

  async function loadMuridTab() {
    resetMuridForm();
    try {
      if (!window.__kelasCache) {
        var d = await apiJson("/api/kelas");
        window.__kelasCache = d.kelas || [];
      }
      fillKelasSelects();
    } catch (e) { handleErr(e); return; }
    loadMuridTable();
  }

  async function loadMuridTable() {
    var tb = $("tbl-murid").querySelector("tbody");
    tb.innerHTML = loadingRow(6, "Memuat murid…");
    var kelasId = $("murid-flt-kelas").value;
    var q = $("murid-q").value.trim();
    var url = "/api/murid?" + (kelasId ? "kelas_id=" + encodeURIComponent(kelasId) + "&" : "") + "q=" + encodeURIComponent(q);
    try {
      var d = await apiJson(url);
      var list = d.murid || [];
      $("murid-count").textContent = "(" + list.length + " murid)";
      tb.innerHTML = list.map(function (m) {
        return "<tr><td><b>" + esc(m.nama) + "</b></td>" +
          "<td>" + esc(m.kelas_nama) + "</td>" +
          "<td>" + esc(m.nis || "-") + "</td>" +
          "<td>" + (m.kelompok_projek ? '<span class="badge badge-blue">' + esc(m.kelompok_projek) + "</span>" : '<span class="muted">—</span>') + "</td>" +
          "<td>" + (m.kelompok_senam ? '<span class="badge badge-blue">' + esc(m.kelompok_senam) + "</span>" : '<span class="muted">—</span>') + "</td>" +
          '<td style="white-space:nowrap"><button type="button" class="btn btn-ghost btn-sm" data-medit="' + m.id + '">✏️</button> ' +
          '<button type="button" class="btn btn-danger btn-sm" data-mdel="' + m.id + '">🗑️</button></td></tr>';
      }).join("") || '<tr><td colspan="6" class="muted">Belum ada murid. Tambahkan lewat form di atas atau impor CSV.</td></tr>';
      tb.querySelectorAll("[data-medit]").forEach(function (b) {
        b.addEventListener("click", function () { editMurid(Number(b.getAttribute("data-medit"))); });
      });
      tb.querySelectorAll("[data-mdel]").forEach(function (b) {
        b.addEventListener("click", function () { hapusMurid(Number(b.getAttribute("data-mdel"))); });
      });
      window.__muridCache = list;
    } catch (e) { handleErr(e); }
  }

  function editMurid(id) {
    var m = (window.__muridCache || []).find(function (x) { return x.id === id; });
    if (!m) return;
    $("murid-id").value = m.id;
    $("murid-kelas").value = m.kelas_id;
    $("murid-nama").value = m.nama;
    $("murid-nis").value = m.nis || "";
    $("murid-form-title").textContent = "Ubah Murid";
    $("murid-submit").textContent = "💾 Simpan";
    $("murid-batal").classList.remove("hidden");
    window.scrollTo(0, 0);
  }

  async function hapusMurid(id) {
    var m = (window.__muridCache || []).find(function (x) { return x.id === id; });
    if (!confirm("Hapus murid \"" + (m ? m.nama : id) + "\" dari daftar induk?")) return;
    try {
      await apiJson("/api/murid/" + id, "DELETE");
      showAlert("Murid dihapus.", "success");
      loadMuridTable();
    } catch (e) { handleErr(e); }
  }

  $("form-murid").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var id = $("murid-id").value;
    var body = {
      kelas_id: Number($("murid-kelas").value),
      nama: $("murid-nama").value.trim(),
      nis: $("murid-nis").value.trim()
    };
    if (!body.kelas_id) { showAlert("Pilih kelas dulu (tambahkan kelas di menu Kelas bila belum ada)."); return; }
    try {
      if (id) await apiJson("/api/murid/" + id, "PUT", body);
      else await apiJson("/api/murid", "POST", body);
      showAlert(id ? "Murid diperbarui." : "Murid ditambahkan.", "success");
      resetMuridForm();
      loadMuridTable();
    } catch (e) { handleErr(e); }
  });
  $("murid-batal").addEventListener("click", resetMuridForm);
  $("btn-murid-cari").addEventListener("click", loadMuridTable);
  $("murid-flt-kelas").addEventListener("change", loadMuridTable);
  var muridCariT = null;
  $("murid-q").addEventListener("input", function () {
    clearTimeout(muridCariT);
    muridCariT = setTimeout(loadMuridTable, 500);
  });

  $("btn-murid-import").addEventListener("click", async function () {
    var csv = $("murid-csv-text").value;
    var box = $("murid-import-hasil");
    box.innerHTML = "";
    if (!csv.trim()) { showAlert("Tempel isi CSV murid dulu."); return; }
    var btn = $("btn-murid-import");
    btn.disabled = true; btn.textContent = "Mengimpor…";
    try {
      var r = await apiJson("/api/murid/import", "POST", { csv: csv });
      var html = '<div class="alert alert-success">✅ Berhasil diimpor: <b>' + esc(r.diimpor) + "</b> murid.</div>";
      if ((r.peringatan || []).length) {
        html += '<div class="alert alert-info">⚠️ Dilewati:<br>' + r.peringatan.map(function (p) { return "• " + esc(p); }).join("<br>") + "</div>";
      }
      box.innerHTML = html;
      $("murid-csv-text").value = "";
      loadMuridTable();
    } catch (e) {
      box.innerHTML = '<div class="alert alert-error">❌ ' + esc(e.message) + "</div>";
    } finally {
      btn.disabled = false; btn.textContent = "⬆️ Impor Murid";
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
    $("juri-form-title").textContent = "Tambah Penilai";
    $("juri-submit").textContent = "Tambah";
    $("juri-batal").classList.add("hidden");
  }

  async function loadJuriTab() {
    resetJuriForm();
    var tb = $("tbl-juri").querySelector("tbody");
    tb.innerHTML = loadingRow(5, "Memuat penilai…");
    try {
      var d = await apiJson("/api/juri");
      tb.innerHTML = (d.juri || []).map(function (j) {
        return "<tr><td><b>" + esc(j.kode) + "</b></td><td>" + esc(j.nama) + "</td>" +
          "<td>" + esc(j.keterangan || "-") + "</td>" +
          '<td class="num">' + esc(j.jml_kelompok_dinilai) + "</td>" +
          '<td style="white-space:nowrap"><button type="button" class="btn btn-ghost btn-sm" data-jedit="' + j.id + '">✏️</button> ' +
          '<button type="button" class="btn btn-danger btn-sm" data-jdel="' + j.id + '">🗑️</button></td></tr>';
      }).join("") || '<tr><td colspan="5" class="muted">Belum ada penilai.</td></tr>';
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
      $("juri-form-title").textContent = "Ubah Penilai";
      $("juri-submit").textContent = "💾 Simpan";
      $("juri-batal").classList.remove("hidden");
      window.scrollTo(0, 0);
    } catch (e) { handleErr(e); }
  }

  async function hapusJuri(id) {
    if (!confirm("Hapus penilai ini? Semua nilai dan fotonya ikut terhapus!")) return;
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
      showAlert(id ? "Penilai diperbarui." : "Penilai ditambahkan.", "success");
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
      '<th class="num">Total (maks 400)</th><th class="num">Penilai</th></tr>';
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
      "(produk olahan nanas dan makanan ringan) oleh dewan penilai. " +
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

  // =======================================================================
  // ---------- SENAM (modul sejajar — semua endpoint /api/senam/*) ----------
  // =======================================================================
  var senamState = { hasilData: null, hasilKelasId: null, hasilKelasNama: "", anggotaKelompokId: null };

  async function loadSenamTab() {
    resetSenamKelompokForm();
    $("senam-anggota-panel").classList.add("hidden");
    try {
      if (!window.__kelasCache) {
        var d = await apiJson("/api/kelas");
        window.__kelasCache = d.kelas || [];
      }
      fillKelasSelects();
    } catch (e) { handleErr(e); return; }
    loadSenamKelompokTable();
    loadSenamKriteria();
  }

  // ----- kelompok senam -----
  function resetSenamKelompokForm() {
    $("senam-kelompok-id").value = "";
    $("senam-kelompok-nama").value = "";
    $("senam-kelompok-judul").value = "";
    $("senam-kelompok-form-title").textContent = "Tambah Kelompok Senam";
    $("senam-kelompok-submit").textContent = "Tambah";
    $("senam-kelompok-batal").classList.add("hidden");
  }

  async function loadSenamKelompokTable() {
    var tb = $("tbl-senam-kelompok").querySelector("tbody");
    tb.innerHTML = loadingRow(7, "Memuat kelompok senam…");
    try {
      var d = await apiJson("/api/senam/kelompok");
      var list = d.kelompok || [];
      $("senam-kelompok-count").textContent = "(" + list.length + " kelompok)";
      tb.innerHTML = list.map(function (g) {
        return "<tr><td><b>" + esc(g.nama_kelompok) + "</b></td>" +
          "<td>" + esc(g.kelas_nama) + "</td>" +
          "<td>" + esc(g.judul_penampilan || "-") + "</td>" +
          '<td class="num">' + esc(g.jml_anggota) + '</td><td class="num">' + esc(g.jml_juri) + '</td><td class="num">' + esc(g.jml_foto) + "</td>" +
          '<td style="white-space:nowrap">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-sgedit="' + g.id + '" title="Ubah">✏️</button> ' +
          '<button type="button" class="btn btn-ghost btn-sm" data-sgota="' + g.id + '" title="Kelola anggota">👥</button> ' +
          '<button type="button" class="btn btn-danger btn-sm" data-sgdel="' + g.id + '" title="Hapus">🗑️</button></td></tr>';
      }).join("") || '<tr><td colspan="7" class="muted">Belum ada kelompok senam. Tambahkan lewat form di atas.</td></tr>';
      tb.querySelectorAll("[data-sgedit]").forEach(function (b) {
        b.addEventListener("click", function () { editSenamKelompok(Number(b.getAttribute("data-sgedit"))); });
      });
      tb.querySelectorAll("[data-sgota]").forEach(function (b) {
        b.addEventListener("click", function () { bukaSenamAnggotaPanel(Number(b.getAttribute("data-sgota"))); });
      });
      tb.querySelectorAll("[data-sgdel]").forEach(function (b) {
        b.addEventListener("click", function () { hapusSenamKelompok(Number(b.getAttribute("data-sgdel"))); });
      });
    } catch (e) { handleErr(e); }
  }

  async function editSenamKelompok(id) {
    try {
      var d = await apiJson("/api/senam/kelompok/" + id);
      var g = d.kelompok;
      $("senam-kelompok-id").value = g.id;
      $("senam-kelompok-kelas").value = g.kelas_id;
      $("senam-kelompok-nama").value = g.nama_kelompok;
      $("senam-kelompok-judul").value = g.judul_penampilan || "";
      $("senam-kelompok-form-title").textContent = "Ubah Kelompok Senam";
      $("senam-kelompok-submit").textContent = "💾 Simpan";
      $("senam-kelompok-batal").classList.remove("hidden");
      window.scrollTo(0, 0);
    } catch (e) { handleErr(e); }
  }

  async function hapusSenamKelompok(id) {
    if (!confirm("Hapus kelompok senam ini? Anggota, nilai, dan fotonya ikut terhapus!")) return;
    try {
      await apiJson("/api/senam/kelompok/" + id, "DELETE");
      loadSenamKelompokTable();
    } catch (e) { handleErr(e); }
  }

  $("form-senam-kelompok").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var id = $("senam-kelompok-id").value;
    var body = {
      kelas_id: Number($("senam-kelompok-kelas").value),
      nama_kelompok: $("senam-kelompok-nama").value.trim(),
      judul_penampilan: $("senam-kelompok-judul").value.trim()
    };
    if (!body.kelas_id) { showAlert("Pilih kelas dulu (tambahkan kelas di tab Kelas bila belum ada)."); return; }
    try {
      if (id) await apiJson("/api/senam/kelompok/" + id, "PUT", body);
      else await apiJson("/api/senam/kelompok", "POST", body);
      showAlert(id ? "Kelompok senam diperbarui." : "Kelompok senam ditambahkan.", "success");
      resetSenamKelompokForm();
      loadSenamKelompokTable();
    } catch (e) { handleErr(e); }
  });
  $("senam-kelompok-batal").addEventListener("click", resetSenamKelompokForm);

  // ----- kelola anggota senam (ceklis dari menu Murid, pola sama projek) -----
  async function bukaSenamAnggotaPanel(id) {
    try {
      var d = await apiJson("/api/murid/pilihan?modul=senam&kelompok_id=" + id);
      senamState.anggotaKelompokId = id;
      var det = await apiJson("/api/senam/kelompok/" + id);
      $("senam-anggota-kelompok-nama").textContent = det.kelompok.nama_kelompok + " (Kelas " + det.kelompok.kelas_nama + ")";
      renderCeklis("senam-anggota", d.pilihan || []);
      $("senam-anggota-panel").classList.remove("hidden");
      $("senam-anggota-panel").scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) { handleErr(e); }
  }

  $("btn-senam-anggota-tutup").addEventListener("click", function () {
    $("senam-anggota-panel").classList.add("hidden");
    senamState.anggotaKelompokId = null;
  });
  $("btn-senam-ke-murid").addEventListener("click", function () { switchTab("murid"); });
  $("btn-senam-anggota-simpan").addEventListener("click", async function () {
    var ids = ambilCeklisIds("senam-anggota");
    if (ids.length < 4) { showAlert("Minimal 4 murid per kelompok senam (tercentang: " + ids.length + ")."); return; }
    if (ids.length > 12) { showAlert("Maksimal 12 murid per kelompok senam."); return; }
    try {
      var r = await apiJson("/api/senam/kelompok/" + senamState.anggotaKelompokId + "/anggota", "PUT", { murid_ids: ids });
      showAlert("Daftar anggota disimpan (" + r.jumlah + " murid).", "success");
      loadSenamKelompokTable();
    } catch (e) { handleErr(e); }
  });

  // ----- kriteria senam -----
  async function loadSenamKriteria() {
    var box = $("senam-kriteria-list");
    box.innerHTML = '<div class="loading"><span class="spinner"></span><br>Memuat kriteria senam…</div>';
    try {
      var d = await apiJson("/api/senam/kategori");
      box.innerHTML = (d.kategori || []).map(function (kat) {
        var kris = (kat.kriteria || []).map(function (kr) {
          return '<div class="card" id="skri-' + kr.id + '">' +
            '<div class="form-group"><label>Nama kriteria</label><input type="text" data-f="nama" value="' + esc(kr.nama) + '"></div>' +
            '<div class="form-group"><label>Deskripsi</label><input type="text" data-f="deskripsi" value="' + esc(kr.deskripsi) + '"></div>' +
            '<div class="form-row">' +
            '<div class="form-group"><label>Min</label><input type="number" data-f="skor_min" min="0" max="100" value="' + esc(kr.skor_min) + '"></div>' +
            '<div class="form-group"><label>Max</label><input type="number" data-f="skor_max" min="0" max="100" value="' + esc(kr.skor_max) + '"></div>' +
            '<div class="form-group"><label>Default</label><input type="number" data-f="skor_default" min="0" max="100" value="' + esc(kr.skor_default) + '"></div>' +
            "</div>" +
            '<button type="button" class="btn btn-primary btn-sm" data-skrisimpan="' + kr.id + '">💾 Simpan kriteria</button> ' +
            '<span class="small muted" data-skrimsg="' + kr.id + '"></span>' +
            "</div>";
        }).join("");
        return '<div class="card"><h3>🎯 ' + esc(kat.nama) + "</h3>" + kris + "</div>";
      }).join("");
      box.querySelectorAll("[data-skrisimpan]").forEach(function (b) {
        b.addEventListener("click", function () { simpanSenamKriteria(Number(b.getAttribute("data-skrisimpan")), b); });
      });
    } catch (e) { handleErr(e); }
  }

  async function simpanSenamKriteria(id, btn) {
    var card = $("skri-" + id);
    var msg = card.querySelector('[data-skrimsg="' + id + '"]');
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
      await apiJson("/api/senam/kriteria/" + id, "PUT", body);
      msg.textContent = "✅ Tersimpan.";
    } catch (e) { msg.textContent = "❌ " + e.message; }
    finally { btn.disabled = false; btn.textContent = "💾 Simpan kriteria"; }
  }

  // ----- hasil senam -----
  $("btn-senam-hasil").addEventListener("click", async function () {
    var id = $("senam-hasil-kelas").value;
    if (!id) { showAlert("Pilih kelas dulu."); return; }
    var area = $("senam-hasil-area");
    area.innerHTML = '<div class="card"><div class="loading"><span class="spinner"></span><br>Menghitung hasil…</div></div>';
    try {
      var d = await apiJson("/api/senam/hasil?kelas_id=" + id);
      senamState.hasilData = d;
      senamState.hasilKelasId = id;
      var sel = $("senam-hasil-kelas");
      senamState.hasilKelasNama = sel.options[sel.selectedIndex].text;
      renderSenamHasil(d);
      loadSenamBeritaAcara(id);
    } catch (e) { handleErr(e); }
  });

  $("senam-hasil-kelas").addEventListener("change", function () {
    senamState.hasilData = null;
    $("senam-hasil-area").innerHTML = "";
  });

  function renderSenamHasil(d) {
    var kats = d.kategori || [];
    var lengkap = d.hasil.filter(function (h) { return h.lengkap; });
    var belum = d.hasil.filter(function (h) { return !h.lengkap; });
    var head = "<tr><th>Peringkat</th><th>Kelompok</th><th>Judul Penampilan</th>" +
      kats.map(function (k) { return '<th class="num">' + esc(k.nama) + "</th>"; }).join("") +
      '<th class="num">Total (maks 400)</th><th class="num">Penilai</th></tr>';
    function row(h) {
      return "<tr" + (h.lengkap ? "" : ' class="total-belum"') + "><td>" +
        (h.peringkat != null ? "🏆 <b>" + esc(h.peringkat) + "</b>" : "—") + "</td>" +
        "<td><b>" + esc(h.nama_kelompok) + "</b></td>" +
        "<td>" + esc(h.judul_penampilan || "-") + "</td>" +
        kats.map(function (k) {
          var v = h.nilai[k.kode];
          return '<td class="num">' + (v == null ? "—" : esc(v)) + "</td>";
        }).join("") +
        '<td class="num"><b>' + (h.total == null ? "—" : esc(h.total)) + "</b></td>" +
        '<td class="num">' + esc(h.jml_juri) + "</td></tr>";
    }
    var html = '<div class="card"><h3>🏆 Peringkat Senam — Kelas ' + esc(d.kelas.nama) + "</h3>" +
      '<div class="table-wrap"><table class="data"><thead>' + head + "</thead><tbody>" +
      lengkap.map(row).join("") +
      (belum.length ? '<tr><td colspan="' + (5 + kats.length) + '" style="background:var(--gold-soft);font-weight:700">Kelompok yang nilainya belum lengkap:</td></tr>' + belum.map(row).join("") : "") +
      "</tbody></table></div></div>";
    $("senam-hasil-area").innerHTML = html;
  }

  $("btn-senam-csv").addEventListener("click", async function () {
    var id = $("senam-hasil-kelas").value;
    if (!id) { showAlert("Pilih kelas dulu."); return; }
    try {
      var r = await fetch("/api/senam/hasil/export.csv?kelas_id=" + id, { credentials: "same-origin" });
      if (r.status === 401) { toLogin(); showAlert("Sesi berakhir. Silakan login lagi."); return; }
      if (!r.ok) {
        var dj = {};
        try { dj = await r.json(); } catch (e) {}
        throw apiErr(r.status, dj.error || "Gagal mengunduh CSV");
      }
      var blob = await r.blob();
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "hasil-senam-" + senamState.hasilKelasNama.replace(/\s+/g, "") + ".csv";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } catch (e) { handleErr(e); }
  });

  // ----- berita acara senam -----
  async function loadSenamBeritaAcara(kelasId) {
    try {
      var d = await apiJson("/api/senam/berita-acara?kelas_id=" + kelasId);
      var ba = d.berita_acara || {};
      $("senam-ba-nomor").value = ba.nomor || "";
      $("senam-ba-tempat").value = ba.tempat || "";
      $("senam-ba-tanggal").value = ba.tanggal || "";
      $("senam-ba-tahu-nama").value = ba.mengetahui_nama || "";
      $("senam-ba-tahu-nip").value = ba.mengetahui_nip || "";
      $("senam-ba-tahu-jabatan").value = ba.mengetahui_jabatan || "";
      $("senam-ba-dibuat").value = ba.dibuat_nama || "";
    } catch (e) {
      if (e.status === 401) { toLogin(); }
    }
  }

  $("form-senam-ba").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    if (!senamState.hasilKelasId) { showAlert("Pilih kelas dan tampilkan hasil senam dulu."); return; }
    var body = {
      kelas_id: Number(senamState.hasilKelasId),
      nomor: $("senam-ba-nomor").value.trim(),
      tempat: $("senam-ba-tempat").value.trim(),
      tanggal: $("senam-ba-tanggal").value.trim(),
      mengetahui_nama: $("senam-ba-tahu-nama").value.trim(),
      mengetahui_nip: $("senam-ba-tahu-nip").value.trim(),
      mengetahui_jabatan: $("senam-ba-tahu-jabatan").value.trim(),
      dibuat_nama: $("senam-ba-dibuat").value.trim()
    };
    try {
      await apiJson("/api/senam/berita-acara", "PUT", body);
      showAlert("Berita acara senam disimpan.", "success");
    } catch (e) { handleErr(e); }
  });

  $("btn-senam-cetak").addEventListener("click", function () {
    if (!senamState.hasilData || !senamState.hasilKelasId) { showAlert("Pilih kelas dan tampilkan hasil senam dulu."); return; }
    renderSenamBeritaAcara();
    window.print();
  });

  function renderSenamBeritaAcara() {
    var d = senamState.hasilData;
    var kats = d.kategori || [];
    var lengkap = d.hasil.filter(function (h) { return h.lengkap; });
    var juara = lengkap.slice(0, 3);
    var juaraLabel = ["Juara 1", "Juara 2", "Juara 3"];
    var nomor = $("senam-ba-nomor").value.trim();
    var tempat = $("senam-ba-tempat").value.trim();
    var tanggal = $("senam-ba-tanggal").value.trim();
    var tahuNama = $("senam-ba-tahu-nama").value.trim();
    var tahuNip = $("senam-ba-tahu-nip").value.trim();
    var tahuJabatan = $("senam-ba-tahu-jabatan").value.trim();
    var dibuat = $("senam-ba-dibuat").value.trim();

    var h = "<h2>BERITA ACARA HASIL ASESMEN SENAM BERKELOMPOK</h2>" +
      '<div class="ba-nomor">Nomor: ' + esc(nomor || "—") + "</div>" +
      "<p>Pada hari ini, <b>" + esc(tanggal || "—") + "</b>, bertempat di <b>" + esc(tempat || "—") +
      "</b>, telah dilaksanakan asesmen performa senam berkelompok siswa <b>Kelas " + esc(d.kelas.nama) + "</b> " +
      "oleh dewan penilai. " +
      "Penilaian meliputi 4 kategori: " + esc(kats.map(function (k) { return k.nama; }).join(", ")) +
      ", masing-masing dengan skala 0–100. Berdasarkan rekapitulasi nilai, ditetapkan peringkat sebagai berikut:</p>";

    h += "<h3>A. Juara</h3><table><thead><tr><th>Juara</th><th>Kelompok</th><th>Judul Penampilan</th><th>Total Nilai</th></tr></thead><tbody>";
    juara.forEach(function (j, i) {
      h += "<tr><td>" + juaraLabel[i] + "</td><td>" + esc(j.nama_kelompok) + "</td><td>" + esc(j.judul_penampilan || "-") + "</td><td>" + esc(j.total) + "</td></tr>";
    });
    h += "</tbody></table>";

    h += "<h3>B. Daftar Lengkap Hasil Penilaian</h3><table><thead><tr><th>No</th><th>Kelompok</th><th>Judul Penampilan</th>" +
      kats.map(function (k) { return "<th>" + esc(k.nama) + "</th>"; }).join("") +
      "<th>Total</th></tr></thead><tbody>";
    d.hasil.forEach(function (r, i) {
      h += "<tr><td>" + (i + 1) + "</td><td>" + esc(r.nama_kelompok) + "</td>" +
        "<td>" + esc(r.judul_penampilan || "-") + "</td>" +
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

  // ---------- LOG AKTIVITAS ----------
  function fmtWaktuLog(s) {
    // created_at tersimpan sebagai UTC "YYYY-MM-DD HH:MM:SS" -> tampilkan lokal (WIB)
    var d = new Date(String(s || "").replace(" ", "T") + "Z");
    if (isNaN(d.getTime())) return esc(s || "");
    return d.toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  async function loadLogTab() {
    var tb = $("tbl-log").querySelector("tbody");
    tb.innerHTML = loadingRow(6, "Memuat log…");
    try {
      var q = $("log-q").value.trim();
      var peran = $("log-peran").value;
      var path = "/api/log?limit=300" +
        (q ? "&q=" + encodeURIComponent(q) : "") +
        (peran ? "&peran=" + encodeURIComponent(peran) : "");
      var d = await apiJson(path);
      $("log-total").textContent = d.total;
      tb.innerHTML = (d.log || []).map(function (r) {
        var badge = r.peran === "admin"
          ? '<span class="badge badge-blue">Admin</span>'
          : r.peran === "penilai"
            ? '<span class="badge badge-gold">Penilai</span>'
            : esc(r.peran || "");
        return "<tr><td style=\"white-space:nowrap\">" + fmtWaktuLog(r.created_at) + "</td>" +
          "<td>" + esc(r.aktor) + "</td><td>" + badge + "</td>" +
          "<td>" + esc(r.aksi) + "</td><td>" + esc(r.detail || "") + "</td>" +
          '<td class="muted small">' + esc(r.ip || "") + "</td></tr>";
      }).join("") || '<tr><td colspan="6" class="muted">Belum ada log yang cocok.</td></tr>';
    } catch (e) { handleErr(e); }
  }

  $("btn-log-muat").addEventListener("click", loadLogTab);
  $("log-peran").addEventListener("change", loadLogTab);
  $("log-q").addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); loadLogTab(); } });
  $("btn-log-bersih").addEventListener("click", async function () {
    if (!confirm("Hapus semua log yang berumur lebih dari 30 hari? Tindakan ini tidak bisa dibatalkan.")) return;
    try {
      var d = await apiJson("/api/log/lama?hari=30", "DELETE");
      showAlert(d.terhapus + " log lama terhapus.", "success");
      loadLogTab();
    } catch (e) { handleErr(e); }
  });

  // ---------- AKUN ADMIN ----------
  async function loadAkunTab() {
    var tb = $("tbl-akun").querySelector("tbody");
    tb.innerHTML = loadingRow(4, "Memuat akun…");
    try {
      var d = await apiJson("/api/users");
      tb.innerHTML = (d.users || []).map(function (u) {
        var saya = u.id === d.saya;
        return "<tr><td><b>" + esc(u.username) + "</b>" + (saya ? ' <span class="badge badge-green">Anda</span>' : "") + "</td>" +
          "<td>" + fmtWaktuLog(u.created_at) + "</td>" +
          '<td class="num">' + esc(u.sesi_aktif) + "</td>" +
          "<td>" +
          '<button type="button" class="btn btn-ghost btn-sm" data-areset="' + u.id + '" data-auser="' + esc(u.username) + '">🔑 Reset Password</button> ' +
          (saya ? "" : '<button type="button" class="btn btn-danger btn-sm" data-adel="' + u.id + '" data-auser="' + esc(u.username) + '">Hapus</button>') +
          "</td></tr>";
      }).join("") || '<tr><td colspan="4" class="muted">Belum ada akun.</td></tr>';
      tb.querySelectorAll("[data-areset]").forEach(function (b) {
        b.addEventListener("click", function () {
          $("akun-reset-id").value = b.getAttribute("data-areset");
          $("akun-reset-username").textContent = b.getAttribute("data-auser");
          $("akun-reset-password").value = "";
          $("akun-reset-password2").value = "";
          $("akun-reset-panel").classList.remove("hidden");
          $("akun-reset-panel").scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });
      tb.querySelectorAll("[data-adel]").forEach(function (b) {
        b.addEventListener("click", async function () {
          var nama = b.getAttribute("data-auser");
          if (!confirm("Hapus akun admin \"" + nama + "\"? Akun ini tidak bisa login lagi dan semua sesinya akan mati.")) return;
          try {
            await apiJson("/api/users/" + b.getAttribute("data-adel"), "DELETE");
            showAlert("Akun \"" + nama + "\" terhapus.", "success");
            loadAkunTab();
          } catch (e) { handleErr(e); }
        });
      });
    } catch (e) { handleErr(e); }
  }

  $("form-akun").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var username = $("akun-username").value.trim();
    var pw = $("akun-password").value;
    if (pw !== $("akun-password2").value) { showAlert("Ulangi password tidak sama dengan password."); return; }
    try {
      await apiJson("/api/users", "POST", { username: username, password: pw });
      showAlert("Akun admin \"" + username + "\" ditambahkan.", "success");
      $("form-akun").reset();
      loadAkunTab();
    } catch (e) { handleErr(e); }
  });

  $("akun-reset-batal").addEventListener("click", function () {
    $("akun-reset-panel").classList.add("hidden");
  });

  $("form-akun-reset").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var id = $("akun-reset-id").value;
    var nama = $("akun-reset-username").textContent;
    var pw = $("akun-reset-password").value;
    if (pw !== $("akun-reset-password2").value) { showAlert("Ulangi password baru tidak sama."); return; }
    if (!confirm("Reset password akun \"" + nama + "\"? Semua sesi akun ini akan mati dan harus login ulang.")) return;
    try {
      await apiJson("/api/users/" + id + "/password", "PUT", { password: pw });
      $("akun-reset-panel").classList.add("hidden");
      showAlert("Password akun \"" + nama + "\" sudah diganti. Bila itu akun Anda sendiri, silakan login ulang.", "success");
      loadAkunTab();
    } catch (e) { handleErr(e); }
  });

  // ---------- start ----------
  boot();
})();
