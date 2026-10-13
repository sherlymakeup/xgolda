import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Profil lingkungan PC tempat agen berjalan.
 * Disuntik ke system prompt tiap run (cached 10 menit) + tersedia via tool system_info.
 */

export interface RuntimeInfo {
  name: string;
  version: string;
}

export interface EnvProfile {
  os: string;
  arch: string;
  cpu: string;
  cores: number;
  ramGB: number;
  diskFreeGB: number | null;
  shell: string;
  runtimes: RuntimeInfo[];
}

const PROBE_TIMEOUT_MS = 5000;

function probe(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout: PROBE_TIMEOUT_MS, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return resolve(null);
      const out = (stdout || stderr || "").trim().split("\n")[0].trim();
      resolve(out ? out.slice(0, 80) : null);
    });
    child.on("error", () => resolve(null));
  });
}

const IS_WIN = os.platform() === "win32";

async function probeRuntimes(): Promise<RuntimeInfo[]> {
  const candidates: { name: string; cmd: string; args: string[] }[] = [
    { name: "node", cmd: "node", args: ["--version"] },
    { name: "npm", cmd: "npm", args: ["--version"] },
    { name: "python", cmd: IS_WIN ? "python" : "python3", args: ["--version"] },
    { name: "pip", cmd: IS_WIN ? "pip" : "pip3", args: ["--version"] },
    { name: "git", cmd: "git", args: ["--version"] },
    { name: "docker", cmd: "docker", args: ["--version"] },
    { name: "java", cmd: "java", args: ["-version"] },
    { name: "dotnet", cmd: "dotnet", args: ["--version"] },
    { name: "go", cmd: "go", args: ["version"] },
    { name: "rustc", cmd: "rustc", args: ["--version"] },
  ];
  const results = await Promise.all(
    candidates.map(async (c) => {
      const v = await probe(c.cmd, c.args);
      return v ? { name: c.name, version: v } : null;
    })
  );
  return results.filter((r): r is RuntimeInfo => r !== null);
}

function diskFreeGB(dir: string): number | null {
  try {
    // Node >= 19 (dan 18.15+): statfsSync
    const st = (fs as unknown as { statfsSync: (p: string) => { bavail: number; bsize: number } }).statfsSync(dir);
    if (st && typeof st.bavail === "number") {
      return Math.round((st.bavail * st.bsize) / 1024 ** 3);
    }
  } catch {
    /* tidak didukung — abaikan */
  }
  return null;
}

function osLabel(): string {
  const p = os.platform();
  if (p === "win32") return `Windows ${os.release()}`;
  if (p === "darwin") return `macOS ${os.release()}`;
  if (p === "linux") {
    // Coba baca distro dari /etc/os-release
    try {
      const rel = fs.readFileSync("/etc/os-release", "utf8");
      const m = rel.match(/^PRETTY_NAME="(.+)"$/m);
      if (m) return m[1];
    } catch {
      /* abaikan */
    }
    return `Linux ${os.release()}`;
  }
  return `${p} ${os.release()}`;
}

/** Kumpulkan profil lengkap (tanpa cache). */
export async function collectEnvProfile(): Promise<EnvProfile> {
  const cpus = os.cpus();
  const runtimes = await probeRuntimes();
  return {
    os: osLabel(),
    arch: os.arch(),
    cpu: cpus[0]?.model?.trim() || "unknown",
    cores: cpus.length,
    ramGB: Math.round(os.totalmem() / 1024 ** 3),
    diskFreeGB: diskFreeGB(path.resolve(process.cwd())),
    shell: IS_WIN ? "PowerShell" : "bash",
    runtimes,
  };
}

// Cache 10 menit — probing tiap run terlalu mahal
let cache: { at: number; profile: EnvProfile } | null = null;
const TTL_MS = 10 * 60 * 1000;

export async function getEnvProfile(): Promise<EnvProfile> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.profile;
  const profile = await collectEnvProfile();
  cache = { at: now, profile };
  return profile;
}

/** Render ringkas untuk system prompt. */
export function formatEnvBlock(p: EnvProfile): string {
  const rt =
    p.runtimes.length > 0
      ? p.runtimes.map((r) => `${r.name} ${r.version}`).join(", ")
      : "(tidak ada runtime umum terdeteksi)";
  const disk = p.diskFreeGB !== null ? ` | Disk bebas: ±${p.diskFreeGB} GB` : "";
  return (
    `- OS: ${p.os} ${p.arch} | CPU: ${p.cpu} (${p.cores} core) | RAM: ${p.ramGB} GB${disk}\n` +
    `- Shell: ${p.shell}\n` +
    `- Runtime/SDK terdeteksi: ${rt}\n` +
    `- Bila butuh versi fresh (mis. setelah install sesuatu), panggil tool system_info.`
  );
}
