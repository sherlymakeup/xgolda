/**
 * Klasifikasi perintah berbahaya untuk approval gate.
 *
 * JUJUR: ini heuristik berbasis pola — speed bump anti-kecelakaan, BUKAN
 * security boundary (obfuskasi bisa lolos). Gate-nya: user klik Setujui/Tolak.
 */

export interface Classification {
  dangerous: boolean;
  reason: string | null;
}

const DANGEROUS_PATTERNS: { re: RegExp; reason: string }[] = [
  // --- Hapus massal / rekursif ---
  { re: /\brm\b[^;|&]*?\s-[a-zA-Z]*r[a-zA-Z]*/i, reason: "hapus rekursif (rm -r/-rf)" },
  { re: /\brm\b[^;|&]*?--recursive\b/i, reason: "hapus rekursif (rm --recursive)" },
  { re: /\b(remove-item|ri)\b[^;|&]*?-recurse/i, reason: "hapus rekursif (Remove-Item -Recurse)" },
  { re: /\bdel\b[^;|&]*?\s\/s/i, reason: "hapus subdirektori (del /s)" },
  { re: /\b(rd|rmdir)\b[^;|&]*?\s\/s/i, reason: "hapus direktori (rd /s)" },
  // --- Format / partisi / disk ---
  { re: /\bformat\b\s+[a-z]:/i, reason: "format volume (format)" },
  { re: /\bclear-disk\b/i, reason: "hapus disk (Clear-Disk)" },
  { re: /\bremove-partition\b/i, reason: "hapus partisi (Remove-Partition)" },
  { re: /\bdd\b[^;|&]*?\bof=\/dev\//i, reason: "tulis langsung ke device (dd of=/dev/)" },
  { re: /\bmkfs\b/i, reason: "format filesystem (mkfs)" },
  // --- Sistem: shutdown / akun / registry ---
  { re: /\bshutdown\b/i, reason: "shutdown/restart sistem" },
  { re: /\b(restart|stop)-computer\b/i, reason: "restart/stop komputer" },
  { re: /\breg\s+(add|delete|import)\b/i, reason: "ubah Windows Registry" },
  { re: /\bnet\s+(user|localgroup)\b/i, reason: "kelola akun user Windows" },
  { re: /\btakeown\b/i, reason: "ambil alih kepemilikan file (takeown)" },
  { re: /\bicacls\b[^;|&]*?\/(grant|deny|remove)/i, reason: "ubah ACL file (icacls)" },
  { re: /\bset-executionpolicy\b/i, reason: "ubah ExecutionPolicy PowerShell" },
  // --- Eksekusi kode remote via pipe ---
  {
    re: /\|\s*(powershell|pwsh|sh|bash|cmd)(?:\.exe)?\b/i,
    reason: "eksekusi kode remote via pipe (| sh / | powershell)",
  },
  { re: /\b(iex|invoke-expression)\s*\(/i, reason: "Invoke-Expression (eksekusi string dinamis)" },
  // --- Fork bomb ---
  { re: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}/, reason: "fork bomb" },
];

export function classifyCommand(command: string): Classification {
  for (const p of DANGEROUS_PATTERNS) {
    if (p.re.test(command)) {
      return { dangerous: true, reason: p.reason };
    }
  }
  return { dangerous: false, reason: null };
}
