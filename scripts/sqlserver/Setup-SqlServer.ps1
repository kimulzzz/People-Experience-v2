<#
.SYNOPSIS
  Installs SQL Server Express on this PC and provisions the People Experience database.

.DESCRIPTION
  Must run in an ELEVATED PowerShell (Run as administrator):
      powershell -ExecutionPolicy Bypass -File scripts\sqlserver\Setup-SqlServer.ps1

  What it does:
    1. Installs SQL Server Express through winget (Microsoft's own signed installer), unless a
       SQL Server instance is already present.
       NOTE: Microsoft's SQL Server 2022 Express installer link is currently dead (HTTP 404 from
       winget's manifest and from the old fwlink, which now serves 2025), so the current free
       Express release (2025) is installed. The app only needs standard T-SQL, so the version
       does not matter to it.
    2. Switches the instance to Mixed Mode (SQL Server Authentication) and pins TCP/IP to the
       static port 1433, then restarts it.
    3. Using YOUR Windows administrator identity (Integrated Security - no `sa` password is ever
       created or needed) it creates the PeopleExperiencePX database and a dedicated `px_app`
       login that owns ONLY that database, and writes the DB_* settings to .env (gitignored).
       STORAGE_BACKEND is NOT touched - the app keeps using the JSON store until
       server/db/migrate.js has loaded the data.

  Re-running is safe (idempotent). Progress is logged to scripts\sqlserver\setup.log.
#>
[CmdletBinding()]
param(
  [string]$ProjectRoot = '',
  [string]$DbName = 'PeopleExperiencePX',
  [string]$AppLogin = 'px_app',
  [int]$Port = 1433
)

$ErrorActionPreference = 'Stop'
# $PSScriptRoot is empty inside param() defaults on Windows PowerShell 5.1, so resolve paths here.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ProjectRoot) { $ProjectRoot = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path }
$LogFile = Join-Path $ScriptDir 'setup.log'
$EnvFile = Join-Path $ProjectRoot '.env'

function Log([string]$Message) {
  $line = '[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $Message
  Write-Host $line
  Add-Content -Path $LogFile -Value $line
}

# Letters + digits only: meets SQL Server's complexity policy and is safe inside T-SQL literals,
# connection strings and .env without escaping.
function New-RandomPassword([int]$Length = 28) {
  $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'.ToCharArray()
  $bytes = New-Object byte[] $Length
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  'Px9' + (-join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] }))
}

function Get-SqlService {
  Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'MSSQLSERVER' -or $_.Name -like 'MSSQL$*' } | Select-Object -First 1
}

function Invoke-Sql([string]$ConnectionString, [string]$Query, [switch]$Scalar) {
  $conn = New-Object System.Data.SqlClient.SqlConnection $ConnectionString
  $conn.Open()
  try {
    $cmd = $conn.CreateCommand(); $cmd.CommandText = $Query; $cmd.CommandTimeout = 120
    if ($Scalar) { return $cmd.ExecuteScalar() } else { [void]$cmd.ExecuteNonQuery() }
  } finally { $conn.Close() }
}

function Set-EnvValues([string]$Path, [hashtable]$Values) {
  $lines = @(); if (Test-Path $Path) { $lines = @(Get-Content -Path $Path) }
  $missing = @()
  foreach ($k in $Values.Keys) {
    $found = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
      if ($lines[$i] -match ('^' + [regex]::Escape($k) + '=')) { $lines[$i] = "$k=$($Values[$k])"; $found = $true; break }
    }
    if (-not $found) { $missing += "$k=$($Values[$k])" }
  }
  if ($missing.Count -gt 0) {
    $lines += ''; $lines += '# --- Microsoft SQL Server (written by scripts/sqlserver/Setup-SqlServer.ps1) ---'; $lines += $missing
  }
  Set-Content -Path $Path -Value $lines -Encoding UTF8
}

