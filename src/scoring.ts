import { Hono } from "hono";
import { getDb, getDataDir } from "./db";
import { requireJudge, judgeLoginHandler, judgeLogoutHandler } from "./judge";
import { requireAuth } from "./auth";
import { join, extname } from "node:path";
import { mkdirSync, writeFileSync, unlinkSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";

const scoring = new Hono();

// ---------------------------------------------------------------- auth juri
scoring.post("/juri/login", judgeLoginHandler);
scoring.post("/juri/logout", judgeLogoutHandler);
scoring.get("/juri/me", requireJudge, (c) => c.json({ juri: c.get("juri") }));

// Daftar kategori + kriteria (untuk form juri)
scoring.get("/juri/kategori", requireJudge, (c) => {
  const db = getDb();
  const kats = db.query("SELECT id, kode, nama, urutan FROM kategori ORDER BY urutan").all() as any[];
  for (const k of kats) {
    k.kriteria = db
      .query("SELECT id, nama, deskripsi, skor_min, skor_max, skor_default FROM kriteria WHERE kategori_id = ? ORDER BY urutan")
      .all(k.id);
  }
  return c.json({ kategori: kats });
});

scoring.get("/juri/kelas", requireJudge, (c) => {
  const rows = getDb()
    .query(
      `SELECT k.id, k.nama, k.tingkat, COUNT(kel.id) AS jml_kelompok FROM kelas k
       LEFT JOIN kelompok kel ON kel.kelas_id = k.id
       GROUP BY k.id ORDER BY k.tingkat, k.nama`
    )
    .all();
  return c.json({ kelas: rows });
});

// Daftar kelompok per kelas + status sudah dinilai juri ini
scoring.get("/juri/kelompok", requireJudge, (c) => {
  const kelasId = c.req.query("kelas_id");
  if (!kelasId) return c.json({ error: "kelas_id wajib" }, 400);
  const juri = c.get("juri") as { id: number };
  const rows = getDb()
    .query(
      `SELECT kel.id, kel.nama_kelompok, kel.cabang_id, cp.nama AS cabang_nama, kel.nama_produk,
              (SELECT COUNT(*) FROM siswa s WHERE s.kelompok_id = kel.id) AS jml_siswa,
              (SELECT COUNT(*) FROM penilaian p WHERE p.kelompok_id = kel.id AND p.juri_id = ?) AS jml_dinilai,
              (SELECT COUNT(*) FROM foto f WHERE f.kelompok_id = kel.id AND f.juri_id = ?) AS jml_foto
       FROM kelompok kel LEFT JOIN cabang_produk cp ON cp.id = kel.cabang_id
       WHERE kel.kelas_id = ? ORDER BY kel.nama_kelompok`
    )
    .all(juri.id, juri.id, kelasId);
  const totalKategori = (getDb().query("SELECT COUNT(*) n FROM kategori").get() as { n: number }).n;
  return c.json({ kelompok: rows, total_kategori: totalKategori });
});

// Detail kelompok + nilai juri ini + foto juri ini
scoring.get("/juri/kelompok/:id", requireJudge, (c) => {
  const db = getDb();
  const juri = c.get("juri") as { id: number };
  const kel = db
    .query(
      `SELECT kel.*, k.nama AS kelas_nama, cp.nama AS cabang_nama FROM kelompok kel
       JOIN kelas k ON k.id = kel.kelas_id
       LEFT JOIN cabang_produk cp ON cp.id = kel.cabang_id
       WHERE kel.id = ?`
    )
    .get(c.req.param("id")) as any;
  if (!kel) return c.json({ error: "Kelompok tidak ditemukan" }, 404);
  kel.siswa = db
    .query("SELECT nama FROM siswa WHERE kelompok_id = ? ORDER BY urutan, id")
    .all(kel.id);
  kel.nilai_saya = db
    .query(
      `SELECT p.kategori_id, p.kriteria_id, p.skor, kr.nama AS kriteria_nama
       FROM penilaian p JOIN kriteria kr ON kr.id = p.kriteria_id
       WHERE p.kelompok_id = ? AND p.juri_id = ?`
    )
    .all(kel.id, juri.id);
  kel.foto_saya = db
    .query("SELECT id, filename, caption, uploaded_at FROM foto WHERE kelompok_id = ? AND juri_id = ? ORDER BY uploaded_at")
    .all(kel.id, juri.id);
  return c.json({ kelompok: kel });
});

// Simpan nilai satu kategori (upsert per juri+kelompok+kategori)
scoring.post("/juri/nilai", requireJudge, async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const kelompok_id = Number(b.kelompok_id);
  const kategori_id = Number(b.kategori_id);
  const kriteria_id = Number(b.kriteria_id);
  const skor = Number(b.skor);
  const juri = c.get("juri") as { id: number };
  const db = getDb();
  if (!kelompok_id || !kategori_id || !kriteria_id) return c.json({ error: "Data tidak lengkap" }, 400);
  const kri = db.query("SELECT id, kategori_id, skor_min, skor_max FROM kriteria WHERE id = ?").get(kriteria_id) as any;
  if (!kri || kri.kategori_id !== kategori_id) return c.json({ error: "Kriteria tidak sesuai kategori" }, 400);
  if (!Number.isFinite(skor) || skor < 0 || skor > 100) return c.json({ error: "Skor harus 0–100" }, 400);
  if (skor < kri.skor_min || skor > kri.skor_max)
    return c.json({ error: `Skor harus dalam rentang kriteria (${kri.skor_min}–${kri.skor_max})` }, 400);
  const kel = db.query("SELECT id FROM kelompok WHERE id = ?").get(kelompok_id);
  if (!kel) return c.json({ error: "Kelompok tidak ditemukan" }, 404);
  db.query(
    `INSERT INTO penilaian (kelompok_id, juri_id, kategori_id, kriteria_id, skor, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(kelompok_id, juri_id, kategori_id)
     DO UPDATE SET kriteria_id = excluded.kriteria_id, skor = excluded.skor, updated_at = datetime('now')`
  ).run(kelompok_id, juri.id, kategori_id, kriteria_id, skor);
  return c.json({ ok: true });
});

