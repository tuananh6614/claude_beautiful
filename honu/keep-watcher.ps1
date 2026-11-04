# Starts the automatic paste again when it has stopped: Windows closes it while it updates the Claude app.
# The plugin runs this at each session start. It does nothing unless the automatic paste was set up,
# that is, unless a shortcut in the Startup folder runs a script that sits beside honu\pixel-troi.user.js.
$ws = New-Object -ComObject WScript.Shell
foreach ($p in Get-ChildItem ([Environment]::GetFolderPath('Startup')) -Filter *.lnk) {
  $l = $ws.CreateShortcut($p.FullName)
  $file = [regex]::Match($l.Arguments, '-File "([^"]+)"').Groups[1].Value
  if (-not $file -or -not (Test-Path (Join-Path (Split-Path $file) 'honu\pixel-troi.user.js'))) { continue }
  $running = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($file) -and $_.CommandLine -notmatch ' -(MotLan|Once|Show|Install|Uninstall)\b' }
  if ($running) { return }
  Add-Type @"
using System; using System.Runtime.InteropServices;
public class KeepWatcher {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct SI { public int cb; public string r, d, t; public int x, y, w, h, cx, cy, fa, flags; public short sw, r2; public IntPtr r3, i, o, e; }
  [StructLayout(LayoutKind.Sequential)] struct PI { public IntPtr hp, ht; public int pid, tid; }
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool CreateProcess(string app, string cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref SI si, out PI pi);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static bool Run(string cmd, uint flags) { SI si = new SI(); si.cb = Marshal.SizeOf(typeof(SI)); PI pi; if (!CreateProcess(null, cmd, IntPtr.Zero, IntPtr.Zero, false, flags, IntPtr.Zero, null, ref si, out pi)) return false; CloseHandle(pi.hp); CloseHandle(pi.ht); return true; }
}
"@
  # No console window at all, so Windows Terminal (when it is the default console) never shows it
  # and nobody closes it by accident; and outside this session's job, so it outlives the session.
  $cmd = "powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File `"$file`""
  if (-not [KeepWatcher]::Run($cmd, 0x01000000 -bor 0x08000000)) { [void][KeepWatcher]::Run($cmd, 0x08000000) }
  return
}
