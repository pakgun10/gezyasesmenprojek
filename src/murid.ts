import { Hono } from "hono";
import { getDb, normalisasiNama, namaRapi } from "./db";
import { requireAuth, clientIp } from "./auth";
import { logAktivitas, aktorAdmin } from "./log";

// ===========================================================================
// Master data Murid (2026-10-24, keputusan Pak Gun) — daftar induk murid per
// rombel, dipakai bersama modul projek & senam:
// - Anggota kelompok TIDAK lagi diketik bebas; dipilih (ceklis) dari sini.
// - Impor CSV kelompok wajib mencocokkan nama ke daftar ini.
// - Satu murid hanya boleh masuk satu kelompok per modul.
// File ini juga mengekspor validasi bersama yang dipakai admin.ts (projek)
// dan senam.ts (senam) agar kedua modul tidak bisa berbeda aturan.
// ===========================================================================

const murid = new Hono();

function sec(method: "get" | "post" | "put" | "delete", path: string, ...handlers: any[]) {
  (murid as any)[method](path, requireAuth, ...handlers);
}

function bad(c: any, msg: string, status = 400) {
  return c.json({ error: msg }, status);
}

function logAdmin(c: any, aksi: string, detail = "") {
  logAktivitas(aktorAdmin(c), "admin", aksi, detail, clientIp(c));
}