// Upload foto — dipakai tepat setelah juri selesai mengisi nilai
const MAX_FOTO = 8 * 1024 * 1024; // 8 MB per file
scoring.post("/juri/foto", requireJudge, async (c) => {
  const juri = c.get("juri") as { id: number };
  const form = await c.req.formData().catch(() => null);
  if (!form) return c.json({ error: "Form tidak valid" }, 400);
  const kelompok_id = Number(form.get("kelompok_id"));
  const caption = String(form.get("caption") || "").slice(0, 200);
  const file = form.get("foto");
  const db = getDb();
  if (!kelompok_id || !db.query("SELECT id FROM kelompok WHERE id = ?").get(kelompok_id))
    return c.json({ error: "Kelompok tidak valid" }, 404);
  if (!(file instanceof File)) return c.json({ error: "File foto wajib diisi" }, 400);
  if (!file.type.startsWith("image/")) return c.json({ error: "File harus berupa gambar" }, 400);
  if (file.size > MAX_FOTO) return c.json({ error: "Ukuran foto maksimal 8 MB" }, 400);
  if (file.size === 0) return c.json({ error: "File kosong" }, 400);
  const ext = (extname(file.name) || ".jpg").toLowerCase().replace(/[^a-z0-9.]/g, "") || ".jpg";
  const filename = `${kelompok_id}_${randomBytes(8).toString("hex")}${ext}`;
  const dir = join(getDataDir(), "uploads");
  mkdirSync(dir, { recursive: true });
  const buf = Buffer.from(await file.arrayBuffer());
  writeFileSync(join(dir, filename), buf);
  const r = db
    .query("INSERT INTO foto (kelompok_id, juri_id, filename, mime, size, caption) VALUES (?, ?, ?, ?, ?, ?)")
    .run(kelompok_id, juri.id, filename, file.type, file.size, caption);
  return c.json({ ok: true, id: Number(r.lastInsertRowid), filename });
});

scoring.delete("/juri/foto/:id", requireJudge, (c) => {
  const juri = c.get("juri") as { id: number };
  const db = getDb();
  const f = db.query("SELECT id, filename FROM foto WHERE id = ? AND juri_id = ?").get(c.req.param("id"), juri.id) as any;
  if (!f) return c.json({ error: "Foto tidak ditemukan" }, 404);
  db.query("DELETE FROM foto WHERE id = ?").run(f.id);
  try {
    unlinkSync(join(getDataDir(), "uploads", f.filename));
  } catch {}
  return c.json({ ok: true });
});

