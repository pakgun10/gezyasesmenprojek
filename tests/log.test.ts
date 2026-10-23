import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootApp } from "../src/app";
import { getDb } from "../src/db";

// Test Log Aktivitas: pencatatan login & aksi, akses admin saja,
// filter, dan pembersihan log lama (min 30 hari).

process.env.ADMIN_PASSWORD = "test-admin-12345";

let app: Awaited<ReturnType<typeof bootApp>>;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "np-log-test-"));
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

async function ambilLog(cookie: string, qs = ""): Promise<any> {
  const res = await app.request("/api/log" + qs, { headers: { cookie } });
  expect(res.status).toBe(200);
  return res.json();
}

describe("log aktivitas", () => {
  test("GET /api/log tanpa login admin -> 401", async () => {
    const res = await app.request("/api/log");
    expect(res.status).toBe(401);
  });

  test("login admin sukses & gagal sama-sama tercatat", async () => {
    const gagal = await app.request("/api/login", json({ username: "admin", password: "pasti-salah" }));
    expect(gagal.status).toBe(401);
    const cookie = await loginAdmin();
    const b = await ambilLog(cookie);
    expect(b.total).toBeGreaterThanOrEqual(2);
    const aksi = b.log.map((r: any) => r.aksi);
    expect(aksi).toContain("Login admin");
    expect(aksi).toContain("Login admin gagal");
    const sukses = b.log.find((r: any) => r.aksi === "Login admin");
    expect(sukses.aktor).toBe("admin");
    expect(sukses.peran).toBe("admin");
  });

  test("aksi admin tercatat: tambah kelas, tambah penilai", async () => {
    const cookie = await loginAdmin();
    let res = await app.request("/api/kelas", { ...json({ nama: "9.9", tingkat: "9" }), headers: auth(cookie) });
    expect(res.status).toBe(200);
    res = await app.request("/api/juri", { ...json({ kode: "LOG1", nama: "Penilai Log", pin: "1234", keterangan: "" }), headers: auth(cookie) });
    expect(res.status).toBe(200);
    const b = await ambilLog(cookie);
    const tambahKelas = b.log.find((r: any) => r.aksi === "Tambah kelas");
    expect(tambahKelas.detail).toContain("9.9");
    const tambahPenilai = b.log.find((r: any) => r.aksi === "Tambah penilai");
    expect(tambahPenilai.detail).toContain("LOG1");
  });

  test("login penilai & simpan nilai projek tercatat sebagai peran penilai", async () => {
    const cookie = await loginAdmin();
    // siapkan kelas + cabang + kelompok + kategori
    const kelasRes = await app.request("/api/kelas", { headers: { cookie } });
    const kelas = (await kelasRes.json()).kelas.find((k: any) => k.nama === "9.9");
    const cabangRes = await app.request("/api/cabang", { headers: { cookie } });
    const cabang = (await cabangRes.json()).cabang[0];
    let res = await app.request("/api/kelompok", { ...json({ kelas_id: kelas.id, nama_kelompok: "Kelompok Log", cabang_id: cabang.id, nama_produk: "Produk Log" }), headers: auth(cookie) });
    expect(res.status).toBe(200);
    const kelompokId = (await res.json()).id;
    const katRes = await app.request("/api/kategori", { headers: { cookie } });
    const kategori = (await katRes.json()).kategori[0];

    const loginRes = await app.request("/api/juri/login", json({ kode: "LOG1", pin: "1234" }));
    expect(loginRes.status).toBe(200);
    const juriCookie = cookieOf(loginRes.headers.get("set-cookie"));
    res = await app.request("/api/juri/nilai", {
      ...json({ kelompok_id: kelompokId, kategori_id: kategori.id, kriteria_id: kategori.kriteria[0].id, skor: kategori.kriteria[0].skor_default }),
      headers: auth(juriCookie),
    });
    expect(res.status).toBe(200);

    const b = await ambilLog(cookie, "?peran=penilai");
    expect(b.log.length).toBeGreaterThanOrEqual(2);
    expect(b.log.every((r: any) => r.peran === "penilai")).toBe(true);
    const aksi = b.log.map((r: any) => r.aksi);
    expect(aksi).toContain("Login penilai");
    expect(aksi).toContain("Simpan nilai projek");
    const simpan = b.log.find((r: any) => r.aksi === "Simpan nilai projek");
    expect(simpan.aktor).toContain("LOG1");
    expect(simpan.detail).toContain("Kelompok Log");
  });

  test("filter q mencari aktor/aksi/detail", async () => {
    const cookie = await loginAdmin();
    const b = await ambilLog(cookie, "?q=" + encodeURIComponent("Kelompok Log"));
    expect(b.log.length).toBeGreaterThanOrEqual(1);
    expect(b.log.every((r: any) => (r.aktor + r.aksi + r.detail).includes("Kelompok Log"))).toBe(true);
  });

  test("penilai tidak bisa mengakses /api/log (bukan sesi admin)", async () => {
    const loginRes = await app.request("/api/juri/login", json({ kode: "LOG1", pin: "1234" }));
    const juriCookie = cookieOf(loginRes.headers.get("set-cookie"));
    const res = await app.request("/api/log", { headers: { cookie: juriCookie } });
    expect(res.status).toBe(401);
  });

  test("hapus log lama: <30 hari ditolak, >=30 hari hanya menghapus yang tua", async () => {
    const cookie = await loginAdmin();
    // sisipkan satu log berumur 40 hari langsung ke DB
    getDb()
      .query("INSERT INTO aktivitas_log (aktor, peran, aksi, detail, created_at) VALUES ('uji', 'admin', 'Log tua uji', '', datetime('now', '-40 days'))")
      .run();
    let res = await app.request("/api/log/lama?hari=7", { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(400);
    res = await app.request("/api/log/lama?hari=30", { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.terhapus).toBeGreaterThanOrEqual(1);
    const sisa = await ambilLog(cookie, "?q=" + encodeURIComponent("Log tua uji"));
    expect(sisa.log.length).toBe(0);
    // log pembersihan itu sendiri tercatat
    const semua = await ambilLog(cookie);
    expect(semua.log.map((r: any) => r.aksi)).toContain("Bersihkan log lama");
  });
});
