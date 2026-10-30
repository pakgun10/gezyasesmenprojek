import { Hono } from "hono";
import { getDb } from "./db";
import { requireAuth, clientIp } from "./auth";
import { logAktivitas, aktorAdmin } from "./log";

// ===========================================================================
// Daftar Hadir per kelas (admin) — halaman tersendiri (hadir.html), bukan
// panel di admin.html, mengikuti pola Hasil Asesmen (hasil.html).
//
// Keputusan desain (permintaan Pak Gun 2026-10-30, versi cetak + simpan):
//   - Satu daftar per (modul, rombel, tanggal). Isinya dirangkai dari
//     kelompok yang ada di rombel itu, diurutkan per kelompok, nomor
//     urut 1..N menerus (bukan mengulang per kelompok).
//   - Yang muncul hanya murid yang SUDAH masuk kelompok di rombel itu.
//     Murid tanpa kelompok tidak muncul — sesuai contoh Pak Gun yang
//     isinya "dibuat per kelompok". (Kalau nanti mau semua murid rombel
//     ikut muncul, sumbernya dialihkan ke tabel murid.)
//   - Status per murid: hadir / izin / sakit / alpa. Kolom Keterangan
//     bebas (mis. "izin orang tua") dan boleh kosong.
//   - Baris yang belum pernah disimpan tampil dengan status default
//     "hadir" di layar, tetapi BELUM tersimpan di DB sampai admin menekan
//     Simpan. Jadi tanggal tanpa baris kehadiran = belum pernah diabsen,
//     bukan "semua hadir".
//   - Identitas baris = id baris anggota (siswa.id untuk projek,
//     senam_anggota.id untuk senam), dibedakan oleh kolom modul. Nama &
//     NIS disalin sebagai snapshot saat simpan, supaya daftar tanggal
//     lama tidak ikut berubah bila nama/NIS murid dikoreksi belakangan.
//   - kelompok_id / anggota_id TIDAK memakai FOREIGN KEY, karena merujuk
//     ke dua pasang tabel berbeda tergantung modul; kebenaran "anggota
//     ini memang di rombel ini" ditegakkan di validasi POST di bawah.
//   - Khusus admin: memakai requireAuth (sesi admin users), sama seperti
//     endpoint admin lainnya. Sesi penilai tidak bisa membuka endpoint
//     ini karena cookie penilai berbeda.
// ===========================================================================

const kehadiran = new Hono();

function sec(method: "get" | "post", path: string, ...handlers: any[]) {
  (kehadiran as any)[method](path, requireAuth, ...handlers);
}

function bad(c: any, msg: string, status = 400) {
  return c.json({ error: msg }, status);
}

type Modul = "projek" | "senam";

const MODUL: Record<Modul, { label: string; kelompok: string; anggota: string }> = {
  projek: { label: "Projek", kelompok: "kelompok", anggota: "siswa" },
  senam: { label: "Senam", kelompok: "senam_kelompok", anggota: "senam_anggota" },
};

const STATUS = ["hadir", "izin", "sakit", "alpa"] as const;
type Status = (typeof STATUS)[number];

const STATUS_LABEL: Record<Status, string> = {
  hadir: "Hadir",
  izin: "Izin",
  sakit: "Sakit",
  alpa: "Alpa",
};

function modulDari(v: any): Modul | null {
  return v === "projek" || v === "senam" ? v : null;
}

