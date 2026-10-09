import { Hono } from "hono";
import { getDb } from "./db";
import { requireAuth } from "./auth";

const admin = new Hono();
// requireAuth dipasang per-route (bukan admin.use("*")) agar tidak bocor
// ke route sub-app lain yang di-mount di base path /api yang sama.
function sec(method: "get" | "post" | "put" | "delete", path: string, ...handlers: any[]) {
  (admin as any)[method](path, requireAuth, ...handlers);
}

function bad(c: any, msg: string, status = 400) {
  return c.json({ error: msg }, status);
}

// ---------------------------------------------------------------- dashboard
sec("get", "/dashboard", (c) => {
  const db = getDb();
  const one = (sql: string, p: any[] = []) => (db.query(sql).get(...p) as { n: number }).n;
  const perKelas = db
    .query(
      `SELECT k.id, k.nama, k.tingkat,
              COUNT(DISTINCT kel.id) AS kelompok,
              COUNT(DIST s.id) AS siswa,
              COUNT(DIST p.id) AS nilai_masuk
       FROM kelas k
       LEFT JOIN kelompok kel ON kel.kelas_id = k.id
       LEFT JOIN siswa s ON s.kelompok_id = kel.id
       LEFT JOIN penilaian p ON p.kelompok_id = kel.id
       GROUP BY k.id ORDER BY k.tingkat, k.nama`
    )
    .all();
  return c.json({
    total_kelas: one("SELECT COUNT(*) n FROM kelas"),
    total_kelompok: one("SELECT COUNT(*) n FROM kelompok"),
    total_siswa: one("SELECT COUNT(*) n FROM siswa"),
    total_juri: one("SELECT COUNT(*) n FROM juri"),
    total_penilaian: one("SELECT COUNT(*) n FROM penilaian"),
    total_foto: one("SELECT COUNT(*) n FROM foto"),
    per_kelas: perKelas,
  });
});

