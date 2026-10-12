import { NextRequest, NextResponse } from "next/server";

/**
 * S-08: proteksi CSRF sederhana untuk threat model localhost.
 * Request tulis (POST/PUT/PATCH/DELETE) dengan header Origin yang
 * menunjuk ke host lain ditolak — hanya UI lokal yang boleh mutasi.
 * Request tanpa Origin (curl, native) tetap diizinkan.
 */
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function allowedOrigins(): Set<string> {
  const port = process.env.PORT || "3000";
  return new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ]);
}

export function middleware(req: NextRequest) {
  if (!MUTATING.has(req.method)) return NextResponse.next();

  const origin = req.headers.get("origin");
  if (!origin) return NextResponse.next(); // curl / non-browser

  if (!allowedOrigins().has(origin)) {
    return NextResponse.json(
      { error: "Origin tidak diizinkan" },
      { status: 403 }
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
