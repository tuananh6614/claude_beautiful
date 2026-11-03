# Claude Beautiful installer for Windows. In PowerShell:
#   irm https://raw.githubusercontent.com/tuananh6614/claude_beautiful/main/install.ps1 | iex
# With options:
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/tuananh6614/claude_beautiful/main/install.ps1))) -Uninstall
#   -Yes         do not ask before each step
#   -PluginOnly  install the plugin only, without the automatic paste
#   -Uninstall   remove the plugin and the automatic paste
param([switch]$Yes, [switch]$PluginOnly, [switch]$Uninstall)
$repo = 'tuananh6614/claude_beautiful'
$market = 'claude_theme'
$plugin = "honu@$market"

function Say($s, $c = 'Gray') { Write-Host $s -ForegroundColor $c }
function Ask($q) { $Yes -or ((Read-Host "$q [Y/n]") -notmatch '^\s*n') }
function Has($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }
# A program installed a moment ago is not on this window's PATH yet.
function Refresh { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ";$env:USERPROFILE\.local\bin" }
function Market { try { @((claude plugin marketplace list --json 2>$null) -join "`n" | ConvertFrom-Json) | Where-Object { $_.name -eq $market } } catch { $null } }
function Stop($s) { Say $s 'Red'; throw $s }

Add-Type -AssemblyName System.Web.Extensions
$json = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$json.MaxJsonLength = [int]::MaxValue
function ReadJson($p) { try { $json.DeserializeObject([IO.File]::ReadAllText($p)) } catch { $null } }

if ($Uninstall) {
  if (Has claude) {
    $m = Market
    if ($m -and (Test-Path "$($m.installLocation)\autostart.ps1")) { & powershell -NoProfile -ExecutionPolicy Bypass -File "$($m.installLocation)\autostart.ps1" -Uninstall }
    claude plugin uninstall $plugin
    claude plugin marketplace remove $market
  }
  Say 'Removed. Restart Claude and the sky is gone. Developer Mode stays on: turn it off in Help > Troubleshooting if you like.' 'Green'
  return
}

Say 'Claude Beautiful: a live sky behind Claude Code' 'Cyan'
Say 'This will:'
Say '  1. check Git and Claude Code, and offer to install what is missing'
Say "  2. install the honu plugin from github.com/$repo, with auto-update on"
if (-not $PluginOnly) { Say '  3. paste the sky by itself each time the Claude app opens (a small script that starts with Windows)' }
if (-not (Ask 'Continue?')) { return }

# 1. Git clones the plugin; the claude command installs it.
if (-not (Has git)) {
  if ((Has winget) -and (Ask 'Git is missing. Install it with winget?')) { winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements; Refresh }
  if (-not (Has git)) { Stop 'Git is needed: install it from https://git-scm.com/downloads/win, open a new PowerShell and run this again.' }
}
if (-not (Has claude)) {
  if (Ask 'The claude command (Claude Code) is missing. Install it with the official installer?') { Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression; Refresh }
  if (-not (Has claude)) { Stop 'The claude command is needed: https://code.claude.com/docs/en/setup' }
}
Say 'OK  Git and Claude Code' 'Green'

# 2. The plugin, from this repository.
if (-not (Market)) { claude plugin marketplace add $repo }
claude plugin install $plugin
$m = Market
if (-not $m) { Stop "The $market marketplace was not added (see the lines above)." }
Say "OK  $plugin installed" 'Green'