// Sajikan file upload (admin atau juri yang login)
scoring.get("/uploads/:filename", async (c) => {
  const db = getDb();
  const adminToken = c.req.header("cookie") || "";
  let allowed = false;
  // Cek sesi admin
  const m = adminToken.match(/nilaiproyek_session=([a-f0-9]{64})/);
  if (m) {
    const s = db.query("SELECT id FROM sessions WHERE id = ? AND expires_at > datetime('now')").get(m[1]);
    if (s) allowed = true;
  }
  if (!allowed) {
    const mj = adminToken.match(/nilaiproyek_juri=([a-f0-9]{64})/);
    if (mj) {
      const s = db.query("SELECT id FROM judge_sessions WHERE id = ? AND expires_at > datetime('now')").get(mj[1]);
      if (s) allowed = true;
    }
  }
  if (!allowed) return c.json({ error: "Tidak diizinkan" }, 401);
  const filename = c.req.param("filename").replace(/[^a-zA-Z0-9_.-]/g, "");
  const f = db.query("SELECT mime, size FROM foto WHERE filename = ?").get(filename) as any;
  if (!f) return c.json({ error: "File tidak ditemukan" }, 404);
  const path = join(getDataDir(), "uploads", filename);
  try {
    statSync(path);
  } catch {
    return c.json({ error: "File tidak ditemukan" }, 404);
  }
  const file = Bun.file(path);
  return new Response(file, {
    headers: { "Content-Type": f.mime || "image/jpeg", "Content-Length": String(f.size) },
  });
});

// ---------------------------------------------------------------- hasil (admin)
// Rekap per kelas + peringkat otomatis.
// Skor per kategori = rata-rata dari semua juri; total = jumlah 4 rata-rata (maks 400).
export function hitungHasil(kelasId: number) {
  const db = getDb();
  const kelas = db.query("SELECT id, nama, tingkat FROM kelas WHERE id = ?").get(kelasId) as any;
  if (!kelas) return null;
  const kats = db.query("SELECT id, kode, nama FROM kategori ORDER BY urutan").all() as {
    id: number;
    kode: string;
    nama: string;
  }[];
  const kelompok = db
    .query(
      `SELECT kel.id, kel.nama_kelompok, kel.cabang_id, cp.nama AS cabang_nama, kel.nama_produk,
              (SELECT COUNT(*) FROM siswa s WHERE s.kelompok_id = kel.id) AS jml_siswa,
              (SELECT COUNT(DISTINCT p.juri_id) FROM penilaian p WHERE p.kelompok_id = kel.id) AS jml_juri,
              (SELECT COUNT(*) FROM foto f WHERE f.kelompok_id = kel.id) AS jml_foto
       FROM kelompok kel LEFT JOIN cabang_produk cp ON cp.id = kel.cabang_id
       WHERE kel.kelas_id = ? ORDER BY kel.nama_kelompok`
    )
    .all(kelasId) as any[];
  const avgQ = db.query(
    "SELECT AVG(skor) AS avg_skor, COUNT(*) AS n FROM penilaian WHERE kelompok_id = ? AND kategori_id = ?"
  );
  const hasil = kelompok.map((kel) => {
    const nilai: Record<string, number | null> = {};
    let total = 0;
    let lengkap = true;
    for (const k of kats) {
      const r = avgQ.get(kel.id, k.id) as { avg_skor: number | null; n: number };
      const v = r.avg_skor == null ? null : Math.round(r.avg_skor * 10) / 10;
      nilai[k.kode] = v;
      if (v == null) lengkap = false;
      else total += v;
    }
    return { ...kel, nilai, total: lengkap ? Math.round(total * 10) / 10 : null, lengkap };
  });
  hasil.sort((a, b) => {
    if (a.total == null && b.total == null) return a.nama_kelompok.localeCompare(b.nama_kelompok);
    if (a.total == null) return 1;
    if (b.total == null) return -1;
    if (b.total !== a.total) return b.total - a.total;
    return a.nama_kelompok.localeCompare(b.nama_kelompok);
  });
  let peringkat = 0;
  let lastTotal: number | null = null;
  hasil.forEach((h, i) => {
    if (h.total == null) {
      h.peringkat = null;
    } else {
      if (lastTotal == null || h.total !== lastTotal) peringkat = i + 1;
      h.peringkat = peringkat;
      lastTotal = h.total;
    }
  });
  return { kelas, kategori: kats, hasil, dihitung_pada: new Date().toISOString() };
}

