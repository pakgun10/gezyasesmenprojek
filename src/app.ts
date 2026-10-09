import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { initDb, ensureAdmin, seedKategori } from "./db";
import { loginHandler, logoutHandler, requireAuth } from "./auth";
import adminRoutes from "./admin";
import scoringRoutes from "./scoring";

// bootApp: siapkan DB + admin + seed, kembalikan aplikasi Hono (tanpa listen,
// supaya bisa dipakai langsung oleh bun test via app.request()).
export async function bootApp(dataDir: string) {
  initDb(dataDir);
  seedKategori();
  const admin = await ensureAdmin();
  if (admin.generatedPassword) {
    console.log("==============================================");
    console.log(" Akun admin dibuat otomatis:");
    console.log(`   username : ${admin.username}`);
    console.log(`   password : ${admin.generatedPassword}`);
    console.log(" (hanya tampil sekali — simpan baik-baik,");
    console.log("  atau set ADMIN_PASSWORD di environment)");
    console.log("==============================================");
  }

  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "SAMEORIGIN");
    c.header("Referrer-Policy", "no-referrer-when-downgrade");
    // CSP: semua script dari origin sendiri (tanpa inline script);
    // style 'unsafe-inline' untuk lebar dinamis; img dari self + blob/data.
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; " +
        "object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
    );
  });

  app.get("/api/health", (c) =>
    c.json({ ok: true, app: "gezymuse-nilai-projek", version: "1.0.0" })
  );
  app.post("/api/login", loginHandler);
  app.post("/api/logout", logoutHandler);
  app.get("/api/me", requireAuth, (c) => c.json({ user: c.get("user") }));

  app.route("/api", adminRoutes);
  app.route("/api", scoringRoutes);

  // File statis frontend
  app.use("/*", serveStatic({ root: "./public" }));

  return app;
}
