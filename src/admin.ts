import { Hono } from "hono";
import { getDb, normalisasiNama } from "./db";
import { requireAuth, clientIp } from "./auth";
import { logAktivitas, aktorAdmin } from "./log";
import { validasiPilihanMurid, parseBarisCsv } from "./murid";

const admin = new Hono();
// requireAuth dipasang per-route (bukan admin.use("*")) agar tidak bocor
// ke route sub-app lain yang di-mount di base path /api yang sama.
function sec(method: "get" | "post" | "put" | "delete", path: string, ...handlers: any[]) {
  (admin as any)[method](path, requireAuth, ...handlers);
}

function bad(c: any, msg: string, status = 400) {
  return c.json({ error: msg }, status);
}

// Catat aksi admin ke Log Aktivitas (anti-gagal, lihat src/log.ts).
function logAdmin(c: any, aksi: string, detail = "") {
  logAktivitas(aktorAdmin(c), "admin", aksi, detail, clientIp(c));
}

// ---------------------------------------------------------------- dashboard
// Rekap menggabungkan PROJEK + SENAM (perbaikan 2026-10-31: dasbor lama
// hanya menghitung tabel projek, sehingga kelas 7 selalu 0/0/0 meski
// kelompok senam sudah berisi anggota dan sudah dinilai).
// Dihitung dengan subkueri per kelas, bukan JOIN langsung, supaya
// kelompok x anggota x nilai tidak saling menggandakan hitungan.
sec("get", "/dashboard", (c) => {
  const db = getDb();
  const one = (sql: string, p: any[] = []) => (db.query(sql).get(...p) as { n: number }).n;
  const perKelas = db
    .query(
      `SELECT k.id, k.nama, k.tingkat,
              (SELECT COUNT(*) FROM kelompok WHERE kelas_id = k.id)
                + (SELECT COUNT(*) FROM senam_kelompok WHERE kelas_id = k.id) AS kelompok,
              (SELECT COUNT(*) FROM siswa s JOIN kelompok kel ON kel.id = s.kelompok_id WHERE kel.kelas_id = k.id)
                + (SELECT COUNT(*) FROM senam_anggota s JOIN senam_kelompok kel ON kel.id = s.kelompok_id WHERE kel.kelas_id = k.id) AS siswa,
              (SELECT COUNT(*) FROM penilaian p JOIN kelompok kel ON kel.id = p.kelompok_id WHERE kel.kelas_id = k.id)
                + (SELECT COUNT(*) FROM senam_penilaian p JOIN senam_kelompok kel ON kel.id = p.kelompok_id WHERE kel.kelas_id = k.id) AS nilai_masuk
       FROM kelas k
       GROUP BY k.id ORDER BY k.tingkat, k.nama`
    )
    .all();
  return c.json({
    total_kelas: one("SELECT COUNT(*) n FROM kelas"),
    total_kelompok: one("SELECT COUNT(*) n FROM kelompok") + one("SELECT COUNT(*) n FROM senam_kelompok"),
    total_siswa: one("SELECT COUNT(*) n FROM siswa") + one("SELECT COUNT(*) n FROM senam_anggota"),
    total_juri: one("SELECT COUNT(*) n FROM juri"),
    total_penilaian: one("SELECT COUNT(*) n FROM penilaian") + one("SELECT COUNT(*) n FROM senam_penilaian"),
    total_foto: one("SELECT COUNT(*) n FROM foto") + one("SELECT COUNT(*) n FROM senam_foto"),
    per_kelas: perKelas,
  });
});

// ---------------------------------------------------------------- kelas
sec("get", "/kelas", (c) => {
  // Sama seperti dasbor: gabungkan projek + senam (perbaikan 2026-10-31).
  const rows = getDb()
    .query(
      `SELECT k.*,
              (SELECT COUNT(*) FROM kelompok WHERE kelas_id = k.id)
                + (SELECT COUNT(*) FROM senam_kelompok WHERE kelas_id = k.id) AS jml_kelompok,
              (SELECT COUNT(*) FROM siswa s JOIN kelompok kel ON kel.id = s.kelompok_id WHERE kel.kelas_id = k.id)
                + (SELECT COUNT(*) FROM senam_anggota s JOIN senam_kelompok kel ON kel.id = s.kelompok_id WHERE kel.kelas_id = k.id) AS jml_siswa
       FROM kelas k
       GROUP BY k.id ORDER BY k.tingkat, k.nama`
    )
    .all();
  return c.json({ kelas: rows });
});

