# Claude Beautiful autostart (Windows): pastes the sky into the Claude desktop app each time the app opens.
#   -Install    start with Windows (a shortcut in your Startup folder) and start waiting now
#   -Uninstall  remove that shortcut and stop the waiting copy
#   -Once       paste once into the open app, then exit
#   -Show       open the app's developer tools in sight with the sky in the clipboard, for the first paste by hand
# Needs Developer Mode on and one paste by hand with `allow pasting` first (README, steps 2 to 4).
# Log: %LOCALAPPDATA%\ClaudeBeautiful\autostart.log
param([switch]$Install, [switch]$Uninstall, [switch]$Once, [switch]$Show, [int]$Wait = 12, [string]$Source = "$PSScriptRoot\honu\pixel-troi.user.js")
$link = Join-Path ([Environment]::GetFolderPath('Startup')) 'Claude Beautiful.lnk'
$dir = "$env:LOCALAPPDATA\ClaudeBeautiful"
$log = "$dir\autostart.log"
$web = "$env:LOCALAPPDATA\Claude\Logs\claude.ai-web.log"

function Waiting {
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains($PSCommandPath) }
}
if ($Uninstall) {
  Remove-Item $link -ErrorAction SilentlyContinue
  Waiting | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  'Removed: the sky no longer pastes itself when Claude opens.'
  return
}
if ($Install) {
  if (-not (Test-Path $Source)) { throw "Sky script not found: $Source" }
  # Through conhost --headless: no console window at all, so Windows Terminal (when it is the default
  # console) never shows it and nobody closes it by accident.
  $s = (New-Object -ComObject WScript.Shell).CreateShortcut($link)
  $s.TargetPath = "$env:WINDIR\System32\conhost.exe"
  $s.Arguments = "--headless powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  $s.WindowStyle = 7
  $s.Save()
  # Started from a terminal inside the Claude app, the waiting copy would stop when the app closes.
  $p = Get-CimInstance Win32_Process -Filter "ProcessId = $PID"
  for ($i = 0; $i -lt 8 -and $p -and $p.Name -ne 'claude.exe'; $i++) { $p = Get-CimInstance Win32_Process -Filter "ProcessId = $($p.ParentProcessId)" }
  if ($p) {
    'Installed. It starts by itself when you next sign in to Windows. To start it now, double-click "Claude Beautiful"'
    'in your Startup folder: press Win+R, type shell:startup and press Enter.'
    return
  }
  if (-not (Waiting)) { Start-Process $s.TargetPath -ArgumentList $s.Arguments -WindowStyle Hidden }
  'Installed: from the next time Claude opens, the sky pastes itself. To undo, run this file with -Uninstall.'
  return
}

New-Item -ItemType Directory -Force $dir | Out-Null
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class ClaudeSkyWin {
  public delegate bool Enum(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Enum f, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int p);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(int a, int b, bool on);
  [DllImport("kernel32.dll")] public static extern int GetCurrentThreadId();
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern long GetL(IntPtr h, int i);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] public static extern long SetL(IntPtr h, int i, long v);
  [DllImport("user32.dll")] public static extern bool SetLayeredWindowAttributes(IntPtr h, uint k, byte a, uint f);
  [StructLayout(LayoutKind.Sequential)] public struct LastInput { public uint Size; public uint Time; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LastInput l);
  public static uint IdleMs() { LastInput l = new LastInput(); l.Size = (uint)Marshal.SizeOf(typeof(LastInput)); GetLastInputInfo(ref l); return unchecked((uint)Environment.TickCount - l.Time); }
  public static bool Hide = true;
  static IntPtr hit;
  static System.Threading.Thread watcher;
  static bool IsTools(IntPtr h) {
    if (!IsWindowVisible(h)) return false;
    StringBuilder t = new StringBuilder(64); GetWindowText(h, t, 64);
    string s = t.ToString();
    if (!s.Contains("Developer Tools") && !s.Contains("DevTools")) return false;
    int p; GetWindowThreadProcessId(h, out p);
    try { return string.Equals(System.Diagnostics.Process.GetProcessById(p).ProcessName, "claude", StringComparison.OrdinalIgnoreCase); } catch { return false; }
  }
  // Runs on its own thread, started before the shortcut, so the window turns see-through and click-through at once.
  public static void Watch(int ms) {
    hit = IntPtr.Zero;
    watcher = new System.Threading.Thread(() => {
      System.Diagnostics.Stopwatch w = System.Diagnostics.Stopwatch.StartNew();
      Enum look = (h, l) => { if (IsTools(h)) { hit = h; return false; } return true; };
      while (hit == IntPtr.Zero && w.ElapsedMilliseconds < ms) {
        EnumWindows(look, IntPtr.Zero);
        if (hit == IntPtr.Zero) System.Threading.Thread.Sleep(5);
      }
      if (hit != IntPtr.Zero && Hide) { SetL(hit, -20, GetL(hit, -20) | 0x80020); SetLayeredWindowAttributes(hit, 0, 1, 2); }
    });
    watcher.Start();
  }
  public static IntPtr Done() { watcher.Join(); return hit; }
}
"@

