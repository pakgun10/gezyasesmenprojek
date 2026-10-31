import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootApp } from "../src/app";

// Dasbor (2026-10-31): Rekap per Kelas + kartu statistik + tab Kelas
// harus menggabungkan PROJEK dan SENAM. Regresi yang diperbaiki di sini:
// dasbor lama hanya JOIN tabel projek, sehingga kelas 7 selalu tampil
// 0 kelompok / 0 siswa / 0 nilai masuk meski kelompok senam sudah
// berisi anggota dan sudah dinilai lengkap.

process.env.ADMIN_PASSWORD = "test-admin-12345";

let app: Awaited<ReturnType<typeof bootApp>>;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "np-dashboard-test-"));
  app = await bootApp(dir);
});

function cookieOf(setCookie: string | null): string {
  if (!setCookie) throw new Error("tidak ada set-cookie");
  return setCookie.split(";")[0];
}

const json = (o: any) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) });
const auth = (cookie: string) => ({ cookie, "Content-Type": "application/json" });

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

describe("dasbor gabung projek + senam", () => {
  test("rekap per kelas, statistik, dan tab kelas menghitung senam", async () => {
    const admin = await loginAdmin();
    const mkKelas = async (nama: string, tingkat: string) => {
      const r = await app.request("/api/kelas", { ...json({ nama, tingkat }), headers: auth(admin) });
      expect(r.status).toBe(200);
      return (await r.json()).id as number;
    };
    const k71 = await mkKelas("7.1", "7");
    const k81 = await mkKelas("8.1", "8");
    await mkKelas("7.2", "7");
    const mkMurid = async (kelas_id: number, nama: string) => {
      const r = await app.request("/api/murid", { ...json({ kelas_id, nama }), headers: auth(admin) });
      expect(r.status).toBe(200);
      return (await r.json()).id as number;
    };
    const ani = await mkMurid(k71, "Ani");
    const budi = await mkMurid(k71, "Budi");
    const citra = await mkMurid(k71, "Citra");
    const dodi = await mkMurid(k71, "Dodi");
    const eka = await mkMurid(k81, "Eka");
    const fajar = await mkMurid(k81, "Fajar");

    // Senam 7.1: 2 kelompok x 2 anggota.
    const mkSenam = async (nama_kelompok: string, muridIds: number[]) => {
      const r = await app.request("/api/senam/kelompok", {
        ...json({ kelas_id: k71, nama_kelompok, judul_penampilan: "Senam Pagi" }),
        headers: auth(admin),
      });
      expect(r.status).toBe(200);
      const id = (await r.json()).id as number;
      const s = await app.request(`/api/senam/kelompok/${id}/anggota`, {
        ...json({ murid_ids: muridIds }),
        method: "PUT",
        headers: auth(admin),
      });
      expect(s.status).toBe(200);
      return id;
    };
    const ks1 = await mkSenam("Kelompok 1", [ani, budi]);
    await mkSenam("Kelompok 2", [citra, dodi]);

    // Projek 8.1: 1 kelompok x 2 anggota.
    const cab = await (await app.request("/api/cabang", { headers: { cookie: admin } })).json();
    const cabangId = cab.cabang.find((c: any) => c.kode === "makanan_ringan").id;
    const rk = await app.request("/api/kelompok", {
      ...json({ kelas_id: k81, nama_kelompok: "Kelompok 1", cabang_id: cabangId, nama_produk: "Dodol Nanas" }),
      headers: auth(admin),
    });
    expect(rk.status).toBe(200);
    const kp1 = (await rk.json()).id as number;
    const rs = await app.request(`/api/kelompok/${kp1}/siswa`, {
      ...json({ murid_ids: [eka, fajar] }),
      method: "PUT",
      headers: auth(admin),
    });
    expect(rs.status).toBe(200);

    // Satu penilai per modul, masing-masing memberi nilai.
    const mkJuri = async (kode: string) => {
      const r = await app.request("/api/juri", { ...json({ kode, nama: `Juri ${kode}`, pin: "1234" }), headers: auth(admin) });
      expect(r.status).toBe(200);
      return await loginJuri(kode, "1234");
    };
    const jSenam = await mkJuri("SN1");
    const jProjek = await mkJuri("PR1");
    // Senam: 2 nilai (2 kategori) untuk Kelompok 1.
    const katsSenam = await (await app.request("/api/senam/kategori", { headers: { cookie: admin } })).json();
    for (const kat of katsSenam.kategori.slice(0, 2)) {
      const kr = kat.kriteria[0];
      const r = await app.request("/api/senam/juri/nilai", {
        ...json({ kelompok_id: ks1, kategori_id: kat.id, kriteria_id: kr.id, skor: kr.skor_default }),
        headers: auth(jSenam),
      });
      expect(r.status).toBe(200);
    }
    // Projek: 1 nilai (1 kategori) untuk Kelompok 1.
    const katsProjek = await (await app.request("/api/juri/kategori", { headers: { cookie: jProjek } })).json();
    const kat0 = katsProjek.kategori[0];
    const kr0 = kat0.kriteria[0];
    const rp = await app.request("/api/juri/nilai", {
      ...json({ kelompok_id: kp1, kategori_id: kat0.id, kriteria_id: kr0.id, skor: kr0.skor_default }),
      headers: auth(jProjek),
    });
    expect(rp.status).toBe(200);

    // Dasbor.
    const d = await (await app.request("/api/dashboard", { headers: { cookie: admin } })).json();
    const per = new Map<string, any>(d.per_kelas.map((k: any) => [k.nama, k]));
    expect(per.get("7.1")).toMatchObject({ kelompok: 2, siswa: 4, nilai_masuk: 2 });
    expect(per.get("8.1")).toMatchObject({ kelompok: 1, siswa: 2, nilai_masuk: 1 });
    expect(per.get("7.2")).toMatchObject({ kelompok: 0, siswa: 0, nilai_masuk: 0 });
    expect(d.total_kelompok).toBe(3);
    expect(d.total_siswa).toBe(6);
    expect(d.total_penilaian).toBe(3);
    expect(d.total_kelas).toBe(3);

    // Tab Kelas.
    const kelas = await (await app.request("/api/kelas", { headers: { cookie: admin } })).json();
    const kMap = new Map<string, any>(kelas.kelas.map((k: any) => [k.nama, k]));
    expect(kMap.get("7.1")).toMatchObject({ jml_kelompok: 2, jml_siswa: 4 });
    expect(kMap.get("8.1")).toMatchObject({ jml_kelompok: 1, jml_siswa: 2 });
  });
});