sec("post", "/kelas", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const nama = (b.nama || "").trim();
  const tingkat = (b.tingkat || "").trim();
  if (!nama) return bad(c, "Nama kelas wajib diisi");
  try {
    const r = getDb().query("INSERT INTO kelas (nama, tingkat) VALUES (?, ?)").run(nama, tingkat);
    logAdmin(c, "Tambah kelas", tingkat ? `${nama} (tingkat ${tingkat})` : nama);
    return c.json({ ok: true, id: Number(r.lastInsertRowid) });
  } catch {
    return bad(c, "Nama kelas sudah ada");
  }
});

sec("put", "/kelas/:id", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const nama = (b.nama || "").trim();
  const tingkat = (b.tingkat || "").trim();
  if (!nama) return bad(c, "Nama kelas wajib diisi");
  try {
    getDb().query("UPDATE kelas SET nama = ?, tingkat = ? WHERE id = ?").run(nama, tingkat, c.req.param("id"));
    logAdmin(c, "Ubah kelas", tingkat ? `${nama} (tingkat ${tingkat})` : nama);
    return c.json({ ok: true });
  } catch {
    return bad(c, "Nama kelas sudah ada");
  }
});

sec("delete", "/kelas/:id", (c) => {
  const db = getDb();
  const row = db.query("SELECT nama FROM kelas WHERE id = ?").get(c.req.param("id")) as { nama: string } | null;
  db.query("DELETE FROM kelas WHERE id = ?").run(c.req.param("id"));
  logAdmin(c, "Hapus kelas", row ? row.nama : `id ${c.req.param("id")}`);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- cabang produk
sec("get", "/cabang", (c) => {
  const rows = getDb()
    .query(
      `SELECT cp.*, (SELECT COUNT(*) FROM kelompok k WHERE k.cabang_id = cp.id) AS jml_kelompok
       FROM cabang_produk cp ORDER BY cp.urutan, cp.nama`
    )
    .all();
  return c.json({ cabang: rows });
});

function kodeDariNama(nama: string): string {
  return nama
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "cabang";
}

sec("post", "/cabang", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const nama = (b.nama || "").trim();
  const deskripsi = (b.deskripsi || "").trim();
  if (!nama) return bad(c, "Nama cabang wajib diisi");
  let kode = (b.kode || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "") || kodeDariNama(nama);
  const db = getDb();
  // Hindari kode ganda: tambah suffix angka bila perlu
  let finalKode = kode;
  let i = 2;
  while (db.query("SELECT id FROM cabang_produk WHERE kode = ?").get(finalKode)) {
    finalKode = `${kode}_${i++}`;
  }
  try {
    const r = db
      .query("INSERT INTO cabang_produk (kode, nama, deskripsi, urutan) VALUES (?, ?, ?, (SELECT COALESCE(MAX(urutan),0)+1 FROM cabang_produk))")
      .run(finalKode, nama, deskripsi);
    logAdmin(c, "Tambah cabang produk", nama);
    return c.json({ ok: true, id: Number(r.lastInsertRowid), kode: finalKode });
  } catch {
    return bad(c, "Nama cabang sudah ada");
  }
});

sec("put", "/cabang/:id", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const nama = (b.nama || "").trim();
  const deskripsi = (b.deskripsi || "").trim();
  if (!nama) return bad(c, "Nama cabang wajib diisi");
  try {
    getDb().query("UPDATE cabang_produk SET nama = ?, deskripsi = ? WHERE id = ?").run(nama, deskripsi, c.req.param("id"));
    logAdmin(c, "Ubah cabang produk", nama);
    return c.json({ ok: true });
  } catch {
    return bad(c, "Nama cabang sudah ada");
  }
});

