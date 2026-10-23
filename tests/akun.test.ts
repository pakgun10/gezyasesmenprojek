import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootApp } from "../src/app";

// Test Manajemen Akun Admin: buat akun, login akun baru, reset password
// (sesi lama mati), hapus akun + pengaman (diri sendiri & admin terakhir),
// dan pencatatan ke Log Aktivitas.

process.env.ADMIN_PASSWORD = "test-admin-12345";

let app: Awaited<ReturnType<typeof bootApp>>;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "np-akun-test-"));
  app = await bootApp(dir);
});

function cookieOf(setCookie: string | null): string {
  if (!setCookie) throw new Error("tidak ada set-cookie");
  return setCookie.split(";")[0];
}

async function loginSebagai(username: string, password: string): Promise<Response> {
  return app.request("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

async function loginAdminUtama(): Promise<string> {
  const res = await loginSebagai("admin", "test-admin-12345");
  if (res.status !== 200) throw new Error("login admin gagal: " + (await res.text()));
  return cookieOf(res.headers.get("set-cookie"));
}

const json = (o: any) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) });
const auth = (cookie: string) => ({ cookie, "Content-Type": "application/json" });

describe("akun admin", () => {
  test("GET /api/users tanpa login -> 401; daftar tidak membocorkan password_hash", async () => {
    const res = await app.request("/api/users");
    expect(res.status).toBe(401);
    const cookie = await loginAdminUtama();
    const ok = await app.request("/api/users", { headers: { cookie } });
    expect(ok.status).toBe(200);
    const b = await ok.json();
    expect(b.users.length).toBe(1);
    expect(b.users[0].username).toBe("admin");
    expect(JSON.stringify(b)).not.toContain("password_hash");
    expect(b.saya).toBe(b.users[0].id);
  });

  test("buat akun: validasi username & password, duplikat ditolak", async () => {
    const cookie = await loginAdminUtama();
    let res = await app.request("/api/users", { ...json({ username: "ab", password: "panjang123" }), headers: auth(cookie) });
    expect(res.status).toBe(400);
    res = await app.request("/api/users", { ...json({ username: "nama spasi", password: "panjang123" }), headers: auth(cookie) });
    expect(res.status).toBe(400);
    res = await app.request("/api/users", { ...json({ username: "helmi", password: "12345" }), headers: auth(cookie) });
    expect(res.status).toBe(400);
    res = await app.request("/api/users", { ...json({ username: "helmi", password: "rahasia1" }), headers: auth(cookie) });
    expect(res.status).toBe(200);
    res = await app.request("/api/users", { ...json({ username: "helmi", password: "rahasia1" }), headers: auth(cookie) });
    expect(res.status).toBe(400);
    // username admin utama juga tidak bisa diduplikat
    res = await app.request("/api/users", { ...json({ username: "admin", password: "rahasia1" }), headers: auth(cookie) });
    expect(res.status).toBe(400);
  });

  test("akun baru bisa login dan mengakses endpoint admin", async () => {
    const res = await loginSebagai("helmi", "rahasia1");
    expect(res.status).toBe(200);
    const cookie = cookieOf(res.headers.get("set-cookie"));
    const dash = await app.request("/api/dashboard", { headers: { cookie } });
    expect(dash.status).toBe(200);
  });

  test("reset password: sesi lama mati, password lama ditolak, password baru bisa", async () => {
    const cookie = await loginAdminUtama();
    const list = await (await app.request("/api/users", { headers: { cookie } })).json();
    const helmi = list.users.find((u: any) => u.username === "helmi");
    // helmi login -> sesi hidup
    const sesiLama = cookieOf((await loginSebagai("helmi", "rahasia1")).headers.get("set-cookie"));
    expect((await app.request("/api/me", { headers: { cookie: sesiLama } })).status).toBe(200);
    // reset oleh admin utama
    const res = await app.request(`/api/users/${helmi.id}/password`, {
      method: "PUT",
      headers: auth(cookie),
      body: JSON.stringify({ password: "baru12345" }),
    });
    expect(res.status).toBe(200);
    // sesi lama harus mati
    expect((await app.request("/api/me", { headers: { cookie: sesiLama } })).status).toBe(401);
    // password lama ditolak, baru diterima
    expect((await loginSebagai("helmi", "rahasia1")).status).toBe(401);
    expect((await loginSebagai("helmi", "baru12345")).status).toBe(200);
    // reset akun yang tidak ada -> 404; password pendek -> 400
    const nf = await app.request("/api/users/9999/password", {
      method: "PUT",
      headers: auth(cookie),
      body: JSON.stringify({ password: "panjang123" }),
    });
    expect(nf.status).toBe(404);
    const pendek = await app.request(`/api/users/${helmi.id}/password`, {
      method: "PUT",
      headers: auth(cookie),
      body: JSON.stringify({ password: "123" }),
    });
    expect(pendek.status).toBe(400);
  });

  test("hapus akun: tidak bisa hapus diri sendiri; akun terhapus tidak bisa login; sesinya mati", async () => {
    const cookie = await loginAdminUtama();
    const list = await (await app.request("/api/users", { headers: { cookie } })).json();
    const saya = list.saya;
    const helmi = list.users.find((u: any) => u.username === "helmi");
    // hapus diri sendiri ditolak (masih ada 2 admin, jadi bukan kasus admin terakhir)
    let res = await app.request(`/api/users/${saya}`, { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("sendiri");
    // sesi helmi yang hidup ikut mati setelah akunnya dihapus
    const sesiHelmi = cookieOf((await loginSebagai("helmi", "baru12345")).headers.get("set-cookie"));
    res = await app.request(`/api/users/${helmi.id}`, { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(200);
    expect((await app.request("/api/me", { headers: { cookie: sesiHelmi } })).status).toBe(401);
    expect((await loginSebagai("helmi", "baru12345")).status).toBe(401);
    // hapus ulang -> 404
    res = await app.request(`/api/users/${helmi.id}`, { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(404);
  });

  test("admin terakhir tidak bisa dihapus", async () => {
    const cookie = await loginAdminUtama();
    const list = await (await app.request("/api/users", { headers: { cookie } })).json();
    expect(list.users.length).toBe(1);
    const res = await app.request(`/api/users/${list.users[0].id}`, { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("terakhir");
  });

  test("penilai (bukan admin) tidak bisa mengakses manajemen akun", async () => {
    const cookie = await loginAdminUtama();
    await app.request("/api/juri", { ...json({ kode: "AKUN1", nama: "Penilai Akun", pin: "1234", keterangan: "" }), headers: auth(cookie) });
    const loginRes = await app.request("/api/juri/login", json({ kode: "AKUN1", pin: "1234" }));
    const juriCookie = cookieOf(loginRes.headers.get("set-cookie"));
    const res = await app.request("/api/users", { headers: { cookie: juriCookie } });
    expect(res.status).toBe(401);
  });

  test("aksi akun tercatat di Log Aktivitas", async () => {
    const cookie = await loginAdminUtama();
    const res = await app.request("/api/log?q=" + encodeURIComponent("akun admin"), { headers: { cookie } });
    expect(res.status).toBe(200);
    const b = await res.json();
    const aksi = b.log.map((r: any) => r.aksi);
    expect(aksi).toContain("Tambah akun admin");
    expect(aksi).toContain("Reset password akun admin");
    expect(aksi).toContain("Hapus akun admin");
    // password tidak boleh ikut tercatat di log mana pun
    const semua = await (await app.request("/api/log?limit=500", { headers: { cookie } })).json();
    expect(JSON.stringify(semua)).not.toContain("rahasia1");
    expect(JSON.stringify(semua)).not.toContain("baru12345");
  });
});