function tanggalValid(v: any): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function muatDaftar(modul: Modul, kelasId: number, tanggal: string) {
  const db = getDb();
  const t = MODUL[modul];
  const kelas = db.query("SELECT id, nama, tingkat FROM kelas WHERE id = ?").get(kelasId) as any;
  if (!kelas) return null;
  const kelompok = db
    .query(`SELECT id, nama_kelompok FROM ${t.kelompok} WHERE kelas_id = ?`)
    .all(kelasId) as { id: number; nama_kelompok: string }[];
  // Urut natural ("Kelompok 2" sebelum "Kelompok 10"), bukan leksikal SQL.
  kelompok.sort((a, b) => a.nama_kelompok.localeCompare(b.nama_kelompok, "id", { numeric: true }));
  const tersimpan = db
    .query("SELECT anggota_id, status, keterangan FROM kehadiran WHERE tanggal = ? AND modul = ? AND kelas_id = ?")
    .all(tanggal, modul, kelasId) as { anggota_id: number; status: string; keterangan: string }[];
  const simpanMap = new Map<number, { status: string; keterangan: string }>();
  for (const r of tersimpan) simpanMap.set(r.anggota_id, { status: r.status, keterangan: r.keterangan });
  let jmlMurid = 0;
  const daftar = kelompok.map((kel) => {
    const anggota = db
      .query(
        `SELECT s.id AS anggota_id, COALESCE(m.nama, s.nama) AS nama, COALESCE(m.nis, '') AS nis
         FROM ${t.anggota} s LEFT JOIN murid m ON m.id = s.murid_id
         WHERE s.kelompok_id = ? ORDER BY s.urutan, s.id`
      )
      .all(kel.id) as { anggota_id: number; nama: string; nis: string }[];
    jmlMurid += anggota.length;
    return {
      id: kel.id,
      nama_kelompok: kel.nama_kelompok,
      anggota: anggota.map((a) => {
        const s = simpanMap.get(a.anggota_id);
        return {
          anggota_id: a.anggota_id,
          nama: a.nama,
          nis: a.nis,
          status: s ? s.status : null,
          keterangan: s ? s.keterangan : "",
          tersimpan: !!s,
        };
      }),
    };
  });
  const rekap: Record<string, number> = { hadir: 0, izin: 0, sakit: 0, alpa: 0, belum: 0 };
  for (const kel of daftar)
    for (const a of kel.anggota) {
      if (a.status && (STATUS as readonly string[]).includes(a.status)) rekap[a.status] += 1;
      else rekap.belum += 1;
    }
  return {
    modul,
    modul_label: t.label,
    kelas,
    tanggal,
    kelompok: daftar,
    jml_kelompok: daftar.length,
    jml_murid: jmlMurid,
    ada_tersimpan: tersimpan.length > 0,
    rekap,
  };
}

// ------------------------------------------------------------------ baca
sec("get", "/kehadiran", (c) => {
  const modul = modulDari(c.req.query("modul"));
  if (!modul) return bad(c, "modul harus projek atau senam");
  const kelasId = Number(c.req.query("kelas_id"));
  if (!kelasId) return bad(c, "kelas_id wajib");
  const tanggal = c.req.query("tanggal") || new Date().toISOString().slice(0, 10);
  if (!tanggalValid(tanggal)) return bad(c, "tanggal harus format YYYY-MM-DD yang valid");
  const d = muatDaftar(modul, kelasId, tanggal);
  if (!d) return bad(c, "Kelas tidak ditemukan", 404);
  return c.json(d);
});

sec("get", "/kehadiran/tanggal", (c) => {
  const modul = modulDari(c.req.query("modul"));
  if (!modul) return bad(c, "modul harus projek atau senam");
  const kelasId = Number(c.req.query("kelas_id"));
  if (!kelasId) return bad(c, "kelas_id wajib");
  const kelas = getDb().query("SELECT id, nama FROM kelas WHERE id = ?").get(kelasId) as any;
  if (!kelas) return bad(c, "Kelas tidak ditemukan", 404);
  const rows = getDb()
    .query("SELECT DISTINCT tanggal FROM kehadiran WHERE modul = ? AND kelas_id = ? ORDER BY tanggal DESC")
    .all(modul, kelasId) as { tanggal: string }[];
  return c.json({ modul, kelas, tanggal: rows.map((r) => r.tanggal) });
});

