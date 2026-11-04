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
  [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
  [StructLayout(LayoutKind.Sequential)] public struct LastInput { public uint Size; public uint Time; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LastInput l);
  static uint InputAt() { LastInput l = new LastInput(); l.Size = (uint)Marshal.SizeOf(typeof(LastInput)); GetLastInputInfo(ref l); return l.Time; }
  public static uint IdleMs() { return unchecked((uint)Environment.TickCount - InputAt()); }
  // Mark() when the keyboard is taken and after each key sent; Moved() then tells whether the owner typed or clicked since.
  static uint mark;
  public static void Mark() { mark = unchecked((uint)Environment.TickCount); }
  public static bool Moved() { return unchecked((int)(InputAt() - mark)) > 150; }
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

# Before every key: the focus must still be on $h, and the owner must not have typed or clicked since the
# keyboard was taken. So a key never lands in another window, and nothing the owner types ever runs.
function Check($h, $k) {
  $now = [ClaudeSkyWin]::GetForegroundWindow()
  if ($now -ne $h) {
    $t = New-Object Text.StringBuilder 200; [void][ClaudeSkyWin]::GetWindowText($now, $t, 200)
    throw "focus left the window before $k (now on: '$t')"
  }
  if ([ClaudeSkyWin]::Moved()) { throw "the owner typed or clicked before $k" }
}

function Keys($h, $k) { Check $h $k; [Windows.Forms.SendKeys]::SendWait($k); [ClaudeSkyWin]::Mark() }

# Ctrl+Alt+I opens DevTools in the Windows app tested here; Ctrl+Shift+I is the documented shortcut.
# $careful: the keys go only while the owner stays still, as for the automatic paste.
function OpenTools($main, $careful) {
  foreach ($k in '^%i', '^+i') {
    [ClaudeSkyWin]::Mark()
    if (-not (Focus $main)) { throw 'could not focus the Claude window' }
    if ($careful) { Check $main $k }
    [ClaudeSkyWin]::Watch(8000)
    [Windows.Forms.SendKeys]::SendWait($k)
    [ClaudeSkyWin]::Mark()
    $h = [ClaudeSkyWin]::Done()
    if ($h -ne [IntPtr]::Zero) { return $h }
  }
  # One that opens late would stay in sight: it is closed without a key, which could land elsewhere.
  Start-Sleep -Seconds 2
  $late = Tools; if ($late) { [void][ClaudeSkyWin]::PostMessage($late.H, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) }
  throw "no DevTools window (is Developer Mode on?); app windows: $((AppWindows | ForEach-Object { $_.T }) -join ' | ')"
}

# Gives the keyboard back to the window the owner was in, unless they already went somewhere else.
function GiveBack($back, $ours) {
  $now = [ClaudeSkyWin]::GetForegroundWindow()
  if ($back -and $back -ne [IntPtr]::Zero -and $back -ne $now -and $ours -contains $now) { [void](Focus $back) }
}

# Waits until the owner is in the Claude window and has not typed or clicked for 3 seconds, so the paste
# never pulls a window to the front over their work, nor cuts into their typing. $s seconds at most (0: no limit);
# false then, or when the window is gone.
function WaitQuiet($main, $s) {
  $t = [Diagnostics.Stopwatch]::StartNew()
  while ([ClaudeSkyWin]::GetForegroundWindow() -ne $main -or [ClaudeSkyWin]::IdleMs() -lt 3000) {
    if (-not [ClaudeSkyWin]::IsWindowVisible($main) -or ($s -and $t.Elapsed.TotalSeconds -ge $s)) { return $false }
    Start-Sleep -Milliseconds 500
  }
  $true
}

# Puts something on the clipboard without a new entry in the clipboard history (Win+V) or the cloud clipboard.
function Clip($text, $image, $files) {
  $o = New-Object Windows.Forms.DataObject
  if ($image) { $o.SetImage($image) } elseif ($files.Count) { $o.SetFileDropList($files) } else { $o.SetText($text) }
  $o.SetData('ExcludeClipboardContentFromMonitorProcessing', (New-Object IO.MemoryStream (, [byte[]](0, 0, 0, 0))))
  [Windows.Forms.Clipboard]::SetDataObject($o, $true)
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

# Three short moments with the keyboard, each once the owner pauses in the Claude window: open DevTools out of
# sight, paste and run the sky, and one more Enter. The keyboard goes back to the owner in between.
function Paste($main, $patience) {
  # Without them every try would take the keyboard for nothing.
  if (-not (Ready)) { Note 'not pasted: turn on Developer Mode and paste once by hand with allow pasting (README)'; return 'notready' }
  $before = LastReport
  $dev = $null; $back = $null; $ours = @(); $seq = 0
  try {
    $dev = Tools
    if (-not $dev) {
      if (-not (WaitQuiet $main $patience)) { throw 'no pause in the Claude window' }
      $back = [ClaudeSkyWin]::GetForegroundWindow(); $ours = @($main)
      $h = OpenTools $main $true
      $dev = [pscustomobject]@{ H = $h; T = 'Developer Tools (hidden)' }
      $ours = @($main, $h)
      # They load out of sight while the owner has the keyboard back.
      GiveBack $back $ours
      Start-Sleep -Seconds 3
    }
    Note "devtools: $($dev.T)"
    if (-not (WaitQuiet $main 120)) { throw 'no pause in the Claude window for 2 minutes' }
    $keepText = [Windows.Forms.Clipboard]::GetText(); $keepImage = [Windows.Forms.Clipboard]::GetImage(); $keepFiles = [Windows.Forms.Clipboard]::GetFileDropList()
    Clip ([IO.File]::ReadAllText($Source))
    $seq = [ClaudeSkyWin]::GetClipboardSequenceNumber()
    $back = [ClaudeSkyWin]::GetForegroundWindow(); $ours = @($dev.H)
    [ClaudeSkyWin]::Mark()
    if (-not (Focus $dev.H)) { throw 'could not focus the DevTools window' }
    Keys $dev.H '^`'
    Start-Sleep -Milliseconds 500
    # The prompt emptied first, so nothing left in it runs along with the sky.
    Keys $dev.H '^a'
    Keys $dev.H '{DEL}'
    Keys $dev.H '^v'
    Keys $dev.H '{ENTER}'
    $script:pastedAt = Get-Date
    GiveBack $back $ours
    # A big script can land in the Console after that Enter, which then ran nothing: one more Enter once it has
    # surely landed. In an empty Console an Enter does nothing; and this one is sent only if nobody typed or
    # clicked since, so nothing else can be in the Console.
    Start-Sleep -Milliseconds (1500 + [int]((Get-Item $Source).Length / 40))
    if (-not [ClaudeSkyWin]::Moved()) {
      $back = [ClaudeSkyWin]::GetForegroundWindow()
      if (Focus $dev.H) { try { Keys $dev.H '{ENTER}' } catch {}; GiveBack $back $ours }
    }
  } catch { Note "stopped: $($_.Exception.Message)"; return 'stopped' }
  finally {
    GiveBack $back $ours
    # Closed on every path: a stopped paste must not leave an invisible DevTools window behind.
    if ($dev) { [void][ClaudeSkyWin]::PostMessage($dev.H, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) }
    # The owner's clipboard back, unless they copied something new meanwhile.
    if ($seq -and [ClaudeSkyWin]::GetClipboardSequenceNumber() -eq $seq) {
      if ($keepImage -or $keepFiles.Count -or $keepText) { Clip $keepText $keepImage $keepFiles } else { [Windows.Forms.Clipboard]::Clear() }
    }
  }
  Start-Sleep -Seconds 25
  $after = LastReport
  if ($after -and $after -ne $before) { Note "ok: $after"; return 'ok' }
  Note 'pasted, but no sky report in the app log'
  'quiet'
}

# A paste stops when the owner clicks or types in the middle of it: it tries again at their next pause.
function Attempt {
  $script:pastedAt = $null
  try {
    $quiet = 0
    for ($i = 1; $i -le 6; $i++) {
      $m = MainWindow
      if (-not $m) { return }
      $r = Paste $m.H 0
      if ($r -eq 'ok' -or $r -eq 'notready' -or ($r -eq 'quiet' -and (++$quiet) -ge 2)) { return }
      Start-Sleep -Seconds 10
    }
    Note 'gave up for now: it tries again when the app opens or reloads'
  } finally {
    # A page load logged after the paste counts again (the app can reload just after it); the second before
    # it too, as the logs keep whole seconds only.
    $script:since = if ($script:pastedAt) { $script:pastedAt.AddSeconds(-1) } else { Get-Date }
  }
}

function MainWindow { AppWindows | Where-Object { $_.T -ceq 'Claude' } | Select-Object -First 1 }

if ($Once) { $m = MainWindow; if ($m) { Paste $m.H 120 } else { Note 'no Claude window' }; return }

# The first paste stays with the owner: the Console opens in sight, with the sky in the clipboard.
if ($Show) {
  $m = MainWindow
  if (-not $m) { 'Open Claude first, then run this again.'; return }
  Clip ([IO.File]::ReadAllText($Source))
  $dev = Tools
  if ($dev) { $h = $dev.H } else { [ClaudeSkyWin]::Hide = $false; $h = OpenTools $m.H $false; Start-Sleep -Seconds 2 }
  if (Focus $h) { [Windows.Forms.SendKeys]::SendWait('^`') }
  'The developer tools are open and the sky is in your clipboard. In their Console:'
  '  type  allow pasting  and press Enter, then press Ctrl+V and Enter.'
  return
}

# The same name as the owner's own copy, so two copies never paste twice.
$created = $false
$one = New-Object Threading.Mutex($true, 'Local\BauTroiTuDan', [ref]$created)
if (-not $created) { return }

# The app logs one of these lines each time its page loads: when it opens, and when it reloads itself later.
# main.log says so in words; claude.ai-web.log has two warnings that came with every load so far.
$marks = @(
  @{ File = "$env:LOCALAPPDATA\Claude\Logs\main.log"; Line = '\[info\] Loaded https://claude\.ai \(' }
  @{ File = $web; Line = '\[antalytics\] track\(\) called before init|_\$_AppPreferences_\$_preferencesChanged listeners added' }
)
foreach ($k in $marks) { $k.Size = [long](Get-Item $k.File -ErrorAction SilentlyContinue).Length }
$since = Get-Date

# A log from byte $from on. The app keeps it open, so it is read beside the app.
function LogText($file, $from) {
  $fs = [IO.File]::Open($file, 'Open', 'Read', 'ReadWrite')
  try { [void]$fs.Seek($from, 'Begin'); (New-Object IO.StreamReader($fs, [Text.Encoding]::UTF8)).ReadToEnd() } finally { $fs.Dispose() }
}

function Stamp($l) {
  $t = [datetime]::MinValue
  if ($l.Length -ge 19) { [void][datetime]::TryParseExact($l.Substring(0, 19), 'yyyy-MM-dd HH:mm:ss', $null, 'None', [ref]$t) }
  $t
}

# What the app added to a log since the last look (plus a little overlap for a line cut in two).
function Added($k) {
  $fi = [IO.FileInfo]$k.File
  if (-not $fi.Exists) { return '' }
  $n = $fi.Length
  if (-not $n -or $n -eq $k.Size) { return '' }
  $from = if ($n -gt $k.Size) { [Math]::Max(0, $k.Size - 300) } else { [Math]::Max(0, $n - 65536) }
  $k.Size = $n
  try { LogText $k.File $from } catch { '' }
}

# Each log is read every time, so the next look starts where this one stopped.
function PageLoaded {
  $hit = $false
  foreach ($k in $marks) { foreach ($l in (Added $k) -split "`n") { if ($l -match $k.Line -and (Stamp $l) -gt $script:since) { $hit = $true } } }
  $hit
}

# A fresh app is ready once its page has logged that line; 3 more seconds let it settle.
# Without the line, this waits $Wait seconds in all.
function Settle {
  $t = [Diagnostics.Stopwatch]::StartNew()
  while (-not (PageLoaded) -and $t.Elapsed.TotalSeconds -lt $Wait - 3) { Start-Sleep -Milliseconds 500 }
  Start-Sleep -Seconds 3
}

# When the last line matching $re was written in the last 4 MB of a log.
function LastLine($file, $re) {
  $fi = [IO.FileInfo]$file
  if (-not $fi.Exists) { return [datetime]::MinValue }
  try { $text = LogText $file ([Math]::Max(0, $fi.Length - 4MB)) } catch { return [datetime]::MinValue }
  $m = [regex]::Match($text, "(?m)^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) [^\n]*(?:$re)", 'RightToLeft')
  if ($m.Success) { Stamp $m.Groups[1].Value } else { [datetime]::MinValue }
}

# True when the open app's page loaded after the last sky report: it is there without the sky.
function NoSky {
  $page = [datetime]::MinValue
  foreach ($k in $marks) { $t = LastLine $k.File $k.Line; if ($t -gt $page) { $page = $t } }
  $page -gt (LastLine $web '\[troi\]')
}

$done = 0
$app = $null
$m = MainWindow
if ($m) {
  $opened = (Get-Process -Id $m.P).StartTime
  # Started just after the app (by the plugin, after an update): its page-load line is already in the logs.
  if (((Get-Date) - $opened).TotalSeconds -lt 180) { $since = $opened.AddSeconds(-1); foreach ($k in $marks) { $k.Size = [Math]::Max(0, $k.Size - 262144) } }
  else {
    $done = $m.P; $app = Get-Process -Id $done
    # Open for a while, but its page loaded again after the last sky while nothing watched: it gets the sky now.
    if (NoSky) { Note "app open without the sky, pid $done"; Attempt }
  }
}
Note "waiting, app already handled: $done"
# Every 2 seconds. While the app is open: a handle held on it and the logs' lengths, all cheap.
# While it is closed: a look for its process; listing windows only once it runs.
while ($true) {
  Start-Sleep -Seconds 2
  if ($app -and -not $app.HasExited) {
    # The same app, but its page loaded again and took the sky with it.
    if (PageLoaded) {
      Start-Sleep -Seconds 3
      $m = MainWindow
      if ($m) { Note "page reloaded, pid $done"; Attempt }
    }
    continue
  }
  if (-not (Get-Process -Name claude -ErrorAction SilentlyContinue)) { continue }
  if (MainWindow) {
    Settle
    $m = MainWindow
    if ($m) { $done = $m.P; $app = Get-Process -Id $done; Note "app opened, pid $done"; Attempt }
  }
}
