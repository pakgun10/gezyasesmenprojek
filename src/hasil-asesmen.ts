import { Hono } from "hono";
import { getDb } from "./db";
import { requireAuth, clientIp } from "./auth";
import { logAktivitas, aktorAdmin } from "./log";

// ===========================================================================
// Menu Hasil Asesmen (admin) — halaman tersendiri (hasil.html), bukan panel
// di admin.html. Dua versi dari satu payload yang sama:
//   - lengkap: kartu per kelompok (anggota + NIS, produk/cabang atau judul
//     penampilan, matriks penilai x kategori, rata-rata, deskripsi)
//   - ringkas: satu baris per murid (No, Nama, NIS, Kelas, Nilai Akhir,
//     Deskripsi) — nilai adalah nilai kelompoknya, karena nilai di sistem
//     ini per kelompok, bukan per murid.
// Aturan hitung (keputusan audit 2026-10-28, disetujui Pak Gun):
//   - nilai satu penilai = rata-rata 4 skor kategorinya (0–100), hanya
//     untuk penilai LENGKAP (4/4 kategori); penilai sebagian tidak ikut.
//   - Nilai Akhir kelompok = rata-rata nilai para penilai lengkap,
//     dibulatkan ke bilangan bulat terdekat (pembulatan hanya di akhir,
//     dari skor mentah). Tanpa penilai lengkap -> null ("Belum dinilai").
//   - Deskripsi: per kategori, dari kriteria yang dipilih para penilai
//     lengkap, ambil yang tertinggi (skor tersimpan tertinggi; seri ->
//     paling sering dipilih; masih seri -> skor_min tertinggi), lalu
//     gabung "NamaKategori: NamaKriteria" untuk keempat kategori.
//   - Peringkat memakai pola Hasil lama: nilai sama = peringkat sama
//     (1, 2, 2, 4), kelompok tanpa nilai di akhir tanpa peringkat.
// Panel Hasil lama (/api/hasil, /api/senam/hasil) tidak disentuh.
// ===========================================================================

const hasilAsesmen = new Hono();

function sec(method: "get", path: string, ...handlers: any[]) {
  (hasilAsesmen as any)[method](path, requireAuth, ...handlers);
}

function bad(c: any, msg: string, status = 400) {
  return c.json({ error: msg }, status);
}

type Modul = "projek" | "senam";

const MODUL: Record<
  Modul,
  {
    label: string;
    kategori: string;
    kriteria: string;
    kelompok: string;
    anggota: string;
    penilaian: string;
    foto: string;
  }
> = {
  projek: {
    label: "Projek",
    kategori: "kategori",
    kriteria: "kriteria",
    kelompok: "kelompok",
    anggota: "siswa",
    penilaian: "penilaian",
    foto: "foto",
  },
  senam: {
    label: "Senam",
    kategori: "senam_kategori",
    kriteria: "senam_kriteria",
    kelompok: "senam_kelompok",
    anggota: "senam_anggota",
    penilaian: "senam_penilaian",
    foto: "senam_foto",
  },
};

const bulat1 = (v: number) => Math.round(v * 10) / 10;

