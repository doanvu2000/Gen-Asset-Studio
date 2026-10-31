import { execFile } from 'node:child_process'
import { join } from 'node:path'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

export function run(file: string, args: string[], timeoutMs = 30000): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { windowsHide: true, timeout: timeoutMs, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error ? (typeof (error as NodeJS.ErrnoException).code === 'number' ? Number((error as NodeJS.ErrnoException).code) : 1) : 0
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') || (error ? error.message : '') })
      }
    )
  })
}

const SYS32 = join(process.env['SystemRoot'] || 'C:\\Windows', 'System32')
const REG = join(SYS32, 'reg.exe')
const NET = join(SYS32, 'net.exe')
const POWERSHELL = join(SYS32, 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const LONG_PATH_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem'

export const isWindows = process.platform === 'win32'

export function powershell(script: string, timeoutMs = 60000): Promise<RunResult> {
  const prelude = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$ErrorActionPreference="Stop";'
  const encoded = Buffer.from(prelude + script, 'utf16le').toString('base64')
  return run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], timeoutMs)
}

export async function isAdmin(): Promise<boolean> {
  if (!isWindows) return typeof process.getuid === 'function' && process.getuid() === 0
  const r = await run(NET, ['session'], 15000)
  return r.code === 0
}

export async function readLongPathsEnabled(): Promise<boolean | null> {
  if (!isWindows) return true
  const r = await run(REG, ['query', LONG_PATH_KEY, '/v', 'LongPathsEnabled'], 15000)
  if (r.code !== 0) return false
  const m = /LongPathsEnabled\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(r.stdout)
  if (!m) return null
  return parseInt(m[1] ?? '0', 16) === 1
}

export async function enableLongPaths(admin: boolean): Promise<RunResult> {
  const args = ['add', LONG_PATH_KEY, '/v', 'LongPathsEnabled', '/t', 'REG_DWORD', '/d', '1', '/f']
  if (admin) return run(REG, args, 20000)
  const argList = args.map((a) => `'${a.replace(/'/g, "''")}'`).join(',')
  const script = [
    'try {',
    `$p = Start-Process -FilePath '${REG.replace(/'/g, "''")}' -ArgumentList @(${argList}) -Verb RunAs -Wait -PassThru -WindowStyle Hidden;`,
    'exit $p.ExitCode',
    '} catch {',
    '[Console]::Error.WriteLine($_.Exception.Message); exit 1223',
    '}'
  ].join(' ')
  return powershell(script, 300000)
}

function normalizeDir(p: string): string {
  const expanded = p.replace(/%([^%]+)%/g, (whole, name: string) => process.env[name] ?? whole)
  return expanded.trim().replace(/[\\/]+$/, '').toLowerCase()
}

export async function readUserPath(): Promise<string> {
  const script = [
    "$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment');",
    "$v=$k.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames);",
    '$k.Close();',
    '[Console]::Out.Write($v)'
  ].join(' ')
  const r = await powershell(script, 30000)
  if (r.code !== 0) throw new Error(r.stderr.trim() || `powershell exit ${r.code}`)
  return r.stdout
}

export async function userPathHas(entry: string, expanded: string): Promise<boolean> {
  if (!isWindows) return true
  const raw = await readUserPath()
  const want = new Set([normalizeDir(entry), normalizeDir(expanded)])
  return raw.split(';').some((part) => part.trim() !== '' && want.has(normalizeDir(part)))
}

export async function addUserPath(entry: string, expanded: string): Promise<void> {
  if (!isWindows) return
  const q = (s: string): string => `'${s.replace(/'/g, "''")}'`
  const script = [
    "$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment',$true);",
    "$cur=[string]$k.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames);",
    `$entry=${q(entry)}; $exp=${q(expanded)};`,
    "$parts=@($cur -split ';' | Where-Object { $_.Trim() -ne '' });",
    "$has=$parts | Where-Object { $_.TrimEnd('\\') -ieq $entry -or [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\\') -ieq $exp };",
    "if (-not $has) { $parts += $entry; $k.SetValue('Path', ($parts -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString) };",
    '$k.Close();',
    'Add-Type -Namespace GasWin -Name Native -MemberDefinition \'[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError=true, CharSet=System.Runtime.InteropServices.CharSet.Auto)] public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint Msg, System.UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out System.UIntPtr lpdwResult);\';',
    '$r=[System.UIntPtr]::Zero;',
    "[void][GasWin.Native]::SendMessageTimeout([System.IntPtr]0xffff, 0x1A, [System.UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$r);",
    "[Console]::Out.Write('ok')"
  ].join(' ')
  const r = await powershell(script, 60000)
  if (r.code !== 0 || !r.stdout.includes('ok')) throw new Error(r.stderr.trim() || `powershell exit ${r.code}`)
}

export async function removeUserPath(entry: string, expanded: string): Promise<void> {
  if (!isWindows) return
  const q = (s: string): string => `'${s.replace(/'/g, "''")}'`
  const script = [
    "$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment',$true);",
    "$cur=[string]$k.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames);",
    `$entry=${q(entry)}; $exp=${q(expanded)};`,
    "$parts=@($cur -split ';' | Where-Object { $_.Trim() -ne '' });",
    "$keep=@($parts | Where-Object { -not ($_.TrimEnd('\\') -ieq $entry -or [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\\') -ieq $exp) });",
    "if ($keep.Count -ne $parts.Count) { $k.SetValue('Path', ($keep -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString) };",
    '$k.Close();',
    "[Console]::Out.Write('ok')"
  ].join(' ')
  const r = await powershell(script, 60000)
  if (r.code !== 0 || !r.stdout.includes('ok')) throw new Error(r.stderr.trim() || `powershell exit ${r.code}`)
}

export interface LogicalDisk {
  root: string
  label: string
  type: number
  free: number
  total: number
}

export async function listLogicalDisks(): Promise<LogicalDisk[]> {
  if (!isWindows) return []
  const script = [
    '$d=@(Get-CimInstance Win32_LogicalDisk | ForEach-Object { [pscustomobject]@{ id=[string]$_.DeviceID; label=[string]$_.VolumeName; type=[int]$_.DriveType; free=[double]$_.FreeSpace; total=[double]$_.Size } });',
    '[Console]::Out.Write((ConvertTo-Json -InputObject $d -Compress))'
  ].join(' ')
  const r = await powershell(script, 30000)
  if (r.code !== 0) throw new Error(r.stderr.trim() || `powershell exit ${r.code}`)
  const raw = JSON.parse(r.stdout || '[]') as unknown
  const list = Array.isArray(raw) ? raw : [raw]
  return list
    .map((x) => x as Record<string, unknown>)
    .filter((x) => typeof x.id === 'string' && x.id !== '')
    .map((x) => ({
      root: `${String(x.id)}\\`,
      label: typeof x.label === 'string' ? x.label : '',
      type: typeof x.type === 'number' ? x.type : 0,
      free: typeof x.free === 'number' ? x.free : 0,
      total: typeof x.total === 'number' ? x.total : 0
    }))
}
