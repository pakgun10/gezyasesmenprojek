import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootApp } from "../src/app";

// Daftar Hadir per kelas (2026-10-30, permintaan Pak Gun: versi cetak +
// simpan). Aturan yang diuji di sini:
//   - daftar dirangkai dari kelompok di rombel itu, urut per kelompok,
//     nomor menerus; murid tanpa kelompok tidak muncul.
//   - baris belum tersimpan: status null (layar menampilkan Hadir
//     sebagai default, tetapi DB belum berisi apa-apa).
//   - simpan menimpa (upsert) per (tanggal, modul, anggota), bukan
//     menambah baris ganda; modul projek & senam tidak saling menimpa
//     meski id baris anggotanya sama.
//   - validasi: anggota dari rombel lain, status di luar daftar, dan
//     tanggal tidak valid ditolak 400; tanpa login admin ditolak 401.
//   - kehadiran ikut Backup & Restore (tabel kehadiran di TABEL).

process.env.ADMIN_PASSWORD = "test-admin-12345";

let app: Awaited<ReturnType<typeof bootApp>>;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "np-kehadiran-test-"));
  app = await bootApp(dir);
});

function cookieOf(setCookie: string | null): string {
  if (!setCookie) throw new Error("tidak ada set-cookie");
  return setCookie.split(";")[0];
}

async function loginAdmin(): Promise<string> {
  const res = await app.request("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "test-admin-12345" }),
  });
  if (res.status !== 200) throw new Error("login admin gagal: " + (await res.text()));
  return cookieOf(res.headers.get("set-cookie"));
}

const json = (o: any) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) });
const auth = (cookie: string) => ({ cookie, "Content-Type": "application/json" });