function Note($s) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $s" | Add-Content $log -Encoding utf8 }

function AppWindows {
  $found = New-Object System.Collections.ArrayList
  $scan = [ClaudeSkyWin+Enum]{ param($h, $l)
    if ([ClaudeSkyWin]::IsWindowVisible($h)) {
      $t = New-Object Text.StringBuilder 240; [void][ClaudeSkyWin]::GetWindowText($h, $t, 240)
      if ($t.Length) {
        $p = 0; [void][ClaudeSkyWin]::GetWindowThreadProcessId($h, [ref]$p)
        if ((Get-Process -Id $p -ErrorAction SilentlyContinue).ProcessName -eq 'claude') { [void]$found.Add([pscustomobject]@{ H = $h; T = $t.ToString(); P = $p }) }
      }
    }
    $true }
  [void][ClaudeSkyWin]::EnumWindows($scan, [IntPtr]::Zero)
  $found
}

function Tools { AppWindows | Where-Object { $_.T -match 'dev ?tools|developer tools' } | Select-Object -First 1 }

function Focus($h) {
  if ([ClaudeSkyWin]::IsIconic($h)) { [void][ClaudeSkyWin]::ShowWindow($h, 9) }
  $p = 0; $front = [ClaudeSkyWin]::GetWindowThreadProcessId([ClaudeSkyWin]::GetForegroundWindow(), [ref]$p); $me = [ClaudeSkyWin]::GetCurrentThreadId()
  [void][ClaudeSkyWin]::AttachThreadInput($me, $front, $true)
  [void][ClaudeSkyWin]::BringWindowToTop($h); [void][ClaudeSkyWin]::SetForegroundWindow($h)
  [void][ClaudeSkyWin]::AttachThreadInput($me, $front, $false)
  Start-Sleep -Milliseconds 200
  [ClaudeSkyWin]::GetForegroundWindow() -eq $h
}

# Every keystroke that carries text goes through here, so it can never land in the chat box.
function Keys($h, $k) {
  $now = [ClaudeSkyWin]::GetForegroundWindow()
  if ($now -ne $h) {
    $t = New-Object Text.StringBuilder 200; [void][ClaudeSkyWin]::GetWindowText($now, $t, 200)
    throw "focus left the DevTools window before $k (now on: '$t')"
  }
  [Windows.Forms.SendKeys]::SendWait($k)
}

# Ctrl+Alt+I opens DevTools in the Windows app tested here; Ctrl+Shift+I is the documented shortcut.
function OpenTools($main) {
  foreach ($k in '^%i', '^+i') {
    if (-not (Focus $main)) { throw 'could not focus the Claude window' }
    [ClaudeSkyWin]::Watch(8000)
    [Windows.Forms.SendKeys]::SendWait($k)
    $h = [ClaudeSkyWin]::Done()
    if ($h -ne [IntPtr]::Zero) { return $h }
  }
  throw "no DevTools window (is Developer Mode on?); app windows: $((AppWindows | ForEach-Object { $_.T }) -join ' | ')"
}

function LastReport { Get-Content $web -Tail 300 -Encoding utf8 -ErrorAction SilentlyContinue | Where-Object { $_ -match '\[troi\]' } | Select-Object -Last 1 }

Add-Type -AssemblyName System.Web.Extensions
$json = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$json.MaxJsonLength = [int]::MaxValue
function ReadJson($p) { try { $json.DeserializeObject([IO.File]::ReadAllText($p)) } catch { $null } }