function hitungHasilAsesmen(modul: Modul, kelasId: number) {
  const db = getDb();
  const t = MODUL[modul];
  const kelas = db.query("SELECT id, nama, tingkat FROM kelas WHERE id = ?").get(kelasId) as any;
  if (!kelas) return null;
  const kats = db.query(`SELECT id, kode, nama FROM ${t.kategori} ORDER BY urutan`).all() as {
    id: number;
    kode: string;
    nama: string;
  }[];

  const kelompok =
    modul === "projek"
      ? (db
          .query(
            `SELECT kel.id, kel.nama_kelompok, cp.nama AS cabang_nama, kel.nama_produk,
                    NULL AS judul_penampilan
             FROM kelompok kel LEFT JOIN cabang_produk cp ON cp.id = kel.cabang_id
             WHERE kel.kelas_id = ? ORDER BY kel.nama_kelompok`
          )
          .all(kelasId) as any[])
      : (db
          .query(
            `SELECT kel.id, kel.nama_kelompok, NULL AS cabang_nama, NULL AS nama_produk,
                    kel.judul_penampilan
             FROM senam_kelompok kel WHERE kel.kelas_id = ? ORDER BY kel.nama_kelompok`
          )
          .all(kelasId) as any[]);

  const hasil = kelompok.map((kel) => {
    const anggota = db
      .query(
        `SELECT COALESCE(m.nama, s.nama) AS nama, COALESCE(m.nis, '') AS nis
         FROM ${t.anggota} s LEFT JOIN murid m ON m.id = s.murid_id
         WHERE s.kelompok_id = ? ORDER BY s.urutan, s.id`
      )
      .all(kel.id) as { nama: string; nis: string }[];
    const jmlFoto = (db.query(`SELECT COUNT(*) n FROM ${t.foto} WHERE kelompok_id = ?`).get(kel.id) as { n: number }).n;

    // Semua nilai kelompok ini, beserta identitas penilai & kriterianya.
    const rows = db
      .query(
        `SELECT p.juri_id, j.kode AS juri_kode, j.nama AS juri_nama,
                p.kategori_id, p.kriteria_id, kr.nama AS kriteria_nama, kr.skor_min,
                p.skor, p.updated_at
         FROM ${t.penilaian} p JOIN juri j ON j.id = p.juri_id
         JOIN ${t.kriteria} kr ON kr.id = p.kriteria_id
         WHERE p.kelompok_id = ? ORDER BY j.kode, p.kategori_id`
      )
      .all(kel.id) as any[];

    const penilaiMap = new Map<number, any>();
    for (const r of rows) {
      if (!penilaiMap.has(r.juri_id)) {
        penilaiMap.set(r.juri_id, {
          juri_id: r.juri_id,
          kode: r.juri_kode,
          nama: r.juri_nama,
          nilai: {} as Record<number, any>,
          terakhir_dinilai: r.updated_at,
        });
      }
      const p = penilaiMap.get(r.juri_id);
      p.nilai[r.kategori_id] = {
        kriteria_id: r.kriteria_id,
        kriteria_nama: r.kriteria_nama,
        skor: r.skor,
        skor_min: r.skor_min,
      };
      if (r.updated_at > p.terakhir_dinilai) p.terakhir_dinilai = r.updated_at;
    }
    const penilai = [...penilaiMap.values()].map((p) => {
      const jmlKategori = Object.keys(p.nilai).length;
      const lengkap = kats.length > 0 && jmlKategori === kats.length;
      const nilaiPenilai = lengkap
        ? bulat1(kats.reduce((a, k) => a + p.nilai[k.id].skor, 0) / kats.length)
        : null;
      return { ...p, jml_kategori: jmlKategori, lengkap, nilai_penilai: nilaiPenilai };
    });
    const lengkap = penilai.filter((p) => p.lengkap);
    const nilaiAkhir =
      lengkap.length > 0
        ? Math.round(lengkap.reduce((a, p) => a + p.nilai_penilai, 0) / lengkap.length)
        : null;

    // Rata-rata per kategori (dari penilai lengkap saja, satu himpunan
    // dengan Nilai Akhir supaya konsisten).
    const rataKategori: Record<number, number | null> = {};
    for (const k of kats) {
      rataKategori[k.id] =
        lengkap.length > 0
          ? bulat1(lengkap.reduce((a, p) => a + p.nilai[k.id].skor, 0) / lengkap.length)
          : null;
    }

    // Deskripsi: kriteria tertinggi per kategori dari penilai lengkap.
    let deskripsi = "Belum dinilai";
    if (lengkap.length > 0) {
      const segmen: string[] = [];
      for (const k of kats) {
        const grup = new Map<number, { nama: string; skorMin: number; skorMax: number; jumlah: number }>();
        for (const p of lengkap) {
          const e = p.nilai[k.id];
          const g = grup.get(e.kriteria_id) || { nama: e.kriteria_nama, skorMin: e.skor_min, skorMax: -1, jumlah: 0 };
          if (e.skor > g.skorMax) g.skorMax = e.skor;
          g.jumlah += 1;
          grup.set(e.kriteria_id, g);
        }
        const terbaik = [...grup.values()].sort(
          (a, b) => b.skorMax - a.skorMax || b.jumlah - a.jumlah || b.skorMin - a.skorMin
        )[0];
        segmen.push(`${k.nama}: ${terbaik ? terbaik.nama : "Belum dinilai"}`);
      }
      deskripsi = segmen.join("; ");
    }

    return {
      ...kel,
      anggota,
      jml_anggota: anggota.length,
      jml_foto: jmlFoto,
      penilai,
      jml_penilai: penilai.length,
      jml_penilai_lengkap: lengkap.length,
      rata_kategori: rataKategori,
      nilai_akhir: nilaiAkhir,
      deskripsi,
      peringkat: null as number | null,
    };
  });

  // Urut peringkat: nilai tertinggi dulu, tanpa nilai di akhir, seri
  // nama kelompok; peringkat kompetisi (nilai sama = peringkat sama).
  hasil.sort((a, b) => {
    if (a.nilai_akhir == null && b.nilai_akhir == null) return a.nama_kelompok.localeCompare(b.nama_kelompok);
    if (a.nilai_akhir == null) return 1;
    if (b.nilai_akhir == null) return -1;
    if (b.nilai_akhir !== a.nilai_akhir) return b.nilai_akhir - a.nilai_akhir;
    return a.nama_kelompok.localeCompare(b.nama_kelompok);
  });
  let peringkat = 0;
  let lastNilai: number | null = null;
  hasil.forEach((h, i) => {
    if (h.nilai_akhir == null) {
      h.peringkat = null;
    } else {
      if (lastNilai == null || h.nilai_akhir !== lastNilai) peringkat = i + 1;
      h.peringkat = peringkat;
      lastNilai = h.nilai_akhir;
    }
  });

  return { modul, modul_label: t.label, kelas, kategori: kats, kelompok: hasil, dihitung_pada: new Date().toISOString() };
}