// ---------------------------------------------------------------------------
// Aturan duplikat dalam satu rombel: nama ternormalisasi sama dianggap orang
// yang sama, KECUALI kedua baris punya NIS berbeda yang sama-sama terisi
// (kasus nama kembar — NIS menjadi pembeda). NIS kosong di salah satu sisi
// tetap dianggap duplikat.
// ---------------------------------------------------------------------------
export function cariDuplikatMurid(
  db: ReturnType<typeof getDb>,
  kelasId: number,
  norm: string,
  nis: string,
  kecualiId = 0
): { id: number; nama: string; nis: string } | null {
  const rows = db
    .query("SELECT id, nama, nis FROM murid WHERE kelas_id = ? AND nama_norm = ? AND id != ?")
    .all(kelasId, norm, kecualiId) as { id: number; nama: string; nis: string }[];
  for (const r of rows) {
    if (nis && r.nis && nis !== r.nis) continue; // nama kembar, NIS beda -> orang berbeda
    return r;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Validasi daftar murid_id untuk satu kelompok (dipakai PUT siswa projek &
// PUT anggota senam). Mengembalikan daftar murid sesuai urutan kiriman, atau
// pesan error. Aturan: 1–12 murid, tidak dobel, terdaftar, rombelnya sama
// dengan rombel kelompok, dan belum masuk kelompok LAIN pada modul sama.
// ---------------------------------------------------------------------------
export function validasiPilihanMurid(
  modul: "projek" | "senam",
  kelompokId: number,
  kelasId: number,
  muridIds: unknown
): { murid: { id: number; nama: string }[] } | { error: string } {
  if (!Array.isArray(muridIds)) return { error: "Daftar murid wajib dipilih dari menu Murid (murid_ids)" };
  const ids = muridIds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0);
  if (ids.length < 1) return { error: "Minimal 1 murid per kelompok" };
  if (ids.length > 12) return { error: "Maksimal 12 murid per kelompok" };
  if (new Set(ids).size !== ids.length) return { error: "Ada murid yang dipilih dua kali" };
  const db = getDb();
  const tabelAnggota = modul === "projek" ? "siswa" : "senam_anggota";
  const hasil: { id: number; nama: string }[] = [];
  for (const id of ids) {
    const m = db
      .query("SELECT id, nama, kelas_id FROM murid WHERE id = ?")
      .get(id) as { id: number; nama: string; kelas_id: number } | null;
    if (!m) return { error: `Murid id ${id} tidak terdaftar di menu Murid` };
    if (m.kelas_id !== kelasId)
      return { error: `Murid "${m.nama}" bukan dari rombel kelompok ini — periksa menu Murid` };
    const dipakai = db
      .query(
        `SELECT kel.nama_kelompok FROM ${tabelAnggota} a
         JOIN ${modul === "projek" ? "kelompok" : "senam_kelompok"} kel ON kel.id = a.kelompok_id
         WHERE a.murid_id = ? AND a.kelompok_id != ?`
      )
      .get(id, kelompokId) as { nama_kelompok: string } | null;
    if (dipakai)
      return { error: `Murid "${m.nama}" sudah masuk ${dipakai.nama_kelompok} — keluarkan dulu dari kelompok itu` };
    hasil.push({ id: m.id, nama: m.nama });
  }
  return { murid: hasil };
}

// ---------------------------------------------------------------- daftar
sec("get", "/murid", (c) => {
  const kelasId = c.req.query("kelas_id");
  const q = (c.req.query("q") || "").trim();
  let sql = `SELECT m.*, k.nama AS kelas_nama, k.tingkat,
    (SELECT kel.nama_kelompok FROM siswa s JOIN kelompok kel ON kel.id = s.kelompok_id WHERE s.murid_id = m.id LIMIT 1) AS kelompok_projek,
    (SELECT kel.nama_kelompok FROM senam_anggota s JOIN senam_kelompok kel ON kel.id = s.kelompok_id WHERE s.murid_id = m.id LIMIT 1) AS kelompok_senam
    FROM murid m JOIN kelas k ON k.id = m.kelas_id`;
  const where: string[] = [];
  const params: any[] = [];
  if (kelasId) { where.push("m.kelas_id = ?"); params.push(kelasId); }
  if (q) { where.push("m.nama LIKE ?"); params.push(`%${q}%`); }
  if (where.length) sql += " WHERE " + where.join(" AND ");
  sql += " ORDER BY k.tingkat, k.nama, m.nama";
  return c.json({ murid: getDb().query(sql).all(...params) });
});

// ---------------------------------------------------------------- tambah
sec("post", "/murid", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const kelas_id = Number(b.kelas_id);
  const nama = namaRapi(b.nama || "");
  const nis = String(b.nis || "").trim();
  if (!kelas_id || !nama) return bad(c, "Kelas dan nama murid wajib diisi");
  const db = getDb();
  const kelas = db.query("SELECT id, nama FROM kelas WHERE id = ?").get(kelas_id) as { id: number; nama: string } | null;
  if (!kelas) return bad(c, "Kelas tidak ditemukan");
  const dup = cariDuplikatMurid(db, kelas_id, normalisasiNama(nama), nis);
  if (dup) return bad(c, `Murid "${dup.nama}" sudah terdaftar di kelas ${kelas.nama}${dup.nis ? ` (NIS ${dup.nis})` : ""}`);
  const r = db
    .query("INSERT INTO murid (kelas_id, nama, nis, nama_norm) VALUES (?, ?, ?, ?)")
    .run(kelas_id, nama, nis, normalisasiNama(nama));
  logAdmin(c, "Tambah murid", `${nama} • ${kelas.nama}`);
  return c.json({ ok: true, id: Number(r.lastInsertRowid) });
});

// ---------------------------------------------------------------- ubah
sec("put", "/murid/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json().catch(() => ({}));
  const nama = namaRapi(b.nama || "");
  const nis = String(b.nis || "").trim();
  const kelas_id = Number(b.kelas_id);
  if (!nama || !kelas_id) return bad(c, "Kelas dan nama murid wajib diisi");
  const db = getDb();
  const lama = db.query("SELECT id, kelas_id FROM murid WHERE id = ?").get(id) as { id: number; kelas_id: number } | null;
  if (!lama) return bad(c, "Murid tidak ditemukan", 404);
  if (kelas_id !== lama.kelas_id) {
    const terpakai =
      (db.query("SELECT COUNT(*) n FROM siswa WHERE murid_id = ?").get(id) as { n: number }).n +
      (db.query("SELECT COUNT(*) n FROM senam_anggota WHERE murid_id = ?").get(id) as { n: number }).n;
    if (terpakai > 0)
      return bad(c, "Murid ini sudah masuk kelompok — keluarkan dulu dari kelompoknya sebelum pindah rombel");
  }
  const dup = cariDuplikatMurid(db, kelas_id, normalisasiNama(nama), nis, id);
  if (dup) return bad(c, `Nama "${dup.nama}" sudah terdaftar di rombel tujuan`);
  db.query("UPDATE murid SET nama = ?, nis = ?, kelas_id = ?, nama_norm = ? WHERE id = ?")
    .run(nama, nis, kelas_id, normalisasiNama(nama), id);
  logAdmin(c, "Ubah murid", nama);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- hapus
sec("delete", "/murid/:id", (c) => {
  const id = Number(c.req.param("id"));
  const db = getDb();
  const m = db.query("SELECT nama FROM murid WHERE id = ?").get(id) as { nama: string } | null;
  if (!m) return bad(c, "Murid tidak ditemukan", 404);
  const terpakai =
    (db.query("SELECT COUNT(*) n FROM siswa WHERE murid_id = ?").get(id) as { n: number }).n +
    (db.query("SELECT COUNT(*) n FROM senam_anggota WHERE murid_id = ?").get(id) as { n: number }).n;
  if (terpakai > 0)
    return bad(c, `Murid "${m.nama}" sudah masuk kelompok — keluarkan dulu dari kelompoknya sebelum menghapus`);
  db.query("DELETE FROM murid WHERE id = ?").run(id);
  logAdmin(c, "Hapus murid", m.nama);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- impor
// Format: kelas,nama,nis — NIS boleh kosong. Kelas HARUS sudah terdaftar di
// menu Kelas (murid menempel ke rombel; impor tidak membuat rombel baru).
// Baris duplikat (di berkas atau di database) dilewati dan dilaporkan.
sec("post", "/murid/import", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const csv = String(b.csv || "");
  if (!csv.trim()) return bad(c, "Isi CSV kosong");
  const db = getDb();
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let start = 0;
  if (/kelas/i.test(lines[0]) && /nama/i.test(lines[0])) start = 1;
  const getKelas = db.query("SELECT id FROM kelas WHERE nama = ?");
  let okCount = 0;
  const peringatan: string[] = [];
  const tx = db.transaction(() => {
    for (let i = start; i < lines.length; i++) {
      const cols = parseBarisCsv(lines[i]);
      const [kelasNama, nama, nis] = [ (cols[0] || "").trim(), namaRapi(cols[1] || ""), (cols[2] || "").trim() ];
      const baris = `Baris ${i + 1}`;
      if (!kelasNama || !nama) { peringatan.push(`${baris} dilewati (kelas/nama kosong): ${lines[i]}`); continue; }
      const kelas = getKelas.get(kelasNama) as { id: number } | null;
      if (!kelas) { peringatan.push(`${baris} dilewati: kelas "${kelasNama}" belum terdaftar di menu Kelas`); continue; }
      if (cariDuplikatMurid(db, kelas.id, normalisasiNama(nama), nis)) {
        peringatan.push(`${baris} dilewati: "${nama}" sudah terdaftar di kelas ${kelasNama}`);
        continue;
      }
      db.query("INSERT INTO murid (kelas_id, nama, nis, nama_norm) VALUES (?, ?, ?, ?)")
        .run(kelas.id, nama, nis, normalisasiNama(nama));
      okCount++;
    }
  });
  try { tx(); } catch (e: any) { return bad(c, "Gagal impor murid: " + e.message); }
  logAdmin(c, "Impor CSV murid", `${okCount} murid diimpor${peringatan.length ? `, ${peringatan.length} dilewati` : ""}`);
  return c.json({ ok: true, diimpor: okCount, peringatan });
});

// Parser satu baris CSV sederhana (dukung tanda kutip) — pola sama dengan
// parser impor kelompok di admin.ts.
export function parseBarisCsv(line: string): string[] {
  const cols: string[] = [];
  let cur = "";
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === "," && !inQ) { cols.push(cur); cur = ""; }
    else cur += ch;
  }
  cols.push(cur);
  return cols;
}

// ---------------------------------------------------------------- pilihan ceklis
// Daftar murid satu rombel untuk panel ceklis kelompok (projek / senam):
// anggota kelompok ini dulu (sesuai urutan), lalu yang bebas (abjad), lalu
// yang sudah dipakai kelompok lain (abjad, ditandai untuk dinonaktifkan).
sec("get", "/murid/pilihan", (c) => {
  const modul = c.req.query("modul") === "senam" ? "senam" : "projek";
  const kelompokId = Number(c.req.query("kelompok_id"));
  if (!kelompokId) return bad(c, "kelompok_id wajib");
  const db = getDb();
  const tabelKelompok = modul === "projek" ? "kelompok" : "senam_kelompok";
  const tabelAnggota = modul === "projek" ? "siswa" : "senam_anggota";
  const kel = db
    .query(`SELECT id, kelas_id, nama_kelompok FROM ${tabelKelompok} WHERE id = ?`)
    .get(kelompokId) as { id: number; kelas_id: number; nama_kelompok: string } | null;
  if (!kel) return bad(c, "Kelompok tidak ditemukan", 404);
  const rows = db
    .query(
      `SELECT m.id, m.nama, m.nis,
              a.kelompok_id AS kelompok_saat_ini, a.urutan,
              (SELECT kel2.nama_kelompok FROM ${tabelKelompok} kel2 WHERE kel2.id = a.kelompok_id) AS kelompok_nama
       FROM murid m
       LEFT JOIN ${tabelAnggota} a ON a.murid_id = m.id
       WHERE m.kelas_id = ?
       ORDER BY CASE WHEN a.kelompok_id = ? THEN 0 WHEN a.kelompok_id IS NULL THEN 1 ELSE 2 END,
                CASE WHEN a.kelompok_id = ? THEN a.urutan ELSE 999 END, m.nama`
    )
    .all(kel.kelas_id, kelompokId, kelompokId) as any[];
  const pilihan = rows.map((r) => ({
    id: r.id,
    nama: r.nama,
    nis: r.nis,
    status: r.kelompok_saat_ini == null ? "bebas" : r.kelompok_saat_ini === kelompokId ? "kelompok_ini" : "kelompok_lain",
    kelompok_nama: r.kelompok_saat_ini != null && r.kelompok_saat_ini !== kelompokId ? r.kelompok_nama : null,
  }));
  return c.json({ kelompok: kel, pilihan });
});

export default murid;
