/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 & esbuild adalah modul native / punya require dinamis —
  // jangan di-bundle ke output server (Next 14: via experimental key)
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3", "esbuild"],
  },
  // Localhost only: tidak ada optimasi image remote yang dibutuhkan
  images: { unoptimized: true },
};

export default nextConfig;
