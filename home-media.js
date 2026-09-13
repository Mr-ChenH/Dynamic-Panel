'use strict';
const { execFile } = require('node:child_process');
const ACTIONS = new Set(['status', 'toggle', 'previous', 'next']);
const WINDOWS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
function Await($Operation, $Type) {
  $Method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\u00601' } | Select-Object -First 1
  $Task = $Method.MakeGenericMethod($Type).Invoke($null, @($Operation))
  if (-not $Task.Wait(5000)) { throw 'timeout' }
  return $Task.Result
}
$ManagerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
$Manager = Await ($ManagerType::RequestAsync()) $ManagerType
$Session = $Manager.GetCurrentSession()
if ($null -eq $Session) { @{ok=$false;error='no_session'} | ConvertTo-Json -Compress; exit }
$Info = $Session.GetPlaybackInfo()
$Controls = $Info.Controls
if ($Action -ne 'status') {
  $Allowed = switch ($Action) { 'toggle' { $Controls.IsPlayPauseToggleEnabled } 'previous' { $Controls.IsPreviousEnabled } 'next' { $Controls.IsNextEnabled } }
  if (-not $Allowed) { @{ok=$false;error='control_unavailable'} | ConvertTo-Json -Compress; exit }
  $Operation = switch ($Action) { 'toggle' { $Session.TryTogglePlayPauseAsync() } 'previous' { $Session.TrySkipPreviousAsync() } 'next' { $Session.TrySkipNextAsync() } }
  $Result = Await $Operation ([bool])
  @{ok=[bool]$Result;error=$(if($Result){''}else{'control_failed'})} | ConvertTo-Json -Compress
  exit
}
$PropertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
$Properties = Await ($Session.TryGetMediaPropertiesAsync()) $PropertiesType
@{ok=$true;sessionActive=$true;title=$Properties.Title;artist=$Properties.Artist;playing=($Info.PlaybackStatus.ToString() -eq 'Playing');canPlayPause=$Controls.IsPlayPauseToggleEnabled;canPrevious=$Controls.IsPreviousEnabled;canNext=$Controls.IsNextEnabled} | ConvertTo-Json -Compress
`;
function run(file, args) {
  return new Promise((resolve, reject) => execFile(file, args, { windowsHide: true, timeout: 15000, maxBuffer: 64 * 1024, encoding: 'utf8' }, (error, stdout) => error ? reject(error) : resolve(stdout.trim())));
}
async function media(action = 'status') {
  if (!ACTIONS.has(action)) return { ok: false, error: 'invalid_action' };
  try {
    if (process.platform === 'win32') {
      const script = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n$Action='${action}'\n${WINDOWS_SCRIPT}`;
      return JSON.parse(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]));
    }
    if (process.platform === 'darwin') {
      const sessions = [];
      for (const app of ['Music', 'Spotify']) {
        if (await run('/usr/bin/osascript', ['-e', `application "${app}" is running`]) !== 'true') continue;
        const result = await run('/usr/bin/osascript', ['-e', `tell application "${app}"\nif player state is stopped then return ""\nreturn (name of current track) & linefeed & (artist of current track) & linefeed & (player state as text)\nend tell`]);
        if (!result) continue;
        const [title, artist, state] = result.split('\n');
        sessions.push({ app, title, artist, playing: state === 'playing' });
      }
      const session = sessions.find((item) => item.playing) || sessions[0];
      if (!session) return { ok: false, error: 'no_session' };
      const command = { toggle: 'playpause', previous: 'previous track', next: 'next track' }[action];
      if (command) { await run('/usr/bin/osascript', ['-e', `tell application "${session.app}" to ${command}`]); return { ok: true }; }
      return { ok: true, sessionActive: true, title: session.title, artist: session.artist, playing: session.playing, canPlayPause: true, canPrevious: true, canNext: true };
    }
    return { ok: false, error: 'unsupported' };
  } catch { return { ok: false, error: 'media_unavailable' }; }
}
let pending = null;
async function getMediaStatus() {
  if (pending) return { ok: false, error: 'busy' };
  pending = media('status');
  try { return await pending; } finally { pending = null; }
}
async function controlMedia(action) {
  if (!['toggle', 'previous', 'next'].includes(action)) return { ok: false, error: 'invalid_action' };
  if (pending) return { ok: false, error: 'busy' };
  pending = media(action);
  try { return await pending; } finally { pending = null; }
}
module.exports = { getMediaStatus, controlMedia };
