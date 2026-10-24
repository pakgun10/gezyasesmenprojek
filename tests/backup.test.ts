import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootApp } from "../src/app";

// Test Backup & Restore seluruh data (2026-10-24): unduh satu berkas JSON
// (semua tabel + foto base64), restore mengganti seluruh data, sesi lama
// mati, dan berkas yang sama bisa dipulihkan ke instalasi kosong.

process.env.ADMIN_PASSWORD = "test-admin-12345";

let app: Awaited<ReturnType<typeof bootApp>>;
let cookie = "";
let backupObj: any = null;
let fotoFilename = "";
const FOTO_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);

const json = (o: any) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) });
function auth() {
  return { cookie, "Content-Type": "application/json" };
}
async function loginAdmin(target: Awaited<ReturnType<typeof bootApp>>): Promise<string> {
  const res = await target.request("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "test-admin-12345" }),
  });
  if (res.status !== 200) throw new Error("login admin gagal: " + (await res.text()));
  return (res.headers.get("set-cookie") || "").split(";")[0];
}

beforeAll(async () => {
  app = await bootApp(mkdtempSync(join(tmpdir(), "np-backup-test-")));
  cookie = await loginAdmin(app);

  // --- bangun data contoh: kelas, murid, kelompok projek + siswa, penilai, foto, kelompok senam
  const k = await app.request("/api/kelas", { ...json({ nama: "8A", tingkat: "8" }), headers: auth() });
  const kelasId = (await k.json()).id;
  const muridIds: number[] = [];
  for (const nama of ["Andi", "Budi", "Citra", "Dodi"]) {
    const r = await app.request("/api/murid", { ...json({ kelas_id: kelasId, nama }), headers: auth() });
    muridIds.push((await r.json()).id);
  }
  const cab = await app.request("/api/cabang", { headers: { cookie } });
  const cabangId = (await cab.json()).cabang[0].id;
  const kel = await app.request("/api/kelompok", {
    ...json({ kelas_id: kelasId, nama_kelompok: "Kelompok 1", cabang_id: cabangId, nama_produk: "Dodol Nanas" }),
    headers: auth(),
  });
  const kelId = (await kel.json()).id;
  const put = await app.request(`/api/kelompok/${kelId}/siswa`, { ...json({ murid_ids: muridIds }), method: "PUT", headers: auth() });
  expect(put.status).toBe(200);

  const j = await app.request("/api/juri", { ...json({ kode: "J01", nama: "Pak Penilai", pin: "1234" }), headers: auth() });
  expect(j.status).toBe(200);
  const jl = await app.request("/api/juri/login", json({ kode: "J01", pin: "1234" }));
  const juriCookie = (jl.headers.get("set-cookie") || "").split(";")[0];
  const fd = new FormData();
  fd.set("kelompok_id", String(kelId));
  fd.set("foto", new File([FOTO_BYTES], "uji.jpg", { type: "image/jpeg" }));
  const up = await app.request("/api/juri/foto", { method: "POST", headers: { cookie: juriCookie }, body: fd });
  expect(up.status).toBe(200);
  fotoFilename = (await up.json()).filename;

  const sg = await app.request("/api/senam/kelompok", {
    ...json({ kelas_id: kelasId, nama_kelompok: "Kelompok Senam 1", judul_penampilan: "Senam Uji" }),
    headers: auth(),
  });
  expect(sg.status).toBe(200);
});

