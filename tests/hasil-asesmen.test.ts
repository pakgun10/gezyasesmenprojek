import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootApp } from "../src/app";

// Menu Hasil Asesmen (hasil.html) — keputusan audit 2026-10-28 yang
// disetujui Pak Gun: satu payload untuk Lengkap & Ringkas; Nilai Akhir
// skala 100 dari penilai LENGKAP saja (rata-rata 4 kategori per penilai,
// lalu rata-rata antar penilai, dibulatkan); Deskripsi = kriteria
// tertinggi per kategori dari penilai lengkap.

process.env.ADMIN_PASSWORD = "test-admin-12345";

let app: Awaited<ReturnType<typeof bootApp>>;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "np-hasil-asesmen-test-"));
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

async function loginJuri(kode: string, pin: string): Promise<string> {
  const res = await app.request("/api/juri/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kode, pin }),
  });
  if (res.status !== 200) throw new Error("login juri gagal: " + (await res.text()));
  return cookieOf(res.headers.get("set-cookie"));
}

const json = (o: any) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) });
const auth = (cookie: string) => ({ cookie, "Content-Type": "application/json" });

describe("hasil asesmen", () => {
  let admin: string;
  let k81: number;
  let k82: number;
  let k71: number;
  let kp1: number;
  let kp2: number;
  let ks1: number;
  let katProjek: any[];
  let katSenam: any[];

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
      return id;
    };
    kp1 = await mkKel(k81, "Kelompok 1", [andi, budi]);
    kp2 = await mkKel(k81, "Kelompok 2", [citra]);
    const rs = await app.request("/api/senam/kelompok", {
      ...json({ kelas_id: k71, nama_kelompok: "Kelompok 1", judul_penampilan: "Senam Pagi" }),
      headers: auth(admin),
    });
    expect(rs.status).toBe(200);
    ks1 = (await rs.json()).id;
    const eka = await mkMurid(k71, "Eka", "0132507001");
    const as = await app.request(`/api/senam/kelompok/${ks1}/anggota`, {
      ...json({ murid_ids: [eka] }),
      method: "PUT",
      headers: auth(admin),
    });
    expect(as.status).toBe(200);

    // Tiga penilai: dua lengkap, satu sebagian (hanya kategori pertama).
    const juriCookies: Record<string, string> = {};
    for (const kode of ["HA1", "HA2", "HA3"]) {
      const r = await app.request("/api/juri", {
        ...json({ kode, nama: `Juri ${kode}`, pin: "1234" }),
        headers: auth(admin),
      });
      expect(r.status).toBe(200);
      juriCookies[kode] = await loginJuri(kode, "1234");
    }
    const kp = await app.request("/api/juri/kategori", { headers: { cookie: juriCookies.HA1 } });
    katProjek = (await kp.json()).kategori;
    const ks = await app.request("/api/senam/juri/kategori", { headers: { cookie: juriCookies.HA1 } });
    katSenam = (await ks.json()).kategori;
    const nilai = async (cookie: string, url: string, kelompok_id: number, kats: any[], idxKriteria: number) => {
      for (const kat of kats) {
        const kri = kat.kriteria[idxKriteria];
        const r = await app.request(url, {
          ...json({ kelompok_id, kategori_id: kat.id, kriteria_id: kri.id, skor: kri.skor_default }),
          headers: { cookie, "Content-Type": "application/json" },
        });
        expect(r.status).toBe(200);
      }
    };
    await nilai(juriCookies.HA1, "/api/juri/nilai", kp1, katProjek, 0);
    await nilai(juriCookies.HA2, "/api/juri/nilai", kp1, katProjek, 1);
    // HA3 hanya kategori pertama
    const kat0 = katProjek[0];
    const kri0 = kat0.kriteria[0];
    const r3 = await app.request("/api/juri/nilai", {
      ...json({ kelompok_id: kp1, kategori_id: kat0.id, kriteria_id: kri0.id, skor: kri0.skor_default }),
      headers: { cookie: juriCookies.HA3, "Content-Type": "application/json" },
    });
    expect(r3.status).toBe(200);
    await nilai(juriCookies.HA1, "/api/senam/juri/nilai", ks1, katSenam, 0);
  });

  test("tanpa login -> 401; modul salah -> 400; kelas tak dikenal -> 404", async () => {
    expect((await app.request(`/api/hasil-asesmen?modul=projek&kelas_id=${k81}`)).status).toBe(401);
    expect((await app.request(`/api/hasil-asesmen?modul=salah&kelas_id=${k81}`, { headers: { cookie: admin } })).status).toBe(400);
    expect((await app.request("/api/hasil-asesmen?modul=projek&kelas_id=999999", { headers: { cookie: admin } })).status).toBe(404);
  });

  test("projek: nilai akhir & deskripsi hanya dari penilai lengkap; sebagian tidak ikut", async () => {
    const h = await (await app.request(`/api/hasil-asesmen?modul=projek&kelas_id=${k81}`, { headers: { cookie: admin } })).json();
    expect(h.kelas.nama).toBe("8.1");
    expect(h.kategori.length).toBe(4);
    const g1 = h.kelompok.find((k: any) => k.id === kp1);
    expect(g1.peringkat).toBe(1);
    expect(g1.jml_penilai).toBe(3);
    expect(g1.jml_penilai_lengkap).toBe(2);
    // HA1 = 95 semua, HA2 = 84 semua -> rata-rata 89.5 -> bulat 90.
    expect(g1.nilai_akhir).toBe(90);
    expect(g1.anggota.map((a: any) => a.nama)).toEqual(["Andi", "Budi"]);
    expect(g1.anggota.find((a: any) => a.nama === "Andi").nis).toBe("0132505001");
    expect(g1.cabang_nama).toBeTruthy();
    expect(g1.nama_produk).toBe("Dodol Nanas");
    // Deskripsi memakai kriteria tertinggi (kriteria[0] dari HA1).
    for (const kat of katProjek) {
      expect(g1.deskripsi).toContain(`${kat.nama}: ${kat.kriteria[0].nama}`);
    }
    // Rata-rata per kategori dari penilai lengkap: (95+84)/2 = 89.5.
    for (const kat of katProjek) {
      expect(g1.rata_kategori[kat.id]).toBe(89.5);
    }
    const g2 = h.kelompok.find((k: any) => k.id === kp2);
    expect(g2.nilai_akhir).toBeNull();
    expect(g2.peringkat).toBeNull();
    expect(g2.deskripsi).toBe("Belum dinilai");
    expect(g2.anggota[0].nis).toBe("");
  });

  test("kelas tanpa kelompok -> daftar kosong; senam memakai judul penampilan", async () => {
    const h = await (await app.request(`/api/hasil-asesmen?modul=projek&kelas_id=${k82}`, { headers: { cookie: admin } })).json();
    expect(h.kelompok).toEqual([]);
    const s = await (await app.request(`/api/hasil-asesmen?modul=senam&kelas_id=${k71}`, { headers: { cookie: admin } })).json();
    const g = s.kelompok.find((k: any) => k.id === ks1);
    expect(g.judul_penampilan).toBe("Senam Pagi");
    expect(g.anggota.map((a: any) => a.nama)).toEqual(["Eka"]);
    const mean = katSenam.reduce((a: any, k: any) => a + k.kriteria[0].skor_default, 0) / katSenam.length;
    expect(g.nilai_akhir).toBe(Math.round(mean));
  });

  test("CSV ringkas: 6 kolom, satu baris per murid, nilai akhir & deskripsi", async () => {
    const r = await app.request(`/api/hasil-asesmen/export.csv?modul=projek&kelas_id=${k81}&versi=ringkas`, { headers: { cookie: admin } });
    expect(r.status).toBe(200);
    // BOM UTF-8 dicek dari byte mentah (.text() menghapus BOM saat decode).
    const buf = new Uint8Array(await r.arrayBuffer());
    expect([buf[0], buf[1], buf[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const teks = new TextDecoder("utf-8").decode(buf);
    expect(teks).toContain("No,Nama,NIS,Kelas,Nilai Akhir,Deskripsi");
    expect(teks).toContain("Andi,0132505001,8.1,90,");
    expect(teks).toContain("Citra,,8.1,,Belum dinilai");
  });

  test("CSV lengkap: baris per penilai x kategori", async () => {
    const r = await app.request(`/api/hasil-asesmen/export.csv?modul=projek&kelas_id=${k81}&versi=lengkap`, { headers: { cookie: admin } });
    expect(r.status).toBe(200);
    const teks = await r.text();
    expect(teks).toContain("Peringkat");
    expect(teks).toContain("HA1");
    expect(teks).toContain(katProjek[0].kriteria[0].nama);
  });
});
