import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import { randomBytes } from "node:crypto";
import { getDb } from "./db";
import { clientIp } from "./auth";

const JUDGE_COOKIE = "nilaiproyek_juri";
const SESSION_DAYS = 3;

// Rate-limit login juri: 20x gagal / IP / 10 menit -> 429.
const fails = new Map<string, { count: number; resetAt: number }>();
const MAX_FAILS = 20;
const WINDOW_MS = 10 * 60 * 1000;

function cookieOpts() {
  const secure = process.env.COOKIE_SECURE === "1";
  return {
    path: "/",
    httpOnly: true,
    sameSite: "Lax" as const,
    secure,
    maxAge: SESSION_DAYS * 86400,
  };
}

export async function judgeLoginHandler(c: Context) {
  const ip = clientIp(c);
  const now = Date.now();
  const rec = fails.get(ip);
  if (rec && now < rec.resetAt && rec.count >= MAX_FAILS) {
    return c.json({ error: "Terlalu banyak percobaan gagal. Coba lagi beberapa menit." }, 429);
  }
  let body: { kode?: string; pin?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Body request tidak valid" }, 400);
  }
  const db = getDb();
  const juri = db
    .query("SELECT id, kode, nama, pin_hash FROM juri WHERE kode = ?")
    .get((body.kode || "").trim().toUpperCase()) as {
    id: number;
    kode: string;
    nama: string;
    pin_hash: string;
  } | null;
  const ok = juri ? await Bun.password.verify(body.pin || "", juri.pin_hash) : false;
  if (!ok) {
    const r = fails.get(ip);
    if (!r || now >= r.resetAt) fails.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    else r.count++;
    return c.json({ error: "Kode juri atau PIN salah" }, 401);
  }
  fails.delete(ip);
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  db.query("INSERT INTO judge_sessions (id, juri_id, expires_at) VALUES (?, ?, ?)").run(
    token,
    juri!.id,
    expires
  );
  setCookie(c, JUDGE_COOKIE, token, cookieOpts());
  return c.json({ ok: true, juri: { id: juri!.id, kode: juri!.kode, nama: juri!.nama } });
}

export async function judgeLogoutHandler(c: Context) {
  const token = getCookie(c, JUDGE_COOKIE);
  if (token) getDb().query("DELETE FROM judge_sessions WHERE id = ?").run(token);
  deleteCookie(c, JUDGE_COOKIE, { path: "/" });
  return c.json({ ok: true });
}

export const requireJudge = createMiddleware(async (c, next) => {
  const token = getCookie(c, JUDGE_COOKIE);
  if (!token) return c.json({ error: "Juri belum login" }, 401);
  const row = getDb()
    .query(
      `SELECT js.id AS token, j.id, j.kode, j.nama, js.expires_at
       FROM judge_sessions js JOIN juri j ON j.id = js.juri_id WHERE js.id = ?`
    )
    .get(token) as {
    token: string;
    id: number;
    kode: string;
    nama: string;
    expires_at: string;
  } | null;
  if (!row) return c.json({ error: "Sesi juri tidak valid" }, 401);
  if (new Date(row.expires_at.replace(" ", "T") + "Z").getTime() < Date.now()) {
    getDb().query("DELETE FROM judge_sessions WHERE id = ?").run(token);
    return c.json({ error: "Sesi juri kedaluwarsa, silakan login lagi" }, 401);
  }
  c.set("juri", { id: row.id, kode: row.kode, nama: row.nama });
  await next();
});
