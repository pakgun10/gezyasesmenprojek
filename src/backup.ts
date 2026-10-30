import { Hono } from "hono";
import { getDb, getDataDir } from "./db";
import { requireAuth, clientIp } from "./auth";
import { logAktivitas, aktorAdmin } from "./log";
import { join, basename } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";

// ===========================================================================
// Backup & Restore seluruh data (2026-10-24, permintaan Pak Gun).
// Satu berkas JSON portabel berisi SEMUA tabel data (termasuk hash kata
// sandi akun & PIN penilai — bukan teks polos) + berkas foto dari folder
// uploads yang dikodekan base64, agar bisa dipulihkan ke instalasi kosong.
// Sesi login (admin & penilai) TIDAK ikut dibackup; setelah restore semua
// sesi dibersihkan dan pengguna wajib login ulang dengan kata sandi yang
// berlaku dari berkas backup.
// ===========================================================================

const backup = new Hono();

function sec(method: "get" | "post", path: string, ...handlers: any[]) {
  (backup as any)[method](path, requireAuth, ...handlers);
}

function bad(c: any, msg: string, status = 400) {
  return c.json({ error: msg }, status);
}

// Urutan induk -> anak (untuk INSERT). Penghapusan memakai urutan terbalik.
const TABEL: string[] = [
  "users",
  "juri",
  "kelas",
  "juri_tugas",
  "cabang_produk",
  "kategori",
  "kriteria",
  "senam_kategori",
  "senam_kriteria",
  "kelompok",
  "murid",
  "siswa",
  "senam_kelompok",
  "senam_anggota",
  "penilaian",
  "senam_penilaian",
  "foto",
  "senam_foto",
  "berita_acara",
  "senam_berita_acara",
  "aktivitas_log",
  "kehadiran",
];

const POLA_NAMA_BERKAS = /^[A-Za-z0-9._-]+$/;

// ---------------------------------------------------------------- unduh
sec("get", "/backup", (c) => {
  const db = getDb();
  const tabel: Record<string, any[]> = {};
  for (const t of TABEL) {
    tabel[t] = db.query(`SELECT * FROM ${t}`).all();
  }
  // Berkas foto yang dirujuk tabel foto/senam_foto dan benar-benar ada di disk
  const berkas: Record<string, string> = {};
  const hilang: string[] = [];
  const namaBerkas = new Set<string>();
  for (const t of ["foto", "senam_foto"] as const) {
    for (const r of tabel[t] as { filename: string }[]) namaBerkas.add(r.filename);
  }
  for (const nama of namaBerkas) {
    if (!POLA_NAMA_BERKAS.test(nama) || basename(nama) !== nama) continue;
    const path = join(getDataDir(), "uploads", nama);
    if (existsSync(path)) berkas[nama] = readFileSync(path).toString("base64");
    else hilang.push(nama);
  }
  const stamp = new Date().toISOString();
  const isi = {
    app: "gezyaspro-backup",
    format: 1,
    dibuat_pada: stamp,
    tabel,
    berkas,
    berkas_hilang: hilang,
  };
  logAktivitas(aktorAdmin(c), "admin", "Unduh backup data", `${Object.values(tabel).reduce((a, r) => a + r.length, 0)} baris, ${Object.keys(berkas).length} berkas foto`, clientIp(c));
  const namaUnduhan = `backup-gezyaspro-${stamp.slice(0, 10)}-${stamp.slice(11, 19).replace(/:/g, "")}.json`;
  return c.body(JSON.stringify(isi), 200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="${namaUnduhan}"`,
  });
});

// ---------------------------------------------------------------- pulihkan
sec("post", "/backup/restore", async (c) => {
  const aktor = aktorAdmin(c);
  const ip = clientIp(c);
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== "object" || Array.isArray(b)) return bad(c, "Berkas backup tidak valid (bukan JSON backup)");
  if ((b as any).app !== "gezyaspro-backup") return bad(c, "Berkas ini bukan backup GezyAspro");
  if (Number((b as any).format) !== 1) return bad(c, "Versi format backup tidak didukung aplikasi ini");
  const tabelIn = (b as any).tabel;
  if (!tabelIn || typeof tabelIn !== "object" || Array.isArray(tabelIn)) return bad(c, "Berkas backup tidak berisi data tabel");
  for (const t of TABEL) {
    if (tabelIn[t] !== undefined && !Array.isArray(tabelIn[t]))
      return bad(c, `Isi tabel ${t} pada backup tidak valid`);
    for (const row of tabelIn[t] || []) {
      if (!row || typeof row !== "object" || Array.isArray(row)) return bad(c, `Baris pada tabel ${t} tidak valid`);
    }
  }
  const berkasIn = ((b as any).berkas || {}) as Record<string, string>;
  for (const nama of Object.keys(berkasIn)) {
    if (!POLA_NAMA_BERKAS.test(nama) || basename(nama) !== nama)
      return bad(c, `Nama berkas tidak aman di dalam backup: ${nama}`);
  }

  const db = getDb();
  const kolomCache = new Map<string, string[]>();
  const kolomTabel = (t: string): string[] => {
    if (!kolomCache.has(t)) {
      kolomCache.set(
        t,
        (db.query(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((r) => r.name)
      );
    }
    return kolomCache.get(t)!;
  };

  const ringkasan: Record<string, number> = {};
  const tx = db.transaction(() => {
    for (const t of [...TABEL].reverse()) db.query(`DELETE FROM ${t}`).run();
    db.query("DELETE FROM sessions").run();
    db.query("DELETE FROM judge_sessions").run();
    for (const t of TABEL) {
      const rows: any[] = tabelIn[t] || [];
      const kolom = kolomTabel(t);
      ringkasan[t] = rows.length;
      for (const row of rows) {
        const pakai = kolom.filter((k) => k in row);
        if (!pakai.length) continue;
        db.query(
          `INSERT INTO ${t} (${pakai.join(", ")}) VALUES (${pakai.map(() => "?").join(", ")})`
        ).run(...pakai.map((k) => row[k]));
      }
    }
  });
  try {
    tx();
  } catch (e: any) {
    return bad(c, "Restore gagal, data lama tidak berubah: " + e.message);
  }

  // Sinkronkan folder uploads dengan isi backup (tulis dulu, baru bersihkan sisa)
  const dir = join(getDataDir(), "uploads");
  mkdirSync(dir, { recursive: true });
  const namaBaru = new Set(Object.keys(berkasIn));
  for (const [nama, b64] of Object.entries(berkasIn)) {
    writeFileSync(join(dir, nama), Buffer.from(b64, "base64"));
  }
  for (const nama of readdirSync(dir)) {
    if (!namaBaru.has(nama)) {
      try { unlinkSync(join(dir, nama)); } catch {}
    }
  }

  const total = Object.values(ringkasan).reduce((a, n) => a + n, 0);
  logAktivitas(aktor, "admin", "Restore backup data", `${total} baris dari backup ${(b as any).dibuat_pada || "?"}`, ip);
  return c.json({ ok: true, ringkasan, total_baris: total, jumlah_berkas: namaBaru.size });
});

export default backup;