# Plugins from community marketplaces do not update on their own; this turns it on for this one only.
$cfg = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { "$env:USERPROFILE\.claude" }
$file = Join-Path $cfg 'settings.json'
$text = if (Test-Path $file) { [IO.File]::ReadAllText($file) } else { '' }
$entry = (ReadJson $file).extraKnownMarketplaces.$market
if ($entry -and $entry.autoUpdate -eq $true) { Say 'OK  auto-update was already on' 'Green' }
else {
  $at = [regex]::Matches($text, "`"$market`"\s*:\s*\{")
  $new = $null
  if ($at.Count -eq 1) {
    $i = $at[0].Index + $at[0].Length
    $new = $text.Insert($i, "`n      `"autoUpdate`": true" + $(if ($text.Substring($i).TrimStart()[0] -ne '}') { ',' }))
    # Keep it only if that one key is all that changed.
    $check = $json.DeserializeObject($new)
    $check.extraKnownMarketplaces.$market.Remove('autoUpdate') | Out-Null
    if ($json.Serialize($check) -cne $json.Serialize($json.DeserializeObject($text))) { $new = $null }
  }
  if ($new) {
    if (-not (Test-Path "$file.before-claude-beautiful")) { Copy-Item $file "$file.before-claude-beautiful" }
    [IO.File]::WriteAllText($file, $new, (New-Object Text.UTF8Encoding($false)))
    Say 'OK  auto-update on' 'Green'
  } else { Say "Turn on auto-update yourself: run claude, type /plugin, Marketplaces, $market, Enable auto-update." 'Yellow' }
}

if ($PluginOnly) { Say 'Done. In a Code session of the Claude app, type /troi and follow the README.' 'Green'; return }

# 3. The automatic paste, from the copy of this repository the plugin was installed from.
$auto = Join-Path $m.installLocation 'autostart.ps1'
& powershell -NoProfile -ExecutionPolicy Bypass -File $auto -Install
Say 'OK  automatic paste installed' 'Green'

# Two switches in the app stay with you, once: Developer Mode, and allowing a paste in its Console.
# This only reads the app's settings to see whether they are on.
function AppDirs {
  @(Get-ChildItem "$env:LOCALAPPDATA\Claude-Data" -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }) +
  @(Get-ChildItem "$env:LOCALAPPDATA\Packages" -Directory -Filter 'Claude_*' -ErrorAction SilentlyContinue | ForEach-Object { "$($_.FullName)\LocalCache\Roaming\Claude" }) +
  @("$env:APPDATA\Claude") | Where-Object { Test-Path "$_\Preferences" }
}
function DevMode { [bool](AppDirs | Where-Object { (ReadJson "$_\developer_settings.json").allowDevTools -eq $true }) }
function Pasting { [bool](AppDirs | Where-Object { $t = (ReadJson "$_\Preferences").electron.devtools.preferences; $t -and $t['disable-self-xss-warning'] -eq 'true' }) }
$log = "$env:LOCALAPPDATA\ClaudeBeautiful\autostart.log"

if (-not (AppDirs)) { Say 'Open the Claude app once, then run this installer again to finish.' 'Yellow'; return }
if (-not (DevMode)) {
  Say ''
  Say 'Your turn, once: turn on Developer Mode in the Claude app.' 'Yellow'
  Say '  Click the menu button at the top left of the Claude window, then Help > Troubleshooting > Enable Developer Mode.'
  Read-Host 'Press Enter here when it is on' | Out-Null
  if (-not (DevMode)) { Say 'Developer Mode still looks off. If the next step cannot open the developer tools, quit Claude, open it again and run this installer again.' 'Yellow' }
}
if (Pasting) {
  Say 'Pasting the sky now...'
  & powershell -NoProfile -STA -ExecutionPolicy Bypass -File $auto -Once
  $last = Get-Content $log -Tail 1 -Encoding utf8 -ErrorAction SilentlyContinue
  if ($last -match ' ok: ') { Say 'Done. The sky is on, and it comes back by itself each time Claude opens.' 'Green' }
  else { Say "Pasted. If the sky is not there, the last line of $log says why:" 'Yellow'; Say "  $last" 'Yellow' }
  return
}
Say ''
Say 'Your turn, once: the first paste.' 'Yellow'
Say '  Press Enter: the developer tools of Claude open, with the sky in your clipboard.'
Say '  In their Console, type  allow pasting  and press Enter, then press Ctrl+V and Enter.'
Read-Host 'Press Enter to open them' | Out-Null
& powershell -NoProfile -STA -ExecutionPolicy Bypass -File $auto -Show
if ($LASTEXITCODE) { Say 'The developer tools did not open. Quit Claude completely, open it again and run this installer again.' 'Yellow'; return }
Say 'After that, the sky comes back by itself each time Claude opens.' 'Green'
