import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootApp } from "../src/app";
import { getDb, isiMuridDariDataLama } from "../src/db";

// Test master data Murid (2026-10-24): CRUD + aturan duplikat/NIS, ceklis
// kelompok, validasi anggota projek & senam, impor murid, impor kelompok
// ketat, dan pengisian/tautan otomatis dari data lama.

process.env.ADMIN_PASSWORD = "test-admin-12345";

let app: Awaited<ReturnType<typeof bootApp>>;
let cookie: string;
let k8a: number;
let k9a: number;
let k7a: number;
let cabangId: number;
const M: Record<string, number> = {}; // nama -> murid id

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "np-murid-test-"));
  app = await bootApp(dir);
  const res = await app.request("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "test-admin-12345" }),
  });
  if (res.status !== 200) throw new Error("login admin gagal");
  cookie = (res.headers.get("set-cookie") || "").split(";")[0];

  const mk = async (nama: string, tingkat: string) => {
    const r = await app.request("/api/kelas", { ...json({ nama, tingkat }), headers: auth() });
    expect(r.status).toBe(200);
    return (await r.json()).id as number;
  };
  k8a = await mk("8A", "8");
  k9a = await mk("9A", "9");
  k7a = await mk("7A", "7");
  const cab = await app.request("/api/cabang", { headers: { cookie } });
  cabangId = (await cab.json()).cabang[0].id;
});

function auth() {
  return { cookie, "Content-Type": "application/json" };
}
const json = (o: any) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) });

async function tambahMurid(kelas_id: number, nama: string, nis = ""): Promise<Response> {
  return app.request("/api/murid", { ...json({ kelas_id, nama, nis }), headers: auth() });
}
async function simpanMurid(kelas_id: number, nama: string, nis = ""): Promise<number> {
  const r = await tambahMurid(kelas_id, nama, nis);
  expect(r.status).toBe(200);
  const id = (await r.json()).id as number;
  M[nama + "|" + nis] = id;
  return id;
}
async function buatKelompokProjek(kelas_id: number, nama_kelompok: string): Promise<number> {
  const r = await app.request("/api/kelompok", {
    ...json({ kelas_id, nama_kelompok, cabang_id: cabangId, nama_produk: "Produk Uji" }),
    headers: auth(),
  });
  expect(r.status).toBe(200);
  return (await r.json()).id as number;
}
async function putSiswa(kelompokId: number, body: any): Promise<Response> {
  return app.request(`/api/kelompok/${kelompokId}/siswa`, { ...json(body), method: "PUT", headers: auth() });
}

// ---------------------------------------------------------------------------
describe("murid: CRUD & aturan duplikat", () => {
  test("tambah murid + duplikat ternormalisasi ditolak", async () => {
    await simpanMurid(k8a, "Andi");
    // beda huruf besar/kecil & spasi tetap dianggap orang yang sama
    const dup = await tambahMurid(k8a, "  ANDI ");
    expect(dup.status).toBe(400);
    // nama sama di rombel LAIN boleh
    const lain = await tambahMurid(k9a, "Andi");
    expect(lain.status).toBe(200);
  });

  test("nama kembar dibedakan NIS; NIS sama tetap duplikat", async () => {
    await simpanMurid(k8a, "Sari", "201");
    await simpanMurid(k8a, "Sari", "202"); // kembar, NIS beda -> boleh
    const dup = await tambahMurid(k8a, "Sari", "201");
    expect(dup.status).toBe(400);
    // satu sisi tanpa NIS tetap dianggap duplikat dari yang ber-NIS
    const tanpaNis = await tambahMurid(k8a, "Sari");
    expect(tanpaNis.status).toBe(400);
  });

  test("impor murid: kelas tak terdaftar & duplikat dilewati, sisanya masuk", async () => {
    const csv = `kelas,nama,nis
8A,Budi,
8A,Citra,203
9A,Dedi,
10A,Hantu,
8A,Andi,`;
    const res = await app.request("/api/murid/import", { ...json({ csv }), headers: auth() });
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.diimpor).toBe(3);
    expect(b.peringatan.length).toBe(2);
    const list = await app.request("/api/murid?kelas_id=" + k8a, { headers: { cookie } });
    const rows = (await list.json()).murid;
    expect(rows.map((r: any) => r.nama)).toContain("Budi");
    M["Budi|"] = rows.find((r: any) => r.nama === "Budi").id;
    M["Citra|203"] = rows.find((r: any) => r.nama === "Citra").id;
  });
});