describe("backup: unduh", () => {
  test("tanpa login -> 401", async () => {
    const res = await app.request("/api/backup");
    expect(res.status).toBe(401);
  });

  test("berisi semua tabel + foto base64", async () => {
    const res = await app.request("/api/backup", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition") || "").toContain("backup-gezyaspro-");
    backupObj = await res.json();
    expect(backupObj.app).toBe("gezyaspro-backup");
    expect(backupObj.format).toBe(1);
    expect(backupObj.tabel.kelompok.length).toBe(1);
    expect(backupObj.tabel.murid.length).toBe(4);
    expect(backupObj.tabel.siswa.length).toBe(4);
    expect(backupObj.tabel.senam_kelompok.length).toBe(1);
    expect(backupObj.tabel.foto.length).toBe(1);
    expect(backupObj.berkas[fotoFilename]).toBe(FOTO_BYTES.toString("base64"));
    // sesi tidak ikut dibackup
    expect(backupObj.tabel.sessions).toBeUndefined();
  });
});

describe("backup: restore mengganti seluruh data", () => {
  test("format salah ditolak", async () => {
    let res = await app.request("/api/backup/restore", { ...json({ app: "aplikasi-lain", format: 1, tabel: {} }), headers: auth() });
    expect(res.status).toBe(400);
    res = await app.request("/api/backup/restore", { ...json({ app: "gezyaspro-backup", format: 99, tabel: {} }), headers: auth() });
    expect(res.status).toBe(400);
    res = await app.request("/api/backup/restore", { ...json({ app: "gezyaspro-backup", format: 1, tabel: { murid: "bukan-array" } }), headers: auth() });
    expect(res.status).toBe(400);
  });

  test("data sampah hilang, data backup kembali, sesi lama mati, foto utuh", async () => {
    // cemari data: kelas + kelompok sampah, hapus kelompok asli
    const sampah = await app.request("/api/kelas", { ...json({ nama: "9Z", tingkat: "9" }), headers: auth() });
    expect(sampah.status).toBe(200);
    const daftar = await (await app.request("/api/kelompok", { headers: { cookie } })).json();
    const del = await app.request(`/api/kelompok/${daftar.kelompok[0].id}`, { method: "DELETE", headers: { cookie } });
    expect(del.status).toBe(200);

    const res = await app.request("/api/backup/restore", { ...json(backupObj), headers: auth() });
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.ok).toBe(true);
    expect(b.jumlah_berkas).toBe(1);

    // sesi admin lama dibersihkan oleh restore
    const me = await app.request("/api/me", { headers: { cookie } });
    expect(me.status).toBe(401);

    cookie = await loginAdmin(app);
    const kelas = await (await app.request("/api/kelas", { headers: { cookie } })).json();
    expect(kelas.kelas.map((k: any) => k.nama)).toEqual(["8A"]); // 9Z sampah hilang
    const kel2 = await (await app.request("/api/kelompok", { headers: { cookie } })).json();
    expect(kel2.kelompok.length).toBe(1);
    expect(kel2.kelompok[0].nama_kelompok).toBe("Kelompok 1");
    const murid = await (await app.request("/api/murid", { headers: { cookie } })).json();
    expect(murid.murid.length).toBe(4);
    // berkas foto benar-benar tertulis kembali dan bisa disajikan
    const f = await app.request(`/api/uploads/${fotoFilename}`, { headers: { cookie } });
    expect(f.status).toBe(200);
    const buf = Buffer.from(await f.arrayBuffer());
    expect(buf.equals(FOTO_BYTES)).toBe(true);
  });
});

describe("backup: restore ke instalasi kosong", () => {
  test("aplikasi baru tanpa data menerima backup dan datanya utuh", async () => {
    const app2 = await bootApp(mkdtempSync(join(tmpdir(), "np-backup-fresh-")));
    const cookie2 = await loginAdmin(app2);
    const kosong = await (await app2.request("/api/kelompok", { headers: { cookie: cookie2 } })).json();
    expect(kosong.kelompok.length).toBe(0);

    const res = await app2.request("/api/backup/restore", {
      method: "POST",
      headers: { cookie: cookie2, "Content-Type": "application/json" },
      body: JSON.stringify(backupObj),
    });
    expect(res.status).toBe(200);

    const cookie3 = await loginAdmin(app2);
    const kel = await (await app2.request("/api/kelompok", { headers: { cookie: cookie3 } })).json();
    expect(kel.kelompok.length).toBe(1);
    const det = await (await app2.request(`/api/kelompok/${kel.kelompok[0].id}`, { headers: { cookie: cookie3 } })).json();
    expect(det.siswa.length).toBe(4);
    const senam = await (await app2.request("/api/senam/kelompok", { headers: { cookie: cookie3 } })).json();
    expect(senam.kelompok.length).toBe(1);
    const f = await app2.request(`/api/uploads/${fotoFilename}`, { headers: { cookie: cookie3 } });
    expect(f.status).toBe(200);
    expect(Buffer.from(await f.arrayBuffer()).equals(FOTO_BYTES)).toBe(true);
  });
});