sec("delete", "/cabang/:id", (c) => {
  const db = getDb();
  const used = (db.query("SELECT COUNT(*) n FROM kelompok WHERE cabang_id = ?").get(c.req.param("id")) as { n: number }).n;
  if (used > 0) return bad(c, `Cabang masih dipakai ${used} kelompok, tidak bisa dihapus`);
  const rowC = db.query("SELECT nama FROM cabang_produk WHERE id = ?").get(c.req.param("id")) as { nama: string } | null;
  db.query("DELETE FROM cabang_produk WHERE id = ?").run(c.req.param("id"));
  logAdmin(c, "Hapus cabang produk", rowC ? rowC.nama : `id ${c.req.param("id")}`);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- kelompok
sec("get", "/kelompok", (c) => {
  const kelasId = c.req.query("kelas_id");
  const q = (c.req.query("q") || "").trim();
  let sql = `SELECT kel.*, k.nama AS kelas_nama, k.tingkat, cp.nama AS cabang_nama,
             (SELECT COUNT(*) FROM siswa s WHERE s.kelompok_id = kel.id) AS jml_siswa,
             (SELECT COUNT(DISTINCT p.juri_id) FROM penilaian p WHERE p.kelompok_id = kel.id) AS jml_juri,
             (SELECT COUNT(*) FROM foto f WHERE f.kelompok_id = kel.id) AS jml_foto
             FROM kelompok kel JOIN kelas k ON k.id = kel.kelas_id
             LEFT JOIN cabang_produk cp ON cp.id = kel.cabang_id`;
  const where: string[] = [];
  const params: any[] = [];
  if (kelasId) {
    where.push("kel.kelas_id = ?");
    params.push(kelasId);
  }
  if (q) {
    where.push("(kel.nama_kelompok LIKE ? OR kel.nama_produk LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  if (where.length) sql += " WHERE " + where.join(" AND ");
  sql += " ORDER BY k.tingkat, k.nama, kel.nama_kelompok";
  return c.json({ kelompok: getDb().query(sql).all(...params) });
});

sec("get", "/kelompok/:id", (c) => {
  const db = getDb();
  const kel = db
    .query(
      `SELECT kel.*, k.nama AS kelas_nama, k.tingkat, cp.nama AS cabang_nama FROM kelompok kel
       JOIN kelas k ON k.id = kel.kelas_id
       LEFT JOIN cabang_produk cp ON cp.id = kel.cabang_id
       WHERE kel.id = ?`
    )
    .get(c.req.param("id"));
  if (!kel) return bad(c, "Kelompok tidak ditemukan", 404);
  const siswa = db
    .query(
      `SELECT s.id, COALESCE(m.nama, s.nama) AS nama, s.urutan, s.murid_id FROM siswa s
       LEFT JOIN murid m ON m.id = s.murid_id WHERE s.kelompok_id = ? ORDER BY s.urutan, s.id`
    )
    .all(c.req.param("id"));
  return c.json({ kelompok: kel, siswa });
});

sec("post", "/kelompok", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const kelas_id = Number(b.kelas_id);
  const nama_kelompok = (b.nama_kelompok || "").trim();
  const cabang_id = Number(b.cabang_id);
  const nama_produk = (b.nama_produk || "").trim();
  if (!kelas_id || !nama_kelompok) return bad(c, "Kelas dan nama kelompok wajib diisi");
  if (!cabang_id) return bad(c, "Cabang produk wajib dipilih");
  const db = getDb();
  if (!db.query("SELECT id FROM cabang_produk WHERE id = ?").get(cabang_id))
    return bad(c, "Cabang produk tidak dikenal");
  try {
    const r = db
      .query("INSERT INTO kelompok (kelas_id, nama_kelompok, cabang_id, nama_produk) VALUES (?, ?, ?, ?)")
      .run(kelas_id, nama_kelompok, cabang_id, nama_produk);
    logAdmin(c, "Tambah kelompok projek", nama_produk ? `${nama_kelompok} — ${nama_produk}` : nama_kelompok);
    return c.json({ ok: true, id: Number(r.lastInsertRowid) });
  } catch {
    return bad(c, "Nama kelompok sudah ada di kelas ini");
  }
});

sec("put", "/kelompok/:id", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const nama_kelompok = (b.nama_kelompok || "").trim();
  const cabang_id = b.cabang_id ? Number(b.cabang_id) : null;
  const nama_produk = (b.nama_produk || "").trim();
  const kelas_id = b.kelas_id ? Number(b.kelas_id) : null;
  if (!nama_kelompok) return bad(c, "Nama kelompok wajib diisi");
  const db = getDb();
  if (cabang_id && !db.query("SELECT id FROM cabang_produk WHERE id = ?").get(cabang_id))
    return bad(c, "Cabang produk tidak dikenal");
  if (kelas_id) {
    const lama = db.query("SELECT kelas_id FROM kelompok WHERE id = ?").get(c.req.param("id")) as { kelas_id: number } | null;
    if (lama && lama.kelas_id !== kelas_id) {
      const terkait = (db.query("SELECT COUNT(*) n FROM siswa WHERE kelompok_id = ? AND murid_id IS NOT NULL").get(c.req.param("id")) as { n: number }).n;
      if (terkait > 0)
        return bad(c, "Kelompok ini sudah punya murid dari menu Murid rombel lama — kosongkan dulu daftar muridnya sebelum memindah rombel");
    }
  }
  try {
    db.query(
      `UPDATE kelompok SET nama_kelompok = ?, nama_produk = ?,
       cabang_id = COALESCE(?, cabang_id), kelas_id = COALESCE(?, kelas_id) WHERE id = ?`
    ).run(nama_kelompok, nama_produk, cabang_id, kelas_id, c.req.param("id"));
    logAdmin(c, "Ubah kelompok projek", nama_kelompok);
    return c.json({ ok: true });
  } catch {
    return bad(c, "Nama kelompok sudah ada di kelas ini");
  }
});

sec("delete", "/kelompok/:id", (c) => {
  const db = getDb();
  const kelRow = db.query("SELECT nama_kelompok FROM kelompok WHERE id = ?").get(c.req.param("id")) as { nama_kelompok: string } | null;
  const fotos = db.query("SELECT filename FROM foto WHERE kelompok_id = ?").all(c.req.param("id")) as {
    filename: string;
  }[];
  db.query("DELETE FROM kelompok WHERE id = ?").run(c.req.param("id"));
  // Hapus file fisik (best effort)
  const { unlinkSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const { getDataDir } = require("./db") as typeof import("./db");
  for (const f of fotos) {
    try {
      unlinkSync(join(getDataDir(), "uploads", f.filename));
    } catch {}
  }
  logAdmin(c, "Hapus kelompok projek", kelRow ? kelRow.nama_kelompok : `id ${c.req.param("id")}`);
  return c.json({ ok: true });
});

// Ganti seluruh daftar siswa satu kelompok. Sejak master Murid (2026-10-24)
// daftar dikirim sebagai murid_ids hasil ceklis dari menu Murid — nama bebas
// (names) tidak lagi diterima, agar tidak ada salah ketik nama murid.
sec("put", "/kelompok/:id/siswa", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const db = getDb();
  const kel = db.query("SELECT id, nama_kelompok, kelas_id FROM kelompok WHERE id = ?").get(c.req.param("id")) as { id: number; nama_kelompok: string; kelas_id: number } | null;
  if (!kel) return bad(c, "Kelompok tidak ditemukan", 404);
  const v = validasiPilihanMurid("projek", kel.id, kel.kelas_id, b.murid_ids);
  if ("error" in v) return bad(c, v.error);
  const del = db.query("DELETE FROM siswa WHERE kelompok_id = ?");
  const ins = db.query("INSERT INTO siswa (kelompok_id, nama, murid_id, urutan) VALUES (?, ?, ?, ?)");
  const tx = db.transaction((list: { id: number; nama: string }[]) => {
    del.run(kel.id);
    list.forEach((m, i) => ins.run(kel.id, m.nama, m.id, i + 1));
  });
  tx(v.murid);
  logAdmin(c, "Ubah daftar murid kelompok projek", `${kel.nama_kelompok} • ${v.murid.length} murid`);
  return c.json({ ok: true, jumlah: v.murid.length });
});

// Impor CSV massal: nama_kelompok,kelas,tingkat,cabang,nama_produk,murid
// murid dipisah titik-koma; cabang = NAMA cabang (dibuat otomatis bila belum ada).
// Sejak master Murid (2026-10-24) impor menjadi KETAT:
// - kelas harus SUDAH terdaftar di menu Kelas (tidak lagi dibuat otomatis,
//   karena murid menempel ke rombel yang terdaftar);
// - setiap nama murid harus cocok dengan menu Murid pada rombel baris itu
//   (ejaan persis setelah normalisasi spasi & huruf besar/kecil) dan belum
//   masuk kelompok projek lain;
// - baris yang gagal SATU nama saja dilewati SELURUHNYA (tanpa efek samping:
//   kelompok/cabang tidak dibuat) dan dilaporkan di peringatan.
// Nama yang tersimpan selalu ejaan resmi dari menu Murid.
sec("post", "/kelompok/import", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const csv = String(b.csv || "");
  if (!csv.trim()) return bad(c, "Isi CSV kosong");
  const db = getDb();
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let start = 0;
  if (/nama_kelompok/i.test(lines[0])) start = 1;
  const getKelas = db.query("SELECT id FROM kelas WHERE nama = ?");
  const getCabang = db.query("SELECT id FROM cabang_produk WHERE nama = ?");
  const insKel = db.query(
    "INSERT OR IGNORE INTO kelompok (kelas_id, nama_kelompok, cabang_id, nama_produk) VALUES (?, ?, ?, ?)"
  );
  const getKel = db.query("SELECT id FROM kelompok WHERE kelas_id = ? AND nama_kelompok = ?");
  const insSiswa = db.query("INSERT INTO siswa (kelompok_id, nama, murid_id, urutan) VALUES (?, ?, ?, ?)");
  const cariMurid = db.query("SELECT id, nama FROM murid WHERE kelas_id = ? AND nama_norm = ?");
  const kelompokMurid = db.query(
    `SELECT s.kelompok_id, kel.nama_kelompok FROM siswa s
     JOIN kelompok kel ON kel.id = s.kelompok_id WHERE s.murid_id = ?`
  );
  const getOrCreateCabang = (namaCabang: string): number => {
    const n = namaCabang.trim() || "Olahan Nanas";
    const ada = getCabang.get(n) as { id: number } | null;
    if (ada) return ada.id;
    const r = db
      .query("INSERT INTO cabang_produk (kode, nama, urutan) VALUES (?, ?, (SELECT COALESCE(MAX(urutan),0)+1 FROM cabang_produk))")
      .run(kodeDariNama(n), n);
    return Number(r.lastInsertRowid);
  };
  let okCount = 0;
  const errors: string[] = [];
  const tx = db.transaction((rows: string[][]) => {
    rows.forEach((cols, ri) => {
      const [namaKelompok, kelasNama, , cabangNama, namaProduk, muridRaw] = cols.map((x) => (x || "").trim());
      const label = `Baris ${ri + 1 + start} (${namaKelompok || "?"} / ${kelasNama || "?"})`;
      if (!namaKelompok || !kelasNama) {
        errors.push(`${label} dilewati (nama kelompok/kelas kosong)`);
        return;
      }
      const kelas = getKelas.get(kelasNama) as { id: number } | null;
      if (!kelas) {
        errors.push(`${label} dilewati: kelas "${kelasNama}" belum terdaftar di menu Kelas`);
        return;
      }
      // --- validasi murid dulu: baris gagal tidak menimbulkan efek apa pun
      const namaMentah = (muridRaw || "").split(";").map((m) => m.trim()).filter(Boolean).slice(0, 12);
      if (!namaMentah.length) {
        errors.push(`${label} dilewati: kolom murid kosong`);
        return;
      }
      const kelAda = getKel.get(kelas.id, namaKelompok) as { id: number } | null;
      const muridValid: { id: number; nama: string }[] = [];
      const sudahDiBaris = new Set<number>();
      let gagal: string | null = null;
      for (const nm of namaMentah) {
        const cocok = cariMurid.all(kelas.id, normalisasiNama(nm)) as { id: number; nama: string }[];
        if (!cocok.length) { gagal = `murid "${nm}" tidak terdaftar di menu Murid kelas ${kelasNama}`; break; }
        if (cocok.length > 1) { gagal = `murid "${nm}" kembar di menu Murid kelas ${kelasNama} — tetapkan lewat ceklis manual (NIS pembeda)`; break; }
        const m = cocok[0];
        if (sudahDiBaris.has(m.id)) continue;
        sudahDiBaris.add(m.id);
        const dipakai = kelompokMurid.get(m.id) as { kelompok_id: number; nama_kelompok: string } | null;
        if (dipakai && (!kelAda || dipakai.kelompok_id !== kelAda.id)) {
          gagal = `murid "${m.nama}" sudah masuk ${dipakai.nama_kelompok}`;
          break;
        }
        muridValid.push(m);
      }
      if (gagal) { errors.push(`${label} dilewati: ${gagal}`); return; }
      // --- semua valid: buat kelompok (bila belum ada) + isi muridnya
      const cabangId = getOrCreateCabang(cabangNama);
      insKel.run(kelas.id, namaKelompok, cabangId, namaProduk || "");
      const kel = getKel.get(kelas.id, namaKelompok) as { id: number };
      const sudahAda = new Set(
        (db.query("SELECT murid_id FROM siswa WHERE kelompok_id = ?").all(kel.id) as { murid_id: number }[]).map((r) => r.murid_id)
      );
      let urutan = sudahAda.size;
      for (const m of muridValid) {
        if (sudahAda.has(m.id)) continue;
        insSiswa.run(kel.id, m.nama, m.id, ++urutan);
      }
      okCount++;
    });
  });
  const rows: string[][] = [];
  for (let i = start; i < lines.length; i++) {
    const cols = parseBarisCsv(lines[i]);
    while (cols.length < 6) cols.push("");
    rows.push(cols.slice(0, 6));
  }
  try {
    tx(rows);
  } catch (e: any) {
    return bad(c, "Gagal impor: " + e.message);
  }
  logAdmin(c, "Impor CSV kelompok projek", `${okCount} kelompok diimpor${errors.length ? `, ${errors.length} peringatan` : ""}`);
  return c.json({ ok: true, diimpor: okCount, peringatan: errors });
});

// ---------------------------------------------------------------- juri
sec("get", "/juri", (c) => {
  const db = getDb();
  const rows = db
    .query(
      `SELECT j.id, j.kode, j.nama, j.keterangan, j.created_at,
       (SELECT COUNT(DISTINCT p.kelompok_id) FROM penilaian p WHERE p.juri_id = j.id) AS jml_kelompok_dinilai
       FROM juri j ORDER BY j.kode`
    )
    .all() as any[];
  // Tugas per kelas (rombel) untuk tiap penilai; [] = belum dibatasi.
  const tugas = db
    .query(
      `SELECT jt.juri_id, k.id AS kelas_id, k.nama AS kelas_nama
       FROM juri_tugas jt JOIN kelas k ON k.id = jt.kelas_id ORDER BY k.tingkat, k.nama`
    )
    .all() as { juri_id: number; kelas_id: number; kelas_nama: string }[];
  const perJuri = new Map<number, { kelas_id: number; kelas_nama: string }[]>();
  for (const t of tugas) {
    if (!perJuri.has(t.juri_id)) perJuri.set(t.juri_id, []);
    perJuri.get(t.juri_id)!.push({ kelas_id: t.kelas_id, kelas_nama: t.kelas_nama });
  }
  for (const j of rows) j.tugas_kelas = perJuri.get(j.id) || [];
  return c.json({ juri: rows });
});

sec("post", "/juri", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const kode = (b.kode || "").trim().toUpperCase();
  const nama = (b.nama || "").trim();
  const pin = String(b.pin || "");
  const keterangan = (b.keterangan || "").trim();
  if (!kode || !nama) return bad(c, "Kode dan nama penilai wajib diisi");
  if (!/^[0-9]{4,8}$/.test(pin)) return bad(c, "PIN harus 4–8 digit angka");
  try {
    const hash = await Bun.password.hash(pin);
    const r = getDb().query("INSERT INTO juri (kode, nama, pin_hash, keterangan) VALUES (?, ?, ?, ?)").run(kode, nama, hash, keterangan);
    logAdmin(c, "Tambah penilai", `${kode} — ${nama}`);
    return c.json({ ok: true, id: Number(r.lastInsertRowid) });
  } catch {
    return bad(c, "Kode penilai sudah dipakai");
  }
});