describe("daftar hadir", () => {
  let admin: string;
  let k81: number;
  let k82: number;
  let k71: number;
  let sAndi: number;
  let sBudi: number;
  let sCitra: number;
  let sLain: number;
  let sEka: number;
  const tanggal = "2026-10-30";

  beforeAll(async () => {
    admin = await loginAdmin();
    const mkKelas = async (nama: string, tingkat: string) => {
      const r = await app.request("/api/kelas", { ...json({ nama, tingkat }), headers: auth(admin) });
      expect(r.status).toBe(200);
      return (await r.json()).id as number;
    };
    k81 = await mkKelas("8.1", "8");
    k82 = await mkKelas("8.2", "8");
    k71 = await mkKelas("7.1", "7");
    const cab = await (await app.request("/api/cabang", { headers: { cookie: admin } })).json();
    const cabangId = cab.cabang.find((c: any) => c.kode === "makanan_ringan").id;
    const mkMurid = async (kelas_id: number, nama: string, nis = "") => {
      const r = await app.request("/api/murid", { ...json({ kelas_id, nama, nis }), headers: auth(admin) });
      expect(r.status).toBe(200);
      return (await r.json()).id as number;
    };
    const andi = await mkMurid(k81, "Andi", "0132505001");
    const budi = await mkMurid(k81, "Budi", "0132505002");
    const citra = await mkMurid(k81, "Citra");
    const lain = await mkMurid(k82, "Dodi");
    const eka = await mkMurid(k71, "Eka", "0132507001");
    const mkKel = async (kelas_id: number, nama_kelompok: string, muridIds: number[]) => {
      const r = await app.request("/api/kelompok", {
        ...json({ kelas_id, nama_kelompok, cabang_id: cabangId, nama_produk: "Dodol Nanas" }),
        headers: auth(admin),
      });
      expect(r.status).toBe(200);
      const id = (await r.json()).id as number;
      const s = await app.request(`/api/kelompok/${id}/siswa`, {
        ...json({ murid_ids: muridIds }),
        method: "PUT",
        headers: auth(admin),
      });
      expect(s.status).toBe(200);
      const d = await app.request(`/api/kelompok/${id}`, { headers: { cookie: admin } });
      // Bila endpoint detail tidak ada, ambil id anggota lewat daftar hadir.
      if (d.status === 200) return { id, siswa: await d.json() };
      return { id, siswa: null };
    };
    const kel1 = await mkKel(k81, "Kelompok 1", [andi, budi]);
    const kel2 = await mkKel(k81, "Kelompok 2", [citra]);
    await mkKel(k82, "Kelompok 1", [lain]);
    const rs = await app.request("/api/senam/kelompok", {
      ...json({ kelas_id: k71, nama_kelompok: "Kelompok 1", judul_penampilan: "Senam Pagi" }),
      headers: auth(admin),
    });
    expect(rs.status).toBe(200);
    const ks1 = (await rs.json()).id;
    const as = await app.request(`/api/senam/kelompok/${ks1}/anggota`, {
      ...json({ murid_ids: [eka] }),
      method: "PUT",
      headers: auth(admin),
    });
    expect(as.status).toBe(200);

    // Ambil id baris anggota lewat GET daftar hadir (belum tersimpan).
    const ambil = async (modul: string, kelas_id: number) => {
      const r = await app.request(`/api/kehadiran?modul=${modul}&kelas_id=${kelas_id}&tanggal=${tanggal}`, {
        headers: { cookie: admin },
      });
      expect(r.status).toBe(200);
      return await r.json();
    };
    const d81 = await ambil("projek", k81);
    const flat81 = d81.kelompok.flatMap((k: any) => k.anggota);
    expect(d81.kelompok.map((k: any) => k.nama_kelompok)).toEqual(["Kelompok 1", "Kelompok 2"]);
    expect(flat81.map((a: any) => a.nama)).toEqual(["Andi", "Budi", "Citra"]);
    expect(flat81.every((a: any) => a.status === null)).toBe(true);
    expect(d81.ada_tersimpan).toBe(false);
    [sAndi, sBudi, sCitra] = flat81.map((a: any) => a.anggota_id);
    const d82 = await ambil("projek", k82);
    [sLain] = d82.kelompok.flatMap((k: any) => k.anggota).map((a: any) => a.anggota_id);
    const d71 = await ambil("senam", k71);
    [sEka] = d71.kelompok.flatMap((k: any) => k.anggota).map((a: any) => a.anggota_id);
    expect(kel1.id && kel2.id && ks1).toBeTruthy();
  });

  test("tanpa login ditolak 401", async () => {
    const r = await app.request(`/api/kehadiran?modul=projek&kelas_id=${k81}&tanggal=${tanggal}`);
    expect(r.status).toBe(401);
  });

  test("validasi menolak anggota rombel lain, status liar, dan tanggal salah", async () => {
    const kirim = (body: any) => app.request("/api/kehadiran", { ...json(body), headers: auth(admin) });
    let r = await kirim({ modul: "projek", kelas_id: k81, tanggal, daftar: [{ anggota_id: sLain, status: "hadir", keterangan: "" }] });
    expect(r.status).toBe(400);
    r = await kirim({ modul: "projek", kelas_id: k81, tanggal, daftar: [{ anggota_id: sAndi, status: "kabur", keterangan: "" }] });
    expect(r.status).toBe(400);
    r = await kirim({ modul: "projek", kelas_id: k81, tanggal: "30-10-2026", daftar: [{ anggota_id: sAndi, status: "hadir", keterangan: "" }] });
    expect(r.status).toBe(400);
    r = await kirim({ modul: "projek", kelas_id: k81, tanggal, daftar: [] });
    expect(r.status).toBe(400);
  });

  test("simpan, baca ulang, lalu timpa (upsert) tanpa baris ganda", async () => {
    const simpan = async (daftar: any[]) => {
      const r = await app.request("/api/kehadiran", {
        ...json({ modul: "projek", kelas_id: k81, tanggal, daftar }),
        headers: auth(admin),
      });
      expect(r.status).toBe(200);
      return await r.json();
    };
    const baca = async () => {
      const r = await app.request(`/api/kehadiran?modul=projek&kelas_id=${k81}&tanggal=${tanggal}`, {
        headers: { cookie: admin },
      });
      expect(r.status).toBe(200);
      return await r.json();
    };
    let res = await simpan([
      { anggota_id: sAndi, status: "hadir", keterangan: "" },
      { anggota_id: sBudi, status: "izin", keterangan: "izin orang tua" },
      { anggota_id: sCitra, status: "alpa", keterangan: "" },
    ]);
    expect(res.tersimpan).toBe(3);
    expect(res.rekap).toEqual({ hadir: 1, izin: 1, sakit: 0, alpa: 1 });
    let d = await baca();
    expect(d.ada_tersimpan).toBe(true);
    expect(d.kelompok.flatMap((k: any) => k.anggota).map((a: any) => [a.nama, a.status, a.keterangan])).toEqual([
      ["Andi", "hadir", ""],
      ["Budi", "izin", "izin orang tua"],
      ["Citra", "alpa", ""],
    ]);
    // Simpan ulang dengan Budi berubah izin -> sakit: tetap 3 murid.
    res = await simpan([
      { anggota_id: sAndi, status: "hadir", keterangan: "" },
      { anggota_id: sBudi, status: "sakit", keterangan: "" },
      { anggota_id: sCitra, status: "alpa", keterangan: "" },
    ]);
    expect(res.rekap).toEqual({ hadir: 1, izin: 0, sakit: 1, alpa: 1 });
    d = await baca();
    expect(d.kelompok.flatMap((k: any) => k.anggota)).toHaveLength(3);
    expect(d.rekap).toEqual({ hadir: 1, izin: 0, sakit: 1, alpa: 1, belum: 0 });

    // Daftar tanggal tersimpan memuat tanggal ini.
    const t = await app.request(`/api/kehadiran/tanggal?modul=projek&kelas_id=${k81}`, { headers: { cookie: admin } });
    expect(t.status).toBe(200);
    expect((await t.json()).tanggal).toContain(tanggal);

    // CSV: header + 3 baris, status sudah dalam label Indonesia.
    const csv = await app.request(`/api/kehadiran/export.csv?modul=projek&kelas_id=${k81}&tanggal=${tanggal}`, {
      headers: { cookie: admin },
    });
    expect(csv.status).toBe(200);
    const teks = await csv.text();
    expect(teks.split("\r\n")[0]).toContain("No,Nama,NIS,Kelas,Kelompok,Status,Keterangan");
    expect(teks).toContain("Budi");
    expect(teks).toContain("Sakit");
    expect(teks).toContain("Alpa");
  });

  test("modul senam tidak menimpa projek meski id anggota sama", async () => {
    const r = await app.request("/api/kehadiran", {
      ...json({ modul: "senam", kelas_id: k71, tanggal, daftar: [{ anggota_id: sEka, status: "izin", keterangan: "" }] }),
      headers: auth(admin),
    });
    expect(r.status).toBe(200);
    const dSenam = await (
      await app.request(`/api/kehadiran?modul=senam&kelas_id=${k71}&tanggal=${tanggal}`, { headers: { cookie: admin } })
    ).json();
    expect(dSenam.kelompok.flatMap((k: any) => k.anggota).map((a: any) => a.status)).toEqual(["izin"]);
    const dProjek = await (
      await app.request(`/api/kehadiran?modul=projek&kelas_id=${k81}&tanggal=${tanggal}`, { headers: { cookie: admin } })
    ).json();
    expect(dProjek.kelompok.flatMap((k: any) => k.anggota).map((a: any) => a.status)).toEqual(["hadir", "sakit", "alpa"]);
  });

  test("kehadiran ikut dalam backup", async () => {
    const r = await app.request("/api/backup", { headers: { cookie: admin } });
    expect(r.status).toBe(200);
    const isi = await r.json();
    expect(Array.isArray(isi.tabel.kehadiran)).toBe(true);
    expect(isi.tabel.kehadiran.length).toBeGreaterThanOrEqual(4);
  });
});
