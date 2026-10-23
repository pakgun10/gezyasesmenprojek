import { getDb } from "./db";

// ---------------------------------------------------------------------------
// Log Aktivitas — pencatatan aksi admin & penilai ke tabel aktivitas_log.
// Prinsip: TIDAK PERNAH menggagalkan aksi utama. Setiap kegagalan mencatat
// ditelan diam-diam (try/catch), karena log adalah pengamat, bukan penentu.
// ---------------------------------------------------------------------------

export function logAktivitas(
  aktor: string,
  peran: "admin" | "penilai" | "sistem",
  aksi: string,
  detail = "",
  ip = ""
): void {
  try {
    getDb()
      .query("INSERT INTO aktivitas_log (aktor, peran, aksi, detail, ip) VALUES (?, ?, ?, ?, ?)")
      .run((aktor || "-").slice(0, 120), peran, (aksi || "-").slice(0, 120), (detail || "").slice(0, 300), (ip || "").slice(0, 64));
  } catch {
    // abaikan — aksi utama tidak boleh ikut gagal
  }
}

/** Nama aktor admin dari sesi login admin (requireAuth). */
export function aktorAdmin(c: any): string {
  try {
    const u = c.get("user") as { username?: string } | undefined;
    return u?.username || "admin";
  } catch {
    return "admin";
  }
}

/** Nama aktor penilai dari sesi penilai (requireJudge): "KODE — Nama". */
export function aktorPenilai(c: any): string {
  try {
    const j = c.get("juri") as { kode?: string; nama?: string } | undefined;
    if (!j) return "penilai";
    return `${j.kode || ""} — ${j.nama || ""}`.trim() || "penilai";
  } catch {
    return "penilai";
  }
}