// ---------------------------------------------------------------- simpan
sec("post", "/kehadiran", async (c) => {
  let b: any;
  try {
    b = await c.req.json();
  } catch {
    return bad(c, "Body request tidak valid");
  }
  const modul = modulDari(b.modul);
  if (!modul) return bad(c, "modul harus projek atau senam");
  const kelasId = Number(b.kelas_id);
  if (!kelasId) return bad(c, "kelas_id wajib");
  if (!tanggalValid(b.tanggal)) return bad(c, "tanggal harus format YYYY-MM-DD yang valid");
  if (!Array.isArray(b.daftar)) return bad(c, "daftar harus berupa daftar");
  const db = getDb();
  const t = MODUL[modul];
  const kelas = db.query("SELECT id, nama FROM kelas WHERE id = ?").get(kelasId) as any;
  if (!kelas) return bad(c, "Kelas tidak ditemukan", 404);

  // Peta anggota yang sah di rombel ini (id -> kelompok, nama, NIS).
  const sah = db
    .query(
      `SELECT s.id AS anggota_id, s.kelompok_id, COALESCE(m.nama, s.nama) AS nama, COALESCE(m.nis, '') AS nis
       FROM ${t.anggota} s JOIN ${t.kelompok} kel ON kel.id = s.kelompok_id
       LEFT JOIN murid m ON m.id = s.murid_id
       WHERE kel.kelas_id = ?`
    )
    .all(kelasId) as { anggota_id: number; kelompok_id: number; nama: string; nis: string }[];
  const sahMap = new Map<number, { kelompok_id: number; nama: string; nis: string }>();
  for (const r of sah) sahMap.set(r.anggota_id, { kelompok_id: r.kelompok_id, nama: r.nama, nis: r.nis });

  const bersih: { anggota_id: number; kelompok_id: number; nama: string; nis: string; status: Status; keterangan: string }[] = [];
  const dilihat = new Set<number>();
  for (const item of b.daftar) {
    const anggotaId = Number(item?.anggota_id);
    if (!anggotaId || dilihat.has(anggotaId)) return bad(c, "daftar berisi anggota_id kosong atau ganda");
    dilihat.add(anggotaId);
    const ref = sahMap.get(anggotaId);
    if (!ref) return bad(c, `Anggota ${anggotaId} tidak ada di kelas ini`);
    if (!(STATUS as readonly string[]).includes(item?.status)) return bad(c, "status harus hadir, izin, sakit, atau alpa");
    const keterangan = typeof item?.keterangan === "string" ? item.keterangan.trim().slice(0, 200) : "";
    bersih.push({ anggota_id: anggotaId, kelompok_id: ref.kelompok_id, nama: ref.nama, nis: ref.nis, status: item.status, keterangan });
  }
  if (!bersih.length) return bad(c, "daftar kosong — tidak ada yang disimpan");

  const simpan = db.transaction(() => {
    const up = db.query(
      `INSERT INTO kehadiran (tanggal, modul, kelas_id, kelompok_id, anggota_id, nama, nis, status, keterangan, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(tanggal, modul, anggota_id) DO UPDATE SET
         kelas_id = excluded.kelas_id, kelompok_id = excluded.kelompok_id,
         nama = excluded.nama, nis = excluded.nis, status = excluded.status,
         keterangan = excluded.keterangan, updated_at = datetime('now')`
    );
    for (const r of bersih)
      up.run(b.tanggal, modul, kelasId, r.kelompok_id, r.anggota_id, r.nama, r.nis, r.status, r.keterangan);
  });
  simpan();

  const rekap: Record<string, number> = { hadir: 0, izin: 0, sakit: 0, alpa: 0 };
  for (const r of bersih) rekap[r.status] += 1;
  logAktivitas(
    aktorAdmin(c),
    "admin",
    "Simpan kehadiran",
    `${t.label} • Kelas ${kelas.nama} • ${b.tanggal} • ${bersih.length} murid (hadir ${rekap.hadir}, izin ${rekap.izin}, sakit ${rekap.sakit}, alpa ${rekap.alpa})`,
    clientIp(c)
  );
  return c.json({ ok: true, modul, kelas_id: kelasId, tanggal: b.tanggal, tersimpan: bersih.length, rekap });
});

// ---------------------------------------------------------------- ekspor CSV
const escCsv = (v: any) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

sec("get", "/kehadiran/export.csv", (c) => {
  const modul = modulDari(c.req.query("modul"));
  if (!modul) return bad(c, "modul harus projek atau senam");
  const kelasId = Number(c.req.query("kelas_id"));
  if (!kelasId) return bad(c, "kelas_id wajib");
  const tanggal = c.req.query("tanggal") || "";
  if (!tanggalValid(tanggal)) return bad(c, "tanggal harus format YYYY-MM-DD yang valid");
  const d = muatDaftar(modul, kelasId, tanggal);
  if (!d) return bad(c, "Kelas tidak ditemukan", 404);
  const lines: string[] = [
    ["No", "Nama", "NIS", "Kelas", "Kelompok", "Status", "Keterangan"].map(escCsv).join(","),
  ];
  let no = 0;
  for (const kel of d.kelompok) {
    for (const a of kel.anggota) {
      no += 1;
      lines.push(
        [
          no,
          a.nama,
          a.nis,
          d.kelas.nama,
          kel.nama_kelompok,
          a.status ? STATUS_LABEL[a.status as Status] || a.status : "Belum diabsen",
          a.keterangan,
        ]
          .map(escCsv)
          .join(",")
      );
    }
  }
  const csv = "\uFEFF" + lines.join("\r\n");
  logAktivitas(
    aktorAdmin(c),
    "admin",
    "Ekspor CSV kehadiran",
    `${MODUL[modul].label} • Kelas ${d.kelas.nama} • ${tanggal}`,
    clientIp(c)
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="kehadiran-${modul}-${d.kelas.nama}-${tanggal}.csv"`,
    },
  });
});

export default kehadiran;