sec("get", "/hasil-asesmen", (c) => {
  const modul = c.req.query("modul") as Modul;
  if (modul !== "projek" && modul !== "senam") return bad(c, "modul harus projek atau senam");
  const kelasId = Number(c.req.query("kelas_id"));
  if (!kelasId) return bad(c, "kelas_id wajib");
  const h = hitungHasilAsesmen(modul, kelasId);
  if (!h) return bad(c, "Kelas tidak ditemukan", 404);
  return c.json(h);
});

// ---------------------------------------------------------------- ekspor CSV
const escCsv = (v: any) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

sec("get", "/hasil-asesmen/export.csv", (c) => {
  const modul = c.req.query("modul") as Modul;
  const versi = c.req.query("versi") || "ringkas";
  if (modul !== "projek" && modul !== "senam") return bad(c, "modul harus projek atau senam");
  if (versi !== "lengkap" && versi !== "ringkas") return bad(c, "versi harus lengkap atau ringkas");
  const kelasId = Number(c.req.query("kelas_id"));
  if (!kelasId) return bad(c, "kelas_id wajib");
  const h = hitungHasilAsesmen(modul, kelasId);
  if (!h) return bad(c, "Kelas tidak ditemukan", 404);

  let lines: string[] = [];
  if (versi === "ringkas") {
    // Persis 6 kolom yang ditetapkan: satu baris per murid.
    lines.push(["No", "Nama", "NIS", "Kelas", "Nilai Akhir", "Deskripsi"].map(escCsv).join(","));
    let no = 0;
    for (const kel of h.kelompok) {
      for (const a of kel.anggota) {
        no += 1;
        lines.push([no, a.nama, a.nis, h.kelas.nama, kel.nilai_akhir ?? "", kel.deskripsi].map(escCsv).join(","));
      }
    }
  } else {
    // Format panjang: satu baris per kelompok x penilai x kategori, jadi
    // mudah disaring di Excel; kelompok tanpa penilai tetap muncul.
    lines.push(
      [
        "Peringkat", "Kelas", "Kelompok",
        modul === "projek" ? "Cabang Produk" : "Judul Penampilan",
        modul === "projek" ? "Nama Produk" : "",
        "Anggota", "Penilai", "Kategori", "Kriteria", "Skor",
        "Nilai Penilai", "Nilai Akhir", "Deskripsi",
      ]
        .filter((x) => x !== "")
        .map(escCsv)
        .join(",")
    );
    const anggotaCell = (kel: any) =>
      kel.anggota.map((a: any) => `${a.nama}${a.nis ? ` (${a.nis})` : ""}`).join("; ");
    for (const kel of h.kelompok) {
      const dasar = [
        kel.peringkat ?? "",
        h.kelas.nama,
        kel.nama_kelompok,
        modul === "projek" ? kel.cabang_nama || "" : kel.judul_penampilan || "",
      ];
      if (modul === "projek") dasar.push(kel.nama_produk || "");
      dasar.push(anggotaCell(kel));
      if (!kel.penilai.length) {
        lines.push([...dasar, "", "", "", "", "", kel.nilai_akhir ?? "", kel.deskripsi].map(escCsv).join(","));
        continue;
      }
      for (const p of kel.penilai) {
        for (const k of h.kategori) {
          const e = p.nilai[k.id];
          lines.push(
            [
              ...dasar,
              `${p.kode} — ${p.nama}`,
              k.nama,
              e ? e.kriteria_nama : "",
              e ? e.skor : "",
              p.nilai_penilai ?? "",
              kel.nilai_akhir ?? "",
              kel.deskripsi,
            ]
              .map(escCsv)
              .join(",")
          );
        }
      }
    }
  }

  const csv = "\uFEFF" + lines.join("\r\n");
  logAktivitas(
    aktorAdmin(c),
    "admin",
    "Ekspor CSV hasil asesmen",
    `${MODUL[modul].label} • Kelas ${h.kelas.nama} • versi ${versi}`,
    clientIp(c)
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hasil-asesmen-${modul}-${h.kelas.nama}-${versi}.csv"`,
    },
  });
});

export default hasilAsesmen;