# Where the app keeps its settings: the Store build, an MSIX copy, or the regular install.
function AppDirs {
  @(Get-ChildItem "$env:LOCALAPPDATA\Claude-Data" -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }) +
  @(Get-ChildItem "$env:LOCALAPPDATA\Packages" -Directory -Filter 'Claude_*' -ErrorAction SilentlyContinue | ForEach-Object { "$($_.FullName)\LocalCache\Roaming\Claude" }) +
  @("$env:APPDATA\Claude") | Where-Object { Test-Path "$_\Preferences" }
}

# The two things the owner turns on once, by hand: Developer Mode, and `allow pasting` in the Console.
# Only read here; an app whose settings are not found is tried anyway.
function Ready {
  $dirs = @(AppDirs)
  if (-not $dirs.Count) { return $true }
  foreach ($d in $dirs) {
    $tools = (ReadJson "$d\Preferences").electron.devtools.preferences
    if ((ReadJson "$d\developer_settings.json").allowDevTools -eq $true -and $tools -and $tools['disable-self-xss-warning'] -eq 'true') { return $true }
  }
  $false
}

function Paste($main) {
  # Without them every try would take the keyboard for nothing.
  if (-not (Ready)) { Note 'not pasted: turn on Developer Mode and paste once by hand with allow pasting (README)'; return 'notready' }
  $back = [ClaudeSkyWin]::GetForegroundWindow()
  $keepText = [Windows.Forms.Clipboard]::GetText(); $keepImage = [Windows.Forms.Clipboard]::GetImage(); $keepFiles = [Windows.Forms.Clipboard]::GetFileDropList()
  $before = LastReport
  try {
    [Windows.Forms.Clipboard]::SetText([IO.File]::ReadAllText($Source))
    $dev = Tools
    if (-not $dev) {
      $dev = [pscustomobject]@{ H = (OpenTools $main); T = 'Developer Tools (hidden)' }
      Start-Sleep -Seconds 3
    }
    Note "devtools: $($dev.T)"
    if (-not (Focus $dev.H)) { throw 'could not focus the DevTools window' }
    Keys $dev.H '^`'
    Start-Sleep -Milliseconds 500
    Keys $dev.H '^v'
    # A big script takes a while to land in the Console, and an Enter before that runs nothing.
    Start-Sleep -Milliseconds (1500 + [int]((Get-Item $Source).Length / 40))
    Keys $dev.H '{ENTER}'
    Start-Sleep -Seconds 1
  } catch { Note "stopped: $($_.Exception.Message)"; return 'stopped' }
  finally {
    # Closed on every path: a stopped paste must not leave an invisible DevTools window behind.
    if ($dev) { [void][ClaudeSkyWin]::PostMessage($dev.H, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) }
    if ($keepImage) { [Windows.Forms.Clipboard]::SetImage($keepImage) }
    elseif ($keepFiles.Count) { [Windows.Forms.Clipboard]::SetFileDropList($keepFiles) }
    elseif ($keepText) { [Windows.Forms.Clipboard]::SetText($keepText) }
    else { [Windows.Forms.Clipboard]::Clear() }
    [void](Focus $back)
  }
  Start-Sleep -Seconds 25
  $after = LastReport
  if ($after -and $after -ne $before) { Note "ok: $after"; return 'ok' }
  Note 'pasted, but no sky report in the app log'
  'quiet'
}

# Waits for a pause in typing and clicking, so the paste does not cut into the owner's work.
function WaitIdle { $t = [Diagnostics.Stopwatch]::StartNew(); while ([ClaudeSkyWin]::IdleMs() -lt 3000 -and $t.Elapsed.TotalSeconds -lt 120) { Start-Sleep -Milliseconds 500 } }

# A paste can be cut short by a click, or by the app taking the focus while it starts: try again.
function Attempt {
  $quiet = 0
  for ($i = 1; $i -le 3; $i++) {
    WaitIdle
    $m = MainWindow
    if (-not $m) { return }
    $r = Paste $m.H
    if ($r -eq 'ok' -or $r -eq 'notready' -or ($r -eq 'quiet' -and (++$quiet) -ge 2)) { return }
    Start-Sleep -Seconds 15
  }
  Note 'gave up for now: it tries again when the app opens or reloads'
}