// ---------------------------------------------------------------- kelas
sec("get", "/kelas", (c) => {
  const rows = getDb()
    .query(
      `SELECT k.*, COUNT(DISTINCT kel.id) AS jml_kelompok, COUNT(s.id) AS jml_siswa
       FROM kelas k LEFT JOIN kelompok kel ON kel.kelas_id = k.id
       LEFT JOIN siswa s ON s.kelompok_id = kel.id
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
    return c.json({ ok: true });
  } catch {
    return bad(c, "Nama kelas sudah ada");
  }
});

sec("delete", "/kelas/:id", (c) => {
  getDb().query("DELETE FROM kelas WHERE id = ?").run(c.req.param("id"));
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
    return c.json({ ok: true });
  } catch {
    return bad(c, "Nama cabang sudah ada");
  }
});

sec("delete", "/cabang/:id", (c) => {
  const db = getDb();
  const used = (db.query("SELECT COUNT(*) n FROM kelompok WHERE cabang_id = ?").get(c.req.param("id")) as { n: number }).n;
  if (used > 0) return bad(c, `Cabang masih dipakai ${used} kelompok, tidak bisa dihapus`);
  db.query("DELETE FROM cabang_produk WHERE id = ?").run(c.req.param("id"));
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
    .query("SELECT id, nama, urutan FROM siswa WHERE kelompok_id = ? ORDER BY urutan, id")
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
  try {
    db.query(
      `UPDATE kelompok SET nama_kelompok = ?, nama_produk = ?,
       cabang_id = COALESCE(?, cabang_id), kelas_id = COALESCE(?, kelas_id) WHERE id = ?`
    ).run(nama_kelompok, nama_produk, cabang_id, kelas_id, c.req.param("id"));
    return c.json({ ok: true });
  } catch {
    return bad(c, "Nama kelompok sudah ada di kelas ini");
  }
});

sec("delete", "/kelompok/:id", (c) => {
  const db = getDb();
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
  return c.json({ ok: true });
});

// Ganti seluruh daftar siswa satu kelompok (dipakai form dinamis 4–10 murid)
sec("put", "/kelompok/:id/siswa", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const names: string[] = Array.isArray(b.names) ? b.names.map((n: any) => String(n).trim()).filter(Boolean) : [];
  if (names.length < 1) return bad(c, "Minimal 1 nama murid");
  if (names.length > 12) return bad(c, "Maksimal 12 murid per kelompok");
  const db = getDb();
  const kel = db.query("SELECT id FROM kelompok WHERE id = ?").get(c.req.param("id"));
  if (!kel) return bad(c, "Kelompok tidak ditemukan", 404);
  const del = db.query("DELETE FROM siswa WHERE kelompok_id = ?");
  const ins = db.query("INSERT INTO siswa (kelompok_id, nama, urutan) VALUES (?, ?, ?)");
  const tx = db.transaction((list: string[]) => {
    del.run(c.req.param("id"));
    list.forEach((n, i) => ins.run(c.req.param("id"), n, i + 1));
  });
  tx(names);
  return c.json({ ok: true, jumlah: names.length });
});

// Impor CSV massal: nama_kelompok,kelas,tingkat,cabang,nama_produk,murid
// murid dipisah titik-koma; cabang = NAMA cabang (dibuat otomatis bila belum ada).
// Baris pertama boleh header.
sec("post", "/kelompok/import", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const csv = String(b.csv || "");
  if (!csv.trim()) return bad(c, "Isi CSV kosong");
  const db = getDb();
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let start = 0;
  if (/nama_kelompok/i.test(lines[0])) start = 1;
  const getKelas = db.query("SELECT id FROM kelas WHERE nama = ?");
  const insKelas = db.query("INSERT INTO kelas (nama, tingkat) VALUES (?, ?)");
  const getCabang = db.query("SELECT id FROM cabang_produk WHERE nama = ?");
  const insKel = db.query(
    "INSERT OR IGNORE INTO kelompok (kelas_id, nama_kelompok, cabang_id, nama_produk) VALUES (?, ?, ?, ?)"
  );
  const getKel = db.query("SELECT id FROM kelompok WHERE kelas_id = ? AND nama_kelompok = ?");
  const insSiswa = db.query("INSERT INTO siswa (kelompok_id, nama, urutan) VALUES (?, ?, ?)");
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
    for (const cols of rows) {
      const [namaKelompok, kelasNama, tingkat, cabangNama, namaProduk, muridRaw] = cols.map((x) => (x || "").trim());
      if (!namaKelompok || !kelasNama) {
        errors.push(`Baris dilewati (nama kelompok/kelas kosong): ${cols.join(",")}`);
        continue;
      }
      let kelas = getKelas.get(kelasNama) as { id: number } | null;
      if (!kelas) kelas = { id: Number(insKelas.run(kelasNama, tingkat || "").lastInsertRowid) };
      const cabangId = getOrCreateCabang(cabangNama);
      insKel.run(kelas.id, namaKelompok, cabangId, namaProduk || "");
      const kel = getKel.get(kelas.id, namaKelompok) as { id: number };
      const murid = (muridRaw || "").split(";").map((m) => m.trim()).filter(Boolean).slice(0, 12);
      murid.forEach((m, i) => insSiswa.run(kel.id, m, i + 1));
      okCount++;
    }
  });
  // Parse CSV sederhana (dukung tanda kutip)
  const rows: string[][] = [];
  for (let i = start; i < lines.length; i++) {
    const cols: string[] = [];
    let cur = "";
    let inQ = false;
    for (const ch of lines[i]) {
      if (ch === '"') inQ = !inQ;
      else if (ch === "," && !inQ) {
        cols.push(cur);
        cur = "";
      } else cur += ch;
    }
    cols.push(cur);
    while (cols.length < 6) cols.push("");
    rows.push(cols.slice(0, 6));
  }
  try {
    tx(rows);
  } catch (e: any) {
    return bad(c, "Gagal impor: " + e.message);
  }
  return c.json({ ok: true, diimpor: okCount, peringatan: errors });
});

// ---------------------------------------------------------------- juri
sec("get", "/juri", (c) => {
  const rows = getDb()
    .query(
      `SELECT j.id, j.kode, j.nama, j.keterangan, j.created_at,
       (SELECT COUNT(DISTINCT p.kelompok_id) FROM penilaian p WHERE p.juri_id = j.id) AS jml_kelompok_dinilai
       FROM juri j ORDER BY j.kode`
    )
    .all();
  return c.json({ juri: rows });
});

sec("post", "/juri", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const kode = (b.kode || "").trim().toUpperCase();
  const nama = (b.nama || "").trim();
  const pin = String(b.pin || "");
  const keterangan = (b.keterangan || "").trim();
  if (!kode || !nama) return bad(c, "Kode dan nama juri wajib diisi");
  if (!/^[0-9]{4,8}$/.test(pin)) return bad(c, "PIN harus 4–8 digit angka");
  try {
    const hash = await Bun.password.hash(pin);
    const r = getDb().query("INSERT INTO juri (kode, nama, pin_hash, keterangan) VALUES (?, ?, ?, ?)").run(kode, nama, hash, keterangan);
    return c.json({ ok: true, id: Number(r.lastInsertRowid) });
  } catch {
    return bad(c, "Kode juri sudah dipakai");
  }
});

sec("put", "/juri/:id", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const nama = (b.nama || "").trim();
  const keterangan = (b.keterangan || "").trim();
  const pin = String(b.pin || "");
  if (!nama) return bad(c, "Nama juri wajib diisi");
  const db = getDb();
  db.query("UPDATE juri SET nama = ?, keterangan = ? WHERE id = ?").run(nama, keterangan, c.req.param("id"));
  if (pin) {
    if (!/^[0-9]{4,8}$/.test(pin)) return bad(c, "PIN harus 4–8 digit angka");
    const hash = await Bun.password.hash(pin);
    db.query("UPDATE juri SET pin_hash = ? WHERE id = ?").run(hash, c.req.param("id"));
  }
  return c.json({ ok: true });
});

sec("delete", "/juri/:id", (c) => {
  getDb().query("DELETE FROM juri WHERE id = ?").run(c.req.param("id"));
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
  return c.json({ ok: true });
});

export default admin;