try {
  Set-Content -Path $LogFile -Value ("=== SQL Server setup started {0} ===" -f (Get-Date))

  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $isAdmin) { throw 'This script must be run as Administrator.' }

  # ---- 1. Install -------------------------------------------------------------------------
  $svc = Get-SqlService
  if ($svc) {
    Log "SQL Server instance already present ($($svc.Name), status: $($svc.Status)) - skipping install."
  } else {
    $winget = (Get-Command winget -ErrorAction SilentlyContinue).Source
    if (-not $winget) { throw 'winget not found. Install "App Installer" from the Microsoft Store, then re-run.' }
    Log 'Installing SQL Server Express via winget (5-15 minutes, please wait) ...'
    $wgOut = & $winget install --id Microsoft.SQLServer.2025.Express -e --silent --accept-package-agreements --accept-source-agreements 2>&1
    $wgOut | ForEach-Object { Log "  winget: $_" }
    $svc = Get-SqlService
    if (-not $svc) { throw "winget finished (exit code $LASTEXITCODE) but no SQL Server service exists. Check the Summary.txt under C:\Program Files\Microsoft SQL Server\*\Setup Bootstrap\Log." }
    Log "Installed: service $($svc.Name)."
  }

  # ---- 2. Mixed Mode + static TCP port ------------------------------------------------------
  $instanceKey = if ($svc.Name -eq 'MSSQLSERVER') { 'MSSQLSERVER' } else { $svc.Name -replace '^MSSQL\$', '' }
  $instNames = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL'
  $instanceId = $instNames.$instanceKey
  if (-not $instanceId) { throw "Could not resolve the registry instance id for '$instanceKey'." }
  $base = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$instanceId\MSSQLServer"
  Log "Configuring instance $instanceId (Mixed Mode, TCP $Port) ..."
  Set-ItemProperty -Path $base -Name LoginMode -Value 2
  Set-ItemProperty -Path "$base\SuperSocketNetLib\Tcp" -Name Enabled -Value 1
  Set-ItemProperty -Path "$base\SuperSocketNetLib\Tcp\IPAll" -Name TcpPort -Value "$Port"
  Set-ItemProperty -Path "$base\SuperSocketNetLib\Tcp\IPAll" -Name TcpDynamicPorts -Value ''

  Log 'Restarting the SQL Server service ...'
  Restart-Service -Name $svc.Name -Force
  (Get-Service -Name $svc.Name).WaitForStatus('Running', '00:02:00')
  $ready = $false
  for ($i = 0; $i -lt 40; $i++) {
    if ((Test-NetConnection -ComputerName localhost -Port $Port -WarningAction SilentlyContinue).TcpTestSucceeded) { $ready = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) { throw "SQL Server is running but not accepting connections on localhost:$Port." }
  Log "SQL Server is up on localhost:$Port."

  # ---- 3. Database + least-privilege app login (Windows admin identity, no sa) -------------------
  $adminConn = "Server=localhost,$Port;Database=master;Integrated Security=SSPI;Encrypt=False;TrustServerCertificate=True;Connect Timeout=30"
  $edition = Invoke-Sql $adminConn "SELECT CONVERT(nvarchar(200), SERVERPROPERTY('Edition')) + N' ' + CONVERT(nvarchar(50), SERVERPROPERTY('ProductVersion'))" -Scalar
  Log "Connected as $([Security.Principal.WindowsIdentity]::GetCurrent().Name): $edition"

  # Re-running keeps the existing app password so .env and the login never drift apart.
  $appPassword = $null
  if (Test-Path $EnvFile) {
    $m = Select-String -Path $EnvFile -Pattern '^DB_PASSWORD=(.+)$' | Select-Object -First 1
    if ($m) { $appPassword = $m.Matches[0].Groups[1].Value.Trim() }
  }
  if (-not $appPassword) { $appPassword = New-RandomPassword }

  Invoke-Sql $adminConn "IF DB_ID(N'$DbName') IS NULL CREATE DATABASE [$DbName]"
  Log "Database ${DbName}: ready"
  Invoke-Sql $adminConn @"
IF SUSER_ID(N'$AppLogin') IS NULL
  CREATE LOGIN [$AppLogin] WITH PASSWORD = N'$appPassword', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF, DEFAULT_DATABASE = [$DbName]
ELSE
  ALTER LOGIN [$AppLogin] WITH PASSWORD = N'$appPassword', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF, DEFAULT_DATABASE = [$DbName]
"@
  Log "Login ${AppLogin}: ready"
  $dbConn = "Server=localhost,$Port;Database=$DbName;Integrated Security=SSPI;Encrypt=False;TrustServerCertificate=True;Connect Timeout=30"
  Invoke-Sql $dbConn "IF USER_ID(N'$AppLogin') IS NULL CREATE USER [$AppLogin] FOR LOGIN [$AppLogin]; ALTER ROLE db_owner ADD MEMBER [$AppLogin];"
  Log "User ${AppLogin}: db_owner on $DbName only"

  # Prove the app login works before touching .env.
  $appConn = "Server=localhost,$Port;Database=$DbName;User ID=$AppLogin;Password=$appPassword;Encrypt=False;TrustServerCertificate=True;Connect Timeout=30"
  $who = Invoke-Sql $appConn "SELECT SUSER_SNAME() + N' @ ' + DB_NAME()" -Scalar
  Log "Verified app login: $who"

  Set-EnvValues $EnvFile @{
    DB_SERVER = 'localhost'; DB_PORT = "$Port"; DB_NAME = $DbName; DB_USER = $AppLogin
    DB_PASSWORD = $appPassword; DB_ENCRYPT = 'false'; DB_TRUST_SERVER_CERTIFICATE = 'true'
  }
  Log '.env updated with DB_* settings (STORAGE_BACKEND untouched).'

  Log 'SETUP_COMPLETE'
  Write-Host ''
  Write-Host 'Done. You can close this window - SQL Server is installed and the database is ready.' -ForegroundColor Green
} catch {
  Log "SETUP_FAILED: $($_.Exception.Message)"
  Write-Host ''
  Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Details: $LogFile"
} finally {
  $appPassword = $null
  Write-Host ''
  Read-Host 'Press Enter to close'
}