function MainWindow { AppWindows | Where-Object { $_.T -ceq 'Claude' } | Select-Object -First 1 }

if ($Once) { $m = MainWindow; if ($m) { Paste $m.H } else { Note 'no Claude window' }; return }

# The first paste stays with the owner: the Console opens in sight, with the sky in the clipboard.
if ($Show) {
  $m = MainWindow
  if (-not $m) { 'Open Claude first, then run this again.'; return }
  [Windows.Forms.Clipboard]::SetText([IO.File]::ReadAllText($Source))
  $dev = Tools
  if ($dev) { $h = $dev.H } else { [ClaudeSkyWin]::Hide = $false; $h = OpenTools $m.H; Start-Sleep -Seconds 2 }
  if (Focus $h) { [Windows.Forms.SendKeys]::SendWait('^`') }
  'The developer tools are open and the sky is in your clipboard. In their Console:'
  '  type  allow pasting  and press Enter, then press Ctrl+V and Enter.'
  return
}

# The same name as the owner's own copy, so two copies never paste twice.
$created = $false
$one = New-Object Threading.Mutex($true, 'Local\BauTroiTuDan', [ref]$created)
if (-not $created) { return }

# The app logs this line each time its page loads: when it opens, and when it reloads itself later.
$load = '\[antalytics\] track\(\) called before init'
$size = [long](Get-Item $web -ErrorAction SilentlyContinue).Length
$since = Get-Date
# Reads only what the app wrote since the last look (plus a little overlap for a line cut in two).
function PageLoaded {
  $fi = [IO.FileInfo]$web
  if (-not $fi.Exists) { return $false }
  $n = $fi.Length
  if (-not $n -or $n -eq $script:size) { return $false }
  $from = if ($n -gt $script:size) { [Math]::Max(0, $script:size - 300) } else { [Math]::Max(0, $n - 65536) }
  $script:size = $n
  try {
    $fs = [IO.File]::Open($web, 'Open', 'Read', 'ReadWrite')
    try { [void]$fs.Seek($from, 'Begin'); $text = (New-Object IO.StreamReader($fs, [Text.Encoding]::UTF8)).ReadToEnd() } finally { $fs.Dispose() }
  } catch { return $false }
  foreach ($l in $text -split "`n") {
    $t = [datetime]::MinValue
    if ($l -match $load -and $l.Length -ge 19 -and [datetime]::TryParseExact($l.Substring(0, 19), 'yyyy-MM-dd HH:mm:ss', $null, 'None', [ref]$t) -and $t -gt $script:since) { return $true }
  }
  $false
}

# A fresh app is ready once its page has logged that line; 3 more seconds let it settle.
# Without the line, this waits $Wait seconds in all.
function Settle {
  $t = [Diagnostics.Stopwatch]::StartNew()
  while (-not (PageLoaded) -and $t.Elapsed.TotalSeconds -lt $Wait - 3) { Start-Sleep -Milliseconds 500 }
  Start-Sleep -Seconds 3
}

$done = 0
$app = $null
$m = MainWindow
if ($m) {
  $opened = (Get-Process -Id $m.P).StartTime
  if (((Get-Date) - $opened).TotalSeconds -gt 180) { $done = $m.P; $app = Get-Process -Id $done }
  # Started just after the app (by the plugin, after an update): its page-load line is already in the log.
  else { $since = $opened.AddSeconds(-1); $size = [Math]::Max(0, $size - 65536) }
}
Note "waiting, app already handled: $done"
# Every 2 seconds. While the app is open: a handle held on it and the log's length, both cheap.
# While it is closed: a look for its process; listing windows only once it runs.
while ($true) {
  Start-Sleep -Seconds 2
  if ($app -and -not $app.HasExited) {
    # The same app, but its page loaded again and took the sky with it.
    if (PageLoaded) {
      Start-Sleep -Seconds 3
      $m = MainWindow
      if ($m) { Note "page reloaded, pid $done"; Attempt; $since = Get-Date }
    }
    continue
  }
  if (-not (Get-Process -Name claude -ErrorAction SilentlyContinue)) { continue }
  if (MainWindow) {
    Settle
    $m = MainWindow
    if ($m) { $done = $m.P; $app = Get-Process -Id $done; Note "app opened, pid $done"; Attempt; $since = Get-Date }
  }
}
