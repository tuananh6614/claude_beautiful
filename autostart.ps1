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
  $s = (New-Object -ComObject WScript.Shell).CreateShortcut($link)
  $s.TargetPath = 'powershell.exe'
  $s.Arguments = "-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  $s.WindowStyle = 7
  $s.Save()
  if (-not (Waiting)) { Start-Process powershell.exe -ArgumentList $s.Arguments -WindowStyle Hidden }
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
  if (-not (Ready)) { Note 'not pasted: turn on Developer Mode and paste once by hand with allow pasting (README)'; return }
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
  } catch { Note "stopped: $($_.Exception.Message)"; return }
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
  if ($after -and $after -ne $before) { Note "ok: $after" } else { Note 'pasted, but no sky report in the app log' }
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
$size = 0
$since = Get-Date
function PageLoaded {
  $n = (Get-Item $web -ErrorAction SilentlyContinue).Length
  if (-not $n -or $n -eq $script:size) { return $false }
  $script:size = $n
  foreach ($l in (Get-Content $web -Tail 300 -Encoding utf8 -ErrorAction SilentlyContinue)) {
    $t = [datetime]::MinValue
    if ($l -match $load -and [datetime]::TryParseExact($l.Substring(0, 19), 'yyyy-MM-dd HH:mm:ss', $null, 'None', [ref]$t) -and $t -gt $script:since) { return $true }
  }
  $false
}

$done = 0
$m = MainWindow
if ($m -and ((Get-Date) - (Get-Process -Id $m.P).StartTime).TotalSeconds -gt 180) { $done = $m.P }
Note "waiting, app already handled: $done"
while ($true) {
  Start-Sleep -Seconds 3
  # Listing windows costs CPU: skip it while the app is closed or already done.
  if ($done -and (Get-Process -Id $done -ErrorAction SilentlyContinue)) {
    # The same app, but its page loaded again and took the sky with it.
    if (PageLoaded) {
      Start-Sleep -Seconds $Wait
      $m = MainWindow
      if ($m) { Note "page reloaded, pid $done"; Paste $m.H; $since = Get-Date }
    }
    continue
  }
  if (-not (Get-Process -Name claude -ErrorAction SilentlyContinue)) { continue }
  if (MainWindow) {
    Start-Sleep -Seconds $Wait
    $m = MainWindow
    if ($m) { $done = $m.P; Note "app opened, pid $done"; Paste $m.H; $since = Get-Date }
  }
}