scoring.get("/hasil", requireAuth, (c) => {
  const kelasId = Number(c.req.query("kelas_id"));
  if (!kelasId) return c.json({ error: "kelas_id wajib" }, 400);
  const h = hitungHasil(kelasId);
  if (!h) return c.json({ error: "Kelas tidak ditemukan" }, 404);
  return c.json(h);
});

// Ekspor CSV hasil per kelas
scoring.get("/hasil/export.csv", requireAuth, (c) => {
  const kelasId = Number(c.req.query("kelas_id"));
  if (!kelasId) return c.json({ error: "kelas_id wajib" }, 400);
  const h = hitungHasil(kelasId);
  if (!h) return c.json({ error: "Kelas tidak ditemukan" }, 404);
  const esc = (v: any) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["Peringkat", "Kelompok", "Cabang Produk", "Nama Produk", "Jml Siswa", "Jml Juri Penilai",
    ...h.kategori.map((k) => k.nama), "Total (maks 400)"];
  const lines = [head.map(esc).join(",")];
  for (const r of h.hasil) {
    lines.push(
      [
        r.peringkat ?? "",
        r.nama_kelompok,
        r.cabang_nama || "",
        r.nama_produk,
        r.jml_siswa,
        r.jml_juri,
        ...h.kategori.map((k) => (r.nilai[k.kode] ?? "")),
        r.total ?? "",
      ].map(esc).join(",")
    );
  }
  const csv = "\uFEFF" + lines.join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hasil-${h.kelas.nama}.csv"`,
    },
  });
});

// ---------------------------------------------------------------- berita acara (admin)
scoring.get("/berita-acara", requireAuth, (c) => {
  const kelasId = c.req.query("kelas_id");
  if (!kelasId) return c.json({ error: "kelas_id wajib" }, 400);
  const row = getDb().query("SELECT * FROM berita_acara WHERE kelas_id = ?").get(kelasId);
  return c.json({ berita_acara: row || null });
});

scoring.put("/berita-acara", requireAuth, async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const kelas_id = Number(b.kelas_id);
  if (!kelas_id) return c.json({ error: "kelas_id wajib" }, 400);
  const db = getDb();
  if (!db.query("SELECT id FROM kelas WHERE id = ?").get(kelas_id))
    return c.json({ error: "Kelas tidak ditemukan" }, 404);
  const fields = {
    nomor: String(b.nomor || ""),
    tempat: String(b.tempat || ""),
    tanggal: String(b.tanggal || ""),
    mengetahui_nama: String(b.mengetahui_nama || ""),
    mengetahui_nip: String(b.mengetahui_nip || ""),
    mengetahui_jabatan: String(b.mengetahui_jabatan || ""),
    dibuat_nama: String(b.dibuat_nama || ""),
  };
  db.query(
    `INSERT INTO berita_acara (kelas_id, nomor, tempat, tanggal, mengetahui_nama, mengetahui_nip, mengetahui_jabatan, dibuat_nama, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(kelas_id) DO UPDATE SET nomor = excluded.nomor, tempat = excluded.tempat,
       tanggal = excluded.tanggal, mengetahui_nama = excluded.mengetahui_nama,
       mengetahui_nip = excluded.mengetahui_nip, mengetahui_jabatan = excluded.mengetahui_jabatan,
       dibuat_nama = excluded.dibuat_nama, updated_at = datetime('now')`
  ).run(kelas_id, fields.nomor, fields.tempat, fields.tanggal, fields.mengetahui_nama,
    fields.mengetahui_nip, fields.mengetahui_jabatan, fields.dibuat_nama);
  return c.json({ ok: true });
});

export default scoring;