// ---------------------------------------------------------------------------
describe("murid: ceklis & validasi anggota", () => {
  let kel1: number;
  let kel2: number;

  test("pilihan ceklis: status bebas -> kelompok_ini -> kelompok_lain", async () => {
    kel1 = await buatKelompokProjek(k8a, "Kelompok 1");
    kel2 = await buatKelompokProjek(k8a, "Kelompok 2");
    let res = await app.request(`/api/murid/pilihan?modul=projek&kelompok_id=${kel1}`, { headers: { cookie } });
    let pilihan = (await res.json()).pilihan;
    expect(pilihan.every((p: any) => p.status === "bebas")).toBe(true);

    res = await putSiswa(kel1, { murid_ids: [M["Andi|"], M["Budi|"]] });
    expect(res.status).toBe(200);
    expect((await res.json()).jumlah).toBe(2);

    res = await app.request(`/api/murid/pilihan?modul=projek&kelompok_id=${kel2}`, { headers: { cookie } });
    pilihan = (await res.json()).pilihan;
    const andi = pilihan.find((p: any) => p.id === M["Andi|"]);
    expect(andi.status).toBe("kelompok_lain");
    expect(andi.kelompok_nama).toBe("Kelompok 1");
  });

  test("validasi server: murid rombel lain, murid terpakai, dan names bebas ditolak", async () => {
    const dedi = (await (await app.request("/api/murid?kelas_id=" + k9a, { headers: { cookie } })).json()).murid[0];
    let res = await putSiswa(kel2, { murid_ids: [dedi.id] }); // murid kelas 9A ke kelompok 8A
    expect(res.status).toBe(400);
    res = await putSiswa(kel2, { murid_ids: [M["Andi|"]] }); // sudah di Kelompok 1
    expect(res.status).toBe(400);
    res = await putSiswa(kel2, { names: ["Nama Bebas"] }); // cara lama tidak diterima lagi
    expect(res.status).toBe(400);
    res = await putSiswa(kel2, { murid_ids: [M["Citra|203"]] });
    expect(res.status).toBe(200);
  });

  test("murid yang sama boleh masuk kelompok projek DAN senam (modul berbeda)", async () => {
    const eka = await simpanMurid(k7a, "Eka");
    const fajar = await simpanMurid(k7a, "Fajar");
    const gita = await simpanMurid(k7a, "Gita");
    const hani = await simpanMurid(k7a, "Hani");
    const kelP = await buatKelompokProjek(k7a, "Kelompok Projek 7");
    let res = await putSiswa(kelP, { murid_ids: [eka, fajar, gita, hani] });
    expect(res.status).toBe(200);
    const kelS = await app.request("/api/senam/kelompok", {
      ...json({ kelas_id: k7a, nama_kelompok: "Kelompok Senam 7" }),
      headers: auth(),
    });
    const kelSId = (await kelS.json()).id;
    res = await app.request(`/api/senam/kelompok/${kelSId}/anggota`, {
      ...json({ murid_ids: [eka, fajar, gita, hani] }),
      method: "PUT",
      headers: auth(),
    });
    expect(res.status).toBe(200);
    // tetapi di modul senam sendiri tetap satu kelompok per murid
    const kelS2 = await app.request("/api/senam/kelompok", {
      ...json({ kelas_id: k7a, nama_kelompok: "Kelompok Senam 8" }),
      headers: auth(),
    });
    const kelS2Id = (await kelS2.json()).id;
    res = await app.request(`/api/senam/kelompok/${kelS2Id}/anggota`, {
      ...json({ murid_ids: [eka] }),
      method: "PUT",
      headers: auth(),
    });
    expect(res.status).toBe(400);
  });

  test("koreksi nama di menu Murid menjalar ke tampilan kelompok", async () => {
    const res = await app.request(`/api/murid/${M["Andi|"]}`, {
      ...json({ kelas_id: k8a, nama: "Andi Pratama", nis: "" }),
      method: "PUT",
      headers: auth(),
    });
    expect(res.status).toBe(200);
    const det = await (await app.request(`/api/kelompok/${kel1}`, { headers: { cookie } })).json();
    expect(det.siswa.map((s: any) => s.nama)).toContain("Andi Pratama");
  });

  test("hapus murid yang masih masuk kelompok ditolak; setelah dikeluarkan boleh", async () => {
    let res = await app.request(`/api/murid/${M["Andi|"]}`, { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(400);
    res = await putSiswa(kel1, { murid_ids: [M["Budi|"]] });
    expect(res.status).toBe(200);
    res = await app.request(`/api/murid/${M["Andi|"]}`, { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe("murid: impor kelompok ketat", () => {
  test("nama tak terdaftar -> baris dilewati seluruhnya, kelompok tidak dibuat", async () => {
    await simpanMurid(k8a, "Rara");
    const csv = `nama_kelompok,kelas,tingkat,cabang,nama_produk,murid
Kelompok Z,8A,8,Olahan Nanas,Produk Z,Rara;Zoro`;
    const res = await app.request("/api/kelompok/import", { ...json({ csv }), headers: auth() });
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.diimpor).toBe(0);
    expect(b.peringatan.join(" ")).toContain("Zoro");
    const list = await (await app.request("/api/kelompok?q=Produk Z", { headers: { cookie } })).json();
    expect(list.kelompok.length).toBe(0);
  });

  test("kelas belum terdaftar -> baris dilewati", async () => {
    const csv = `nama_kelompok,kelas,tingkat,cabang,nama_produk,murid
Kelompok Y,11A,8,Olahan Nanas,Produk Y,Budi`;
    const res = await app.request("/api/kelompok/import", { ...json({ csv }), headers: auth() });
    const b = await res.json();
    expect(b.diimpor).toBe(0);
    expect(b.peringatan.join(" ")).toContain("11A");
  });

  test("cocok tidak peka huruf: tersimpan dengan ejaan resmi menu Murid", async () => {
    await simpanMurid(k8a, "Caca");
    await simpanMurid(k8a, "Dodi");
    const csv = `nama_kelompok,kelas,tingkat,cabang,nama_produk,murid
Kelompok Impor,8A,8,Olahan Nanas,Produk Impor,caca;DODI`;
    const res = await app.request("/api/kelompok/import", { ...json({ csv }), headers: auth() });
    const b = await res.json();
    expect(b.diimpor).toBe(1);
    const list = await (await app.request("/api/kelompok?q=Produk Impor", { headers: { cookie } })).json();
    const det = await (await app.request(`/api/kelompok/${list.kelompok[0].id}`, { headers: { cookie } })).json();
    expect(det.siswa.map((s: any) => s.nama)).toEqual(["Caca", "Dodi"]);
    expect(det.siswa.every((s: any) => s.murid_id)).toBe(true);
  });

  test("murid yang sudah masuk kelompok lain -> baris dilewati", async () => {
    const csv = `nama_kelompok,kelas,tingkat,cabang,nama_produk,murid
Kelompok Gagal,8A,8,Olahan Nanas,Produk Gagal,Budi;Caca`;
    const res = await app.request("/api/kelompok/import", { ...json({ csv }), headers: auth() });
    const b = await res.json();
    expect(b.diimpor).toBe(0);
    expect(b.peringatan.join(" ")).toContain("sudah masuk");
  });
});

// ---------------------------------------------------------------------------
describe("murid: pengisian & tautan otomatis dari data lama", () => {
  test("baris lama tanpa murid_id menjadi murid terdaftar dan tertaut (idempoten)", async () => {
    const r = await app.request("/api/kelas", { ...json({ nama: "7L", tingkat: "7" }), headers: auth() });
    const k7l = (await r.json()).id as number;
    const kelP = await buatKelompokProjek(k7l, "Kelompok Lama");
    const kelSRes = await app.request("/api/senam/kelompok", {
      ...json({ kelas_id: k7l, nama_kelompok: "Kelompok Senam Lama" }),
      headers: auth(),
    });
    const kelS = (await kelSRes.json()).id as number;
    const db = getDb();
    // sisipkan baris "lama" persis seperti aplikasi versi sebelumnya
    db.query("INSERT INTO siswa (kelompok_id, nama, urutan) VALUES (?, ?, ?)").run(kelP, "Lala Lama", 1);
    db.query("INSERT INTO senam_anggota (kelompok_id, nama, urutan) VALUES (?, ?, ?)").run(kelS, "Lala Lama", 1);
    db.query("INSERT INTO senam_anggota (kelompok_id, nama, urutan) VALUES (?, ?, ?)").run(kelS, "Lili Lama", 2);

    isiMuridDariDataLama();
    const daftar = (db.query("SELECT id, nama FROM murid WHERE kelas_id = ? ORDER BY nama").all(k7l) as any[]);
    expect(daftar.map((m) => m.nama)).toEqual(["Lala Lama", "Lili Lama"]);
    const s = db.query("SELECT murid_id FROM siswa WHERE kelompok_id = ?").get(kelP) as any;
    const a = db.query("SELECT murid_id FROM senam_anggota WHERE kelompok_id = ? AND nama = 'Lala Lama'").get(kelS) as any;
    expect(s.murid_id).toBe(daftar[0].id);
    expect(a.murid_id).toBe(daftar[0].id); // orang yang sama di dua modul -> satu data induk

    isiMuridDariDataLama(); // panggilan kedua tidak menggandakan
    const lagi = db.query("SELECT COUNT(*) n FROM murid WHERE kelas_id = ?").get(k7l) as any;
    expect(lagi.n).toBe(2);
  });
});