sec("put", "/juri/:id", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const nama = (b.nama || "").trim();
  const keterangan = (b.keterangan || "").trim();
  const pin = String(b.pin || "");
  if (!nama) return bad(c, "Nama penilai wajib diisi");
  const db = getDb();
  const jRow = db.query("SELECT kode FROM juri WHERE id = ?").get(c.req.param("id")) as { kode: string } | null;
  db.query("UPDATE juri SET nama = ?, keterangan = ? WHERE id = ?").run(nama, keterangan, c.req.param("id"));
  if (pin) {
    if (!/^[0-9]{4,8}$/.test(pin)) return bad(c, "PIN harus 4–8 digit angka");
    const hash = await Bun.password.hash(pin);
    db.query("UPDATE juri SET pin_hash = ? WHERE id = ?").run(hash, c.req.param("id"));
  }
  logAdmin(c, "Ubah penilai", `${jRow ? jRow.kode + " — " : ""}${nama}${pin ? " (PIN diganti)" : ""}`);
  return c.json({ ok: true });
});

// Atur tugas penilai per kelas. Daftar kosong = tugas dikosongkan,
// penilai kembali tidak dibatasi (perilaku lama). Mengganti seluruh
// daftar dalam satu transaksi; kelas yang tidak dikenal ditolak.
sec("put", "/juri/:id/tugas", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const kelasIds = Array.isArray(b.kelas_ids) ? b.kelas_ids.map((x: any) => Number(x)).filter((x: number) => Number.isFinite(x)) : null;
  if (kelasIds === null) return bad(c, "kelas_ids harus berupa daftar id kelas");
  const db = getDb();
  const jRow = db.query("SELECT kode, nama FROM juri WHERE id = ?").get(c.req.param("id")) as { kode: string; nama: string } | null;
  if (!jRow) return bad(c, "Penilai tidak ditemukan", 404);
  const unik = [...new Set(kelasIds)];
  const nama: string[] = [];
  for (const id of unik) {
    const k = db.query("SELECT nama FROM kelas WHERE id = ?").get(id) as { nama: string } | null;
    if (!k) return bad(c, `Kelas id ${id} tidak ditemukan`);
    nama.push(k.nama);
  }
  db.transaction(() => {
    db.query("DELETE FROM juri_tugas WHERE juri_id = ?").run(c.req.param("id"));
    for (const id of unik) db.query("INSERT INTO juri_tugas (juri_id, kelas_id) VALUES (?, ?)").run(c.req.param("id"), id);
  })();
  logAdmin(c, "Atur tugas penilai", `${jRow.kode} — ${jRow.nama}: ${nama.length ? nama.join(", ") : "semua kelas (tugas dikosongkan)"}`);
  return c.json({ ok: true, tugas_kelas: unik });
});

