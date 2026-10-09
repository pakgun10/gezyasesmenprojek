import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootApp } from "../src/app";

process.env.ADMIN_PASSWORD = "test-admin-12345";

let app: Awaited<ReturnType<typeof bootApp>>;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "np-test-"));
  app = await bootApp(dir);
});

function adminCookie(setCookie: string | null): string {
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
  return adminCookie(res.headers.get("set-cookie"));
}

const json = (o: any) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) });

// ---------------------------------------------------------------------------
describe("seed & auth", () => {
  test("health ok", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.ok).toBe(true);
  });

  test("4 kategori + 16 kriteria terseed", async () => {
    const cookie = await loginAdmin();
    const res = await app.request("/api/kategori", { headers: { cookie } });
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.kategori.length).toBe(4);
    expect(b.kategori.map((k: any) => k.kode)).toEqual(["kreativitas", "kemasan", "rasa", "kolaborasi"]);
    for (const k of b.kategori) {
      expect(k.kriteria.length).toBe(4);
      for (const kr of k.kriteria) {
        expect(kr.skor_min).toBeLessThanOrEqual(kr.skor_default);
        expect(kr.skor_default).toBeLessThanOrEqual(kr.skor_max);
        expect(kr.skor_max).toBeLessThanOrEqual(100);
      }
    }
  });

  test("login salah -> 401, endpoint admin tanpa login -> 401", async () => {
    const res = await app.request("/api/login", json({ username: "admin", password: "salah" }));
    expect(res.status).toBe(401);
    const res2 = await app.request("/api/dashboard");
    expect(res2.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe("kelas & kelompok", () => {
  let cookie: string;
  let kelasId: number;

  beforeAll(async () => {
    cookie = await loginAdmin();
  });

  test("CRUD kelas", async () => {
    let res = await app.request("/api/kelas", { ...json({ nama: "7A", tingkat: "7" }), headers: { cookie, "Content-Type": "application/json" } });
    expect(res.status).toBe(200);
    kelasId = (await res.json()).id;
    // duplikat ditolak
    res = await app.request("/api/kelas", { ...json({ nama: "7A", tingkat: "7" }), headers: { cookie, "Content-Type": "application/json" } });
    expect(res.status).toBe(400);
    res = await app.request("/api/kelas", { headers: { cookie } });
    expect((await res.json()).kelas.length).toBe(1);
  });

  test("cabang produk: seed + CRUD", async () => {
    let res = await app.request("/api/cabang", { headers: { cookie } });
    expect(res.status).toBe(200);
    let cabang = (await res.json()).cabang;
    expect(cabang.length).toBe(3); // Olahan Nanas, Makanan Ringan, Olahan Minuman
    res = await app.request("/api/cabang", {
      ...json({ nama: "Olahan Singkong", deskripsi: "Produk dari singkong" }),
      headers: { cookie, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const newId = (await res.json()).id;
    // duplikat nama ditolak
    res = await app.request("/api/cabang", {
      ...json({ nama: "Olahan Singkong" }),
      headers: { cookie, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    res = await app.request(`/api/cabang/${newId}`, { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(200);
    // hapus cabang yang dipakai kelompok -> 400 (diuji di bawah setelah ada kelompok)
    (globalThis as any).__cabangOlahanNanas = cabang.find((c: any) => c.kode === "olahan_nanas").id;
  });

  test("tambah kelompok + siswa", async () => {
    const cabangId = (globalThis as any).__cabangOlahanNanas as number;
    let res = await app.request("/api/kelas", { ...json({ nama: "7B", tingkat: "7" }), headers: { cookie, "Content-Type": "application/json" } });
    const k7b = (await res.json()).id;
    res = await app.request(
      "/api/kelompok",
      { ...json({ kelas_id: k7b, nama_kelompok: "Kelompok 1", cabang_id: cabangId, nama_produk: "Dodol Nanas" }), headers: { cookie, "Content-Type": "application/json" } }
    );
    expect(res.status).toBe(200);
    const kelId = (await res.json()).id;
    res = await app.request(`/api/kelompok/${kelId}/siswa`, {
      ...json({ names: ["Andi", "Budi", "Citra", "Dewi"] }),
      method: "PUT",
      headers: { cookie, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).jumlah).toBe(4);
    res = await app.request(`/api/kelompok/${kelId}`, { headers: { cookie } });
    const det = await res.json();
    expect(det.siswa.length).toBe(4);
    expect(det.kelompok.nama_produk).toBe("Dodol Nanas");
  });

  test("hapus cabang yang masih dipakai -> 400", async () => {
    const cabangId = (globalThis as any).__cabangOlahanNanas as number;
    const res = await app.request(`/api/cabang/${cabangId}`, { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(400);
  });

  test("impor CSV massal (cabang otomatis dibuat bila baru)", async () => {
    const csv = `nama_kelompok,kelas,tingkat,cabang,nama_produk,murid
Kelompok 1,8A,8,Olahan Nanas,Selai Nanas,Ani;Budi;Caca;Dodi
Kelompok 2,8A,8,Makanan Ringan,Salad Buah,Eka;Fajar;Gita;Hadi;Ira
Kelompok 3,8A,8,Olahan Minuman,Es Nanas,Joko;Kiki`;
    const res = await app.request("/api/kelompok/import", {
      ...json({ csv }),
      headers: { cookie, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.diimpor).toBe(3);
    const list = await app.request("/api/kelompok?q=Salad", { headers: { cookie } });
    const items = (await list.json()).kelompok;
    expect(items.length).toBe(1);
    expect(items[0].cabang_nama).toBe("Makanan Ringan");
  });
});

// ---------------------------------------------------------------------------
describe("juri & penilaian", () => {
  let cookie: string;
  let juriCookie: string;
  let kelompokId: number;
  let kategori: any[];

  beforeAll(async () => {
    cookie = await loginAdmin();
    // juri
    let res = await app.request("/api/juri", {
      ...json({ kode: "J01", nama: "Pak Juri", pin: "1234" }),
      headers: { cookie, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    // PIN salah format ditolak
    res = await app.request("/api/juri", {
      ...json({ kode: "J02", nama: "Bu Juri", pin: "abc" }),
      headers: { cookie, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    // login juri
    res = await app.request("/api/juri/login", json({ kode: "j01", pin: "1234" }));
    expect(res.status).toBe(200);
    juriCookie = adminCookie(res.headers.get("set-cookie"));
    // siapkan kelompok
    res = await app.request("/api/kelas", { ...json({ nama: "9A", tingkat: "9" }), headers: { cookie, "Content-Type": "application/json" } });
    const k9a = (await res.json()).id;
    const cabRes = await app.request("/api/cabang", { headers: { cookie } });
    const cabangId = (await cabRes.json()).cabang.find((c: any) => c.kode === "makanan_ringan").id;
    res = await app.request(
      "/api/kelompok",
      { ...json({ kelas_id: k9a, nama_kelompok: "K1", cabang_id: cabangId, nama_produk: "Sop Buah" }), headers: { cookie, "Content-Type": "application/json" } }
    );
    kelompokId = (await res.json()).id;
    res = await app.request("/api/juri/kategori", { headers: { cookie: juriCookie } });
    kategori = (await res.json()).kategori;
  });

  test("juri tanpa login -> 401", async () => {
    const res = await app.request("/api/juri/kelas");
    expect(res.status).toBe(401);
  });

  test("skor di luar rentang kriteria ditolak", async () => {
    const kat = kategori[0];
    const kri = kat.kriteria[0]; // 90-100
    const res = await app.request("/api/juri/nilai", {
      ...json({ kelompok_id: kelompokId, kategori_id: kat.id, kriteria_id: kri.id, skor: 50 }),
      headers: { cookie: juriCookie, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  test("simpan 4 nilai lalu upsert (ubah nilai)", async () => {
    for (const kat of kategori) {
      const kri = kat.kriteria[1]; // 78-89
      const res = await app.request("/api/juri/nilai", {
        ...json({ kelompok_id: kelompokId, kategori_id: kat.id, kriteria_id: kri.id, skor: kri.skor_default }),
        headers: { cookie: juriCookie, "Content-Type": "application/json" },
      });
      expect(res.status).toBe(200);
    }
    // ubah satu nilai (upsert, bukan duplikat)
    const kat = kategori[0];
    const kri = kat.kriteria[0];
    const res = await app.request("/api/juri/nilai", {
      ...json({ kelompok_id: kelompokId, kategori_id: kat.id, kriteria_id: kri.id, skor: 95 }),
      headers: { cookie: juriCookie, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const det = await app.request(`/api/juri/kelompok/${kelompokId}`, { headers: { cookie: juriCookie } });
    const b = await det.json();
    expect(b.kelompok.nilai_saya.length).toBe(4);
    expect(b.kelompok.nilai_saya.find((n: any) => n.kategori_id === kat.id).skor).toBe(95);
  });

  test("upload foto: bukan gambar ditolak", async () => {
    const fd = new FormData();
    fd.set("kelompok_id", String(kelompokId));
    fd.set("foto", new File(["bukan gambar"], "x.txt", { type: "text/plain" }));
    const res = await app.request("/api/juri/foto", { method: "POST", headers: { cookie: juriCookie }, body: fd });
    expect(res.status).toBe(400);
  });

  test("upload foto valid tersimpan & bisa dihapus", async () => {
    // PNG 1x1 minimal
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    const fd = new FormData();
    fd.set("kelompok_id", String(kelompokId));
    fd.set("caption", "Foto produk");
    fd.set("foto", new File([png], "produk.png", { type: "image/png" }));
    let res = await app.request("/api/juri/foto", { method: "POST", headers: { cookie: juriCookie }, body: fd });
    expect(res.status).toBe(200);
    const fotoId = (await res.json()).id;
    // file tersaji (dengan cookie juri)
    const det = await app.request(`/api/juri/kelompok/${kelompokId}`, { headers: { cookie: juriCookie } });
    const fname = (await det.json()).kelompok.foto_saya[0].filename;
    res = await app.request(`/api/uploads/${fname}`, { headers: { cookie: juriCookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
    // tanpa cookie -> 401
    res = await app.request(`/api/uploads/${fname}`);
    expect(res.status).toBe(401);
    // hapus
    res = await app.request(`/api/juri/foto/${fotoId}`, { method: "DELETE", headers: { cookie: juriCookie } });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe("hasil, peringkat & berita acara", () => {
  let cookie: string;
  let juri2Cookie: string;
  let kelasId: number;

  beforeAll(async () => {
    cookie = await loginAdmin();
    // kelas + 2 kelompok
    let res = await app.request("/api/kelas", { ...json({ nama: "7C", tingkat: "7" }), headers: { cookie, "Content-Type": "application/json" } });
    kelasId = (await res.json()).id;
    const cabRes = await app.request("/api/cabang", { headers: { cookie } });
    const cabangId = (await cabRes.json()).cabang[0].id;
    const mkKel = async (nama: string) => {
      const r = await app.request("/api/kelompok", {
        ...json({ kelas_id: kelasId, nama_kelompok: nama, cabang_id: cabangId, nama_produk: "Keripik" }),
        headers: { cookie, "Content-Type": "application/json" },
      });
      return (await r.json()).id;
    };
    const kA = await mkKel("A");
    const kB = await mkKel("B");
    // juri kedua
    await app.request("/api/juri", {
      ...json({ kode: "J03", nama: "Juri Dua", pin: "9999" }),
      headers: { cookie, "Content-Type": "application/json" },
    });
    const lj = async (kode: string, pin: string) => {
      const r = await app.request("/api/juri/login", json({ kode, pin }));
      return adminCookie(r.headers.get("set-cookie"));
    };
    const jc1 = await lj("J01", "1234");
    juri2Cookie = await lj("J03", "9999");
    // kategori
    const rk = await app.request("/api/juri/kategori", { headers: { cookie: jc1 } });
    const kats = (await rk.json()).kategori;
    // Juri1: A dapat 80 semua, B dapat 90 semua. Juri2: A 90 semua, B 80 semua.
    // -> rata-rata keduanya 85 -> seri -> peringkat sama (1), urut nama.
    const nilai = async (jc: string, kelId: number, skor: number) => {
      for (const kat of kats) {
        const kri = kat.kriteria.find((k: any) => skor >= k.skor_min && skor <= k.skor_max);
        const r = await app.request("/api/juri/nilai", {
          ...json({ kelompok_id: kelId, kategori_id: kat.id, kriteria_id: kri.id, skor }),
          headers: { cookie: jc, "Content-Type": "application/json" },
        });
        if (r.status !== 200) throw new Error("nilai gagal: " + (await r.text()));
      }
    };
    await nilai(jc1, kA, 80);
    await nilai(jc1, kB, 90);
    await nilai(juri2Cookie, kA, 90);
    await nilai(juri2Cookie, kB, 80);
  });

  test("peringkat seri & total benar", async () => {
    const res = await app.request(`/api/hasil?kelas_id=${kelasId}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.hasil.length).toBe(2);
    for (const h of b.hasil) {
      expect(h.total).toBe(340); // 4 x 85
      expect(h.peringkat).toBe(1); // seri
      expect(h.jml_juri).toBe(2);
    }
    expect(b.hasil[0].nama_kelompok).toBe("A");
  });

  test("ekspor CSV", async () => {
    const res = await app.request(`/api/hasil/export.csv?kelas_id=${kelasId}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const txt = await res.text();
    expect(txt).toContain("Peringkat");
    expect(txt).toContain("340");
  });

  test("berita acara simpan & baca", async () => {
    let res = await app.request("/api/berita-acara", {
      ...json({ kelas_id: kelasId, nomor: "01/BA/2026", tempat: "Punggur", tanggal: "2026-10-10", mengetahui_nama: "Bu Helmi", dibuat_nama: "Pak Gun" }),
      method: "PUT",
      headers: { cookie, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    res = await app.request(`/api/berita-acara?kelas_id=${kelasId}`, { headers: { cookie } });
    const b = await res.json();
    expect(b.berita_acara.nomor).toBe("01/BA/2026");
    expect(b.berita_acara.mengetahui_nama).toBe("Bu Helmi");
  });

  test("juri tidak bisa akses hasil admin", async () => {
    const res = await app.request(`/api/hasil?kelas_id=${kelasId}`, { headers: { cookie: juri2Cookie } });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe("regresi: dashboard & kelas", () => {
  test("tidak 500 (dulu: COUNT(DIST ...) bukan DISTINCT)", async () => {
    const cookie = await loginAdmin();
    let res = await app.request("/api/dashboard", { headers: { cookie } });
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.total_kelas).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(d.per_kelas)).toBe(true);
    res = await app.request("/api/kelas", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(Array.isArray((await res.json()).kelas)).toBe(true);
  });
});
