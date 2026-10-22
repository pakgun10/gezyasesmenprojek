import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootApp } from "../src/app";

// Test modul Asesmen Senam (modul sejajar senam_*).
// Fokus ganda: (1) alur senam bekerja, (2) asesmen projek TIDAK terpengaruh.

process.env.ADMIN_PASSWORD = "test-admin-12345";

let app: Awaited<ReturnType<typeof bootApp>>;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "np-senam-test-"));
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

// ---------------------------------------------------------------------------
describe("senam: seed", () => {
  test("4 kategori senam + 16 kriteria terseed", async () => {
    const cookie = await loginAdmin();
    const res = await app.request("/api/senam/kategori", { headers: { cookie } });
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.kategori.length).toBe(4);
    expect(b.kategori.map((k: any) => k.kode)).toEqual([
      "kekompakan",
      "teknik",
      "kreativitas_senam",
      "penampilan",
    ]);
    for (const k of b.kategori) {
      expect(k.kriteria.length).toBe(4);
      for (const kr of k.kriteria) {
        expect(kr.skor_min).toBeLessThanOrEqual(kr.skor_default);
        expect(kr.skor_default).toBeLessThanOrEqual(kr.skor_max);
      }
    }
  });

  test("seed projek tidak ikut berubah (tetap 4 kategori projek)", async () => {
    const cookie = await loginAdmin();
    const res = await app.request("/api/kategori", { headers: { cookie } });
    const b = await res.json();
    expect(b.kategori.length).toBe(4);
    expect(b.kategori.map((k: any) => k.kode)).toEqual(["kreativitas", "kemasan", "rasa", "kolaborasi"]);
  });

  test("endpoint senam admin tanpa login -> 401", async () => {
    const res = await app.request("/api/senam/kelompok");
    expect(res.status).toBe(401);
    const res2 = await app.request("/api/senam/juri/kategori");
    expect(res2.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe("senam: kelompok & anggota", () => {
  let cookie: string;
  let kelasId: number;
  let kelompokId: number;

  beforeAll(async () => {
    cookie = await loginAdmin();
    const res = await app.request("/api/kelas", { ...json({ nama: "7A", tingkat: "7" }), headers: auth(cookie) });
    kelasId = (await res.json()).id;
  });

  test("tambah kelompok senam + anggota", async () => {
    let res = await app.request("/api/senam/kelompok", {
      ...json({ kelas_id: kelasId, nama_kelompok: "Kelompok 1", judul_penampilan: "Senam Anak Indonesia Hebat" }),
      headers: auth(cookie),
    });
    expect(res.status).toBe(200);
    kelompokId = (await res.json()).id;
    // nama duplikat di kelas yang sama ditolak
    res = await app.request("/api/senam/kelompok", {
      ...json({ kelas_id: kelasId, nama_kelompok: "Kelompok 1" }),
      headers: auth(cookie),
    });
    expect(res.status).toBe(400);
    // anggota 6 murid
    res = await app.request(`/api/senam/kelompok/${kelompokId}/anggota`, {
      ...json({ names: ["Andi", "Budi", "Citra", "Dewi", "Eka", "Fajar"] }),
      method: "PUT",
      headers: auth(cookie),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).jumlah).toBe(6);
    // detail
    res = await app.request(`/api/senam/kelompok/${kelompokId}`, { headers: { cookie } });
    const det = await res.json();
    expect(det.kelompok.judul_penampilan).toBe("Senam Anak Indonesia Hebat");
    expect(det.anggota.length).toBe(6);
  });

  test("nama kelompok yang sama boleh dipakai di modul projek (tabel berbeda)", async () => {
    const cabRes = await app.request("/api/cabang", { headers: { cookie } });
    const cabangId = (await cabRes.json()).cabang[0].id;
    const res = await app.request("/api/kelompok", {
      ...json({ kelas_id: kelasId, nama_kelompok: "Kelompok 1", cabang_id: cabangId, nama_produk: "Dodol Nanas" }),
      headers: auth(cookie),
    });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe("senam: juri & penilaian", () => {
  let cookie: string;
  let juriCookie: string;
  let kelasId: number;
  let kelompokId: number;
  let kategori: any[];

  beforeAll(async () => {
    cookie = await loginAdmin();
    let res = await app.request("/api/juri", {
      ...json({ kode: "JS1", nama: "Juri Senam", pin: "4321" }),
      headers: auth(cookie),
    });
    expect(res.status).toBe(200);
    juriCookie = await loginJuri("js1", "4321");
    // kelas + kelompok senam sendiri untuk alur juri
    res = await app.request("/api/kelas", { ...json({ nama: "9A", tingkat: "9" }), headers: auth(cookie) });
    kelasId = (await res.json()).id;
    res = await app.request("/api/senam/kelompok", {
      ...json({ kelas_id: kelasId, nama_kelompok: "Tim Garuda", judul_penampilan: "Senam Pramuka" }),
      headers: auth(cookie),
    });
    kelompokId = (await res.json()).id;
    res = await app.request("/api/senam/juri/kategori", { headers: { cookie: juriCookie } });
    kategori = (await res.json()).kategori;
  });

  test("kategori juri senam berisi 4 kategori senam (bukan projek)", async () => {
    expect(kategori.length).toBe(4);
    expect(kategori.map((k: any) => k.kode)).toContain("kekompakan");
    expect(kategori.map((k: any) => k.kode)).not.toContain("rasa");
  });

  test("daftar kelompok juri: total_kategori senam = 4", async () => {
    const res = await app.request(`/api/senam/juri/kelompok?kelas_id=${kelasId}`, { headers: { cookie: juriCookie } });
    const b = await res.json();
    expect(b.total_kategori).toBe(4);
    expect(b.kelompok.length).toBe(1);
    expect(b.kelompok[0].judul_penampilan).toBe("Senam Pramuka");
  });

  test("skor di luar rentang kriteria ditolak", async () => {
    const kat = kategori[0];
    const kri = kat.kriteria[0]; // 90-100
    const res = await app.request("/api/senam/juri/nilai", {
      ...json({ kelompok_id: kelompokId, kategori_id: kat.id, kriteria_id: kri.id, skor: 50 }),
      headers: auth(juriCookie),
    });
    expect(res.status).toBe(400);
  });

  test("simpan 4 nilai lalu upsert (ubah nilai)", async () => {
    for (const kat of kategori) {
      const kri = kat.kriteria[1]; // 78-89
      const res = await app.request("/api/senam/juri/nilai", {
        ...json({ kelompok_id: kelompokId, kategori_id: kat.id, kriteria_id: kri.id, skor: kri.skor_default }),
        headers: auth(juriCookie),
      });
      expect(res.status).toBe(200);
    }
    const kat = kategori[0];
    const kri = kat.kriteria[0];
    const res = await app.request("/api/senam/juri/nilai", {
      ...json({ kelompok_id: kelompokId, kategori_id: kat.id, kriteria_id: kri.id, skor: 95 }),
      headers: auth(juriCookie),
    });
    expect(res.status).toBe(200);
    const det = await app.request(`/api/senam/juri/kelompok/${kelompokId}`, { headers: { cookie: juriCookie } });
    const b = await det.json();
    expect(b.kelompok.nilai_saya.length).toBe(4);
    expect(b.kelompok.nilai_saya.find((n: any) => n.kategori_id === kat.id).skor).toBe(95);
  });

  test("upload foto penampilan: tersimpan, tersaji via /senam/uploads, tidak bocor ke /uploads projek", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    const fd = new FormData();
    fd.set("kelompok_id", String(kelompokId));
    fd.set("caption", "Formasi penutup");
    fd.set("foto", new File([png], "senam.png", { type: "image/png" }));
    let res = await app.request("/api/senam/juri/foto", { method: "POST", headers: { cookie: juriCookie }, body: fd });
    expect(res.status).toBe(200);
    const fotoId = (await res.json()).id;
    const det = await app.request(`/api/senam/juri/kelompok/${kelompokId}`, { headers: { cookie: juriCookie } });
    const fname = (await det.json()).kelompok.foto_saya[0].filename;
    expect(fname.startsWith("senam_")).toBe(true);
    res = await app.request(`/api/senam/uploads/${fname}`, { headers: { cookie: juriCookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
    // tanpa cookie -> 401
    res = await app.request(`/api/senam/uploads/${fname}`);
    expect(res.status).toBe(401);
    // endpoint uploads projek tidak mengenal file senam -> 404
    res = await app.request(`/api/uploads/${fname}`, { headers: { cookie: juriCookie } });
    expect(res.status).toBe(404);
    // hapus
    res = await app.request(`/api/senam/juri/foto/${fotoId}`, { method: "DELETE", headers: { cookie: juriCookie } });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe("senam: hasil, peringkat, CSV, berita acara", () => {
  let cookie: string;
  let kelasId: number;

  beforeAll(async () => {
    cookie = await loginAdmin();
    let res = await app.request("/api/kelas", { ...json({ nama: "8A", tingkat: "8" }), headers: auth(cookie) });
    kelasId = (await res.json()).id;
    const mkKel = async (nama: string, judul: string) => {
      const r = await app.request("/api/senam/kelompok", {
        ...json({ kelas_id: kelasId, nama_kelompok: nama, judul_penampilan: judul }),
        headers: auth(cookie),
      });
      return (await r.json()).id;
    };
    const kA = await mkKel("SA", "Senam Maumere");
    const kB = await mkKel("SB", "Senam Poco-Poco");
    // juri kedua
    await app.request("/api/juri", { ...json({ kode: "JS2", nama: "Juri Senam Dua", pin: "9999" }), headers: auth(cookie) });
    const jc1 = await loginJuri("JS1", "4321");
    const jc2 = await loginJuri("JS2", "9999");
    const rk = await app.request("/api/senam/juri/kategori", { headers: { cookie: jc1 } });
    const kats = (await rk.json()).kategori;
    // Juri1: SA 80 semua, SB 90 semua. Juri2: SA 90, SB 80 -> rata-rata 85 -> total 340, seri.
    const nilai = async (jc: string, kelId: number, skor: number) => {
      for (const kat of kats) {
        const kri = kat.kriteria.find((k: any) => skor >= k.skor_min && skor <= k.skor_max);
        const r = await app.request("/api/senam/juri/nilai", {
          ...json({ kelompok_id: kelId, kategori_id: kat.id, kriteria_id: kri.id, skor }),
          headers: auth(jc),
        });
        if (r.status !== 200) throw new Error("nilai senam gagal: " + (await r.text()));
      }
    };
    await nilai(jc1, kA, 80);
    await nilai(jc1, kB, 90);
    await nilai(jc2, kA, 90);
    await nilai(jc2, kB, 80);
  });

  test("peringkat seri & total benar", async () => {
    const res = await app.request(`/api/senam/hasil?kelas_id=${kelasId}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.hasil.length).toBe(2);
    for (const h of b.hasil) {
      expect(h.total).toBe(340);
      expect(h.peringkat).toBe(1);
      expect(h.jml_juri).toBe(2);
    }
    expect(b.hasil[0].nama_kelompok).toBe("SA");
    expect(b.hasil[0].judul_penampilan).toBe("Senam Maumere");
  });

  test("ekspor CSV senam", async () => {
    const res = await app.request(`/api/senam/hasil/export.csv?kelas_id=${kelasId}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const txt = await res.text();
    expect(txt).toContain("Judul Penampilan");
    expect(txt).toContain("Kekompakan");
    expect(txt).toContain("340");
  });

  test("berita acara senam terpisah dari berita acara projek (kelas sama)", async () => {
    let res = await app.request("/api/senam/berita-acara", {
      ...json({ kelas_id: kelasId, nomor: "01/BA-Senam/2026", tempat: "Punggur", tanggal: "2026-10-13", mengetahui_nama: "Bu Helmi", dibuat_nama: "Pak Gun" }),
      method: "PUT",
      headers: auth(cookie),
    });
    expect(res.status).toBe(200);
    res = await app.request("/api/berita-acara", {
      ...json({ kelas_id: kelasId, nomor: "09/BA-Projek/2026", tempat: "Punggur", tanggal: "2026-10-10", mengetahui_nama: "Bu Helmi", dibuat_nama: "Pak Gun" }),
      method: "PUT",
      headers: auth(cookie),
    });
    expect(res.status).toBe(200);
    // keduanya utuh dengan nomor masing-masing
    res = await app.request(`/api/senam/berita-acara?kelas_id=${kelasId}`, { headers: { cookie } });
    expect((await res.json()).berita_acara.nomor).toBe("01/BA-Senam/2026");
    res = await app.request(`/api/berita-acara?kelas_id=${kelasId}`, { headers: { cookie } });
    expect((await res.json()).berita_acara.nomor).toBe("09/BA-Projek/2026");
  });
});

// ---------------------------------------------------------------------------
describe("senam: tidak mencemari asesmen projek", () => {
  test("dashboard projek tidak menghitung data senam", async () => {
    const cookie = await loginAdmin();
    const res = await app.request("/api/dashboard", { headers: { cookie } });
    expect(res.status).toBe(200);
    const d = await res.json();
    // Di file test ini hanya dibuat 1 kelompok projek (uji nama sama di atas);
    // kelompok senam ada 4 dan penilaian senam ada banyak — tidak boleh terhitung.
    expect(d.total_kelompok).toBe(1);
    expect(d.total_penilaian).toBe(0);
    expect(d.total_foto).toBe(0);
  });

  test("hasil projek kelas tanpa kelompok projek tetap kosong", async () => {
    const cookie = await loginAdmin();
    // kelas 8A hanya punya kelompok senam
    const kelasRes = await app.request("/api/kelas", { headers: { cookie } });
    const k8a = (await kelasRes.json()).kelas.find((k: any) => k.nama === "8A");
    const res = await app.request(`/api/hasil?kelas_id=${k8a.id}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.hasil.length).toBe(0);
  });
});