sec("delete", "/juri/:id", (c) => {
  const db = getDb();
  const row = db.query("SELECT kode, nama FROM juri WHERE id = ?").get(c.req.param("id")) as { kode: string; nama: string } | null;
  db.query("DELETE FROM juri WHERE id = ?").run(c.req.param("id"));
  logAdmin(c, "Hapus penilai", row ? `${row.kode} — ${row.nama}` : `id ${c.req.param("id")}`);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- kategori & kriteria
sec("get", "/kategori", (c) => {
  const db = getDb();
  const kats = db.query("SELECT * FROM kategori ORDER BY urutan").all() as any[];
  for (const k of kats) {
    k.kriteria = db
      .query("SELECT * FROM kriteria WHERE kategori_id = ? ORDER BY urutan")
      .all(k.id);
  }
  return c.json({ kategori: kats });
});

sec("put", "/kriteria/:id", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const nama = (b.nama || "").trim();
  const deskripsi = (b.deskripsi || "").trim();
  const min = Math.max(0, Math.min(100, Number(b.skor_min)));
  const max = Math.max(0, Math.min(100, Number(b.skor_max)));
  const def = Math.max(0, Math.min(100, Number(b.skor_default)));
  if (!nama) return bad(c, "Nama kriteria wajib diisi");
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(def))
    return bad(c, "Skor min/max/default harus angka 0–100");
  if (min > max) return bad(c, "Skor min tidak boleh lebih dari skor max");
  if (def < min || def > max) return bad(c, "Skor default harus di dalam rentang min–max");
  getDb()
    .query("UPDATE kriteria SET nama = ?, deskripsi = ?, skor_min = ?, skor_max = ?, skor_default = ? WHERE id = ?")
    .run(nama, deskripsi, min, max, def, c.req.param("id"));
  logAdmin(c, "Ubah kriteria projek", `${nama} (${min}–${max})`);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- akun admin
// Kelola akun admin (tabel users). Semua akun berhak penuh (belum ada peran
// terbatas). Password TIDAK PERNAH dikembalikan ke klien, dan TIDAK dicatat
// ke log — yang tercatat hanya username dan jenis aksinya.
const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;

sec("get", "/users", (c) => {
  const rows = getDb()
    .query(
      `SELECT u.id, u.username, u.role, u.created_at,
              (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > datetime('now')) AS sesi_aktif
       FROM users u ORDER BY u.id`
    )
    .all();
  const me = c.get("user") as { id: number };
  return c.json({ users: rows, saya: me.id });
});

sec("post", "/users", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const username = (b.username || "").trim();
  const password = String(b.password || "");
  if (!USERNAME_RE.test(username))
    return bad(c, "Username 3–32 karakter: huruf, angka, titik, strip, atau garis bawah");
  if (password.length < 6) return bad(c, "Password minimal 6 karakter");
  try {
    const hash = await Bun.password.hash(password);
    const r = getDb()
      .query("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')")
      .run(username, hash);
    logAdmin(c, "Tambah akun admin", username);
    return c.json({ ok: true, id: Number(r.lastInsertRowid) });
  } catch {
    return bad(c, "Username sudah dipakai");
  }
});

// Reset password: semua sesi akun itu (di perangkat mana pun) dimatikan,
// sehingga password lama tidak menyisakan sesi yang masih hidup.
sec("put", "/users/:id/password", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const password = String(b.password || "");
  if (password.length < 6) return bad(c, "Password minimal 6 karakter");
  const db = getDb();
  const target = db.query("SELECT id, username FROM users WHERE id = ?").get(c.req.param("id")) as
    | { id: number; username: string }
    | null;
  if (!target) return bad(c, "Akun tidak ditemukan", 404);
  const hash = await Bun.password.hash(password);
  db.query("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, target.id);
  db.query("DELETE FROM sessions WHERE user_id = ?").run(target.id);
  logAdmin(c, "Reset password akun admin", target.username);
  return c.json({ ok: true });
});

sec("delete", "/users/:id", (c) => {
  const db = getDb();
  const target = db.query("SELECT id, username FROM users WHERE id = ?").get(c.req.param("id")) as
    | { id: number; username: string }
    | null;
  if (!target) return bad(c, "Akun tidak ditemukan", 404);
  const total = (db.query("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  if (total <= 1) return bad(c, "Tidak bisa menghapus admin terakhir — aplikasi harus selalu punya admin");
  const me = c.get("user") as { id: number };
  if (target.id === me.id) return bad(c, "Tidak bisa menghapus akun Anda sendiri — minta admin lain yang menghapusnya");
  db.query("DELETE FROM sessions WHERE user_id = ?").run(target.id);
  db.query("DELETE FROM users WHERE id = ?").run(target.id);
  logAdmin(c, "Hapus akun admin", target.username);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- log aktivitas
// Daftar log terbaru untuk menu "Log" di halaman admin.
// Query: ?limit= (default 200, maks 500) &q= (cari aktor/aksi/detail) &peran=admin|penilai
sec("get", "/log", (c) => {
  const db = getDb();
  const limit = Math.max(1, Math.min(500, Number(c.req.query("limit")) || 200));
  const q = (c.req.query("q") || "").trim();
  const peran = (c.req.query("peran") || "").trim();
  const where: string[] = [];
  const params: any[] = [];
  if (q) {
    where.push("(aktor LIKE ? OR aksi LIKE ? OR detail LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (peran === "admin" || peran === "penilai") {
    where.push("peran = ?");
    params.push(peran);
  }
  const sql =
    "SELECT id, aktor, peran, aksi, detail, ip, created_at FROM aktivitas_log" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY id DESC LIMIT ?";
  const rows = db.query(sql).all(...params, limit);
  const total = (db.query("SELECT COUNT(*) AS n FROM aktivitas_log").get() as { n: number }).n;
  return c.json({ log: rows, total });
});

// Bersihkan log lama secara manual (pilihan admin). Batas aman: minimal 30 hari,
// mengikuti pola Log Aktivitas GezyRaport agar jejak audit tidak mudah hilang.
sec("delete", "/log/lama", (c) => {
  const hari = Math.floor(Number(c.req.query("hari")) || 0);
  if (!Number.isFinite(hari) || hari < 30) return bad(c, "Penghapusan log lama minimal 30 hari");
  const db = getDb();
  const r = db.query("DELETE FROM aktivitas_log WHERE created_at < datetime('now', ?)").run(`-${hari} days`);
  logAdmin(c, "Bersihkan log lama", `${r.changes} log lebih dari ${hari} hari dihapus`);
  return c.json({ ok: true, terhapus: r.changes });
});

export default admin;
