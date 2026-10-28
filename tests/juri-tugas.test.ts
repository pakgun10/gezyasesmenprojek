import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootApp } from "../src/app";

// Tugas penilai per kelas (rombel), diputuskan Pak Gun 2026-10-28.
// Prinsip yang diuji: penilai TANPA tugas = tidak dibatasi (perilaku
// lama); penilai BERTUGAS hanya melihat/menilai kelas tugasnya, di
// modul projek maupun senam, dan pembatasan ditegakkan di server
// (daftar, detail, simpan nilai) — bukan sekadar disembunyikan di UI.

process.env.ADMIN_PASSWORD = "test-admin-12345";

let app: Awaited<ReturnType<typeof bootApp>>;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "np-juri-tugas-test-"));
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
const putJson = (cookie: string, o: any) => ({ method: "PUT", headers: auth(cookie), body: JSON.stringify(o) });

describe("tugas penilai per kelas", () => {
  let admin: string;
  let juriTugas: string;
  let juriBebas: string;
  let juriId: number;
  let k81: number;
  let k82: number;
  let k71: number;
  let kp1: number;
  let kp2: number;
  let ks1: number;
  let katProjek: any;
  let katSenam: any;

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
    const mkKel = async (kelas_id: number, nama_kelompok: string) => {
      const r = await app.request("/api/kelompok", {
        ...json({ kelas_id, nama_kelompok, cabang_id: cabangId, nama_produk: "Dodol Nanas" }),
        headers: auth(admin),
      });
      expect(r.status).toBe(200);
      return (await r.json()).id as number;
    };
    kp1 = await mkKel(k81, "Kelompok 1");
    kp2 = await mkKel(k82, "Kelompok 1");
    const rs = await app.request("/api/senam/kelompok", {
      ...json({ kelas_id: k71, nama_kelompok: "Kelompok 1", judul_penampilan: "Senam Pagi" }),
      headers: auth(admin),
    });
    expect(rs.status).toBe(200);
    ks1 = (await rs.json()).id;
    const rj = await app.request("/api/juri", {
      ...json({ kode: "JT1", nama: "Juri Tugas", pin: "1234" }),
      headers: auth(admin),
    });
    expect(rj.status).toBe(200);
    juriId = (await rj.json()).id;
    const rj2 = await app.request("/api/juri", {
      ...json({ kode: "JT2", nama: "Juri Bebas", pin: "1234" }),
      headers: auth(admin),
    });
    expect(rj2.status).toBe(200);
    juriTugas = await loginJuri("JT1", "1234");
    juriBebas = await loginJuri("JT2", "1234");
    const kp = await app.request("/api/juri/kategori", { headers: { cookie: juriTugas } });
    katProjek = (await kp.json()).kategori[0];
    const ks = await app.request("/api/senam/juri/kategori", { headers: { cookie: juriTugas } });
    katSenam = (await ks.json()).kategori[0];
  });

  test("penilai tanpa tugas melihat semua kelas (projek & senam)", async () => {
    const p = await (await app.request("/api/juri/kelas", { headers: { cookie: juriBebas } })).json();
    expect(p.terbatas).toBe(false);
    expect(p.kelas.map((k: any) => k.id).sort()).toEqual([k71, k81, k82].sort());
    const s = await (await app.request("/api/senam/juri/kelas", { headers: { cookie: juriBebas } })).json();
    expect(s.terbatas).toBe(false);
    expect(s.kelas.map((k: any) => k.id).sort()).toEqual([k71, k81, k82].sort());
  });

  test("admin mengatur tugas hanya 8.1; daftar admin menampilkannya", async () => {
    const r = await app.request(`/api/juri/${juriId}/tugas`, putJson(admin, { kelas_ids: [k81] }));
    expect(r.status).toBe(200);
    const list = await (await app.request("/api/juri", { headers: { cookie: admin } })).json();
    const j = list.juri.find((x: any) => x.id === juriId);
    expect(j.tugas_kelas.map((t: any) => t.kelas_id)).toEqual([k81]);
    const p = await (await app.request("/api/juri/kelas", { headers: { cookie: juriTugas } })).json();
    expect(p.terbatas).toBe(true);
    expect(p.kelas.map((k: any) => k.id)).toEqual([k81]);
  });

  test("kelompok di luar tugas tidak bocor: daftar kosong, detail & nilai 403", async () => {
    const list = await (await app.request(`/api/juri/kelompok?kelas_id=${k82}`, { headers: { cookie: juriTugas } })).json();
    expect(list.kelompok).toEqual([]);
    const det = await app.request(`/api/juri/kelompok/${kp2}`, { headers: { cookie: juriTugas } });
    expect(det.status).toBe(403);
    const kri = katProjek.kriteria[1];
    const nil = await app.request("/api/juri/nilai", {
      ...json({ kelompok_id: kp2, kategori_id: katProjek.id, kriteria_id: kri.id, skor: kri.skor_default }),
      headers: { cookie: juriTugas, "Content-Type": "application/json" },
    });
    expect(nil.status).toBe(403);
  });

  test("kelompok dalam tugas tetap bisa dibuka dan dinilai", async () => {
    const det = await app.request(`/api/juri/kelompok/${kp1}`, { headers: { cookie: juriTugas } });
    expect(det.status).toBe(200);
    const kri = katProjek.kriteria[1];
    const nil = await app.request("/api/juri/nilai", {
      ...json({ kelompok_id: kp1, kategori_id: katProjek.id, kriteria_id: kri.id, skor: kri.skor_default }),
      headers: { cookie: juriTugas, "Content-Type": "application/json" },
    });
    expect(nil.status).toBe(200);
  });

  test("senam ikut terfilter tugas yang sama", async () => {
    const s = await (await app.request("/api/senam/juri/kelas", { headers: { cookie: juriTugas } })).json();
    expect(s.kelas.map((k: any) => k.id)).toEqual([k81]);
    const list = await (await app.request(`/api/senam/juri/kelompok?kelas_id=${k71}`, { headers: { cookie: juriTugas } })).json();
    expect(list.kelompok).toEqual([]);
    const det = await app.request(`/api/senam/juri/kelompok/${ks1}`, { headers: { cookie: juriTugas } });
    expect(det.status).toBe(403);
    const kri = katSenam.kriteria[1];
    const nil = await app.request("/api/senam/juri/nilai", {
      ...json({ kelompok_id: ks1, kategori_id: katSenam.id, kriteria_id: kri.id, skor: kri.skor_default }),
      headers: { cookie: juriTugas, "Content-Type": "application/json" },
    });
    expect(nil.status).toBe(403);
  });

  test("tugas ditambah 7.1, senam terbuka; kelas tidak dikenal ditolak tanpa mengubah tugas", async () => {
    const r = await app.request(`/api/juri/${juriId}/tugas`, putJson(admin, { kelas_ids: [k81, k71] }));
    expect(r.status).toBe(200);
    const list = await (await app.request(`/api/senam/juri/kelompok?kelas_id=${k71}`, { headers: { cookie: juriTugas } })).json();
    expect(list.kelompok.map((g: any) => g.id)).toEqual([ks1]);
    const kri = katSenam.kriteria[1];
    const nil = await app.request("/api/senam/juri/nilai", {
      ...json({ kelompok_id: ks1, kategori_id: katSenam.id, kriteria_id: kri.id, skor: kri.skor_default }),
      headers: { cookie: juriTugas, "Content-Type": "application/json" },
    });
    expect(nil.status).toBe(200);
    const bad = await app.request(`/api/juri/${juriId}/tugas`, putJson(admin, { kelas_ids: [999999] }));
    expect(bad.status).toBe(400);
    const p = await (await app.request("/api/juri/kelas", { headers: { cookie: juriTugas } })).json();
    expect(p.kelas.map((k: any) => k.id).sort()).toEqual([k71, k81].sort());
  });

  test("tugas dikosongkan = penilai kembali melihat semua kelas", async () => {
    const r = await app.request(`/api/juri/${juriId}/tugas`, putJson(admin, { kelas_ids: [] }));
    expect(r.status).toBe(200);
    const p = await (await app.request("/api/juri/kelas", { headers: { cookie: juriTugas } })).json();
    expect(p.terbatas).toBe(false);
    expect(p.kelas.map((k: any) => k.id).sort()).toEqual([k71, k81, k82].sort());
  });
});
