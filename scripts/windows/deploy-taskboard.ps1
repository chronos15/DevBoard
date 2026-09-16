param(
    [string]$DeployRoot = $(if ($env:TASKBOARD_DEPLOY_ROOT) { $env:TASKBOARD_DEPLOY_ROOT } else { "C:\TaskBoard" }),
    [string]$ServiceName = $(if ($env:TASKBOARD_SERVICE_NAME) { $env:TASKBOARD_SERVICE_NAME } else { "TaskBoard" }),
    [int]$Port = $(if ($env:TASKBOARD_PORT) { [int]$env:TASKBOARD_PORT } else { 3000 }),
    [string]$NssmPath = $(if ($env:TASKBOARD_NSSM_PATH) { $env:TASKBOARD_NSSM_PATH } else { "C:\Tools\nssm\nssm.exe" }),
    [int]$KeepReleases = 3
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Assert-LastExit([string]$Label) {
    if ($LASTEXITCODE -ne 0) {
        throw "$Label falhou com exit code $LASTEXITCODE."
    }
}

function Test-TaskBoardHealth([int]$Attempts = 12, [int]$DelaySeconds = 5) {
    $uri = "http://127.0.0.1:$Port/login"

    for ($i = 1; $i -le $Attempts; $i++) {
        try {
            $response = Invoke-WebRequest -Uri $uri -TimeoutSec 10 -UseBasicParsing
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                Write-Host "Health check OK: HTTP $($response.StatusCode)"
                return $true
            }
        }
        catch {
            Write-Host "Health check $i/$Attempts ainda indisponivel: $($_.Exception.Message)"
        }

        Start-Sleep -Seconds $DelaySeconds
    }

    return $false
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ConfigDir = Join-Path $DeployRoot "config"
$ReleasesDir = Join-Path $DeployRoot "releases"
$LogsDir = Join-Path $DeployRoot "logs"
$EnvSource = Join-Path $ConfigDir ".env.production.local"
$EnvBuild = Join-Path $RepoRoot ".env.production.local"

Write-Step "Validando ambiente de deploy"

if (-not (Test-Path $EnvSource)) {
    throw @"
Arquivo de producao nao encontrado:
$EnvSource

Crie-o antes do primeiro deploy. Voce pode exportar da Vercel com:
  vercel env pull .env.production.local --environment=production

Depois ajuste NEXT_PUBLIC_APP_URL para o dominio HTTPS do servidor fisico
e copie o arquivo para:
  $EnvSource
"@
}

if (-not (Test-Path $NssmPath)) {
    throw "NSSM nao encontrado em '$NssmPath'. Defina TASKBOARD_NSSM_PATH ou instale o NSSM nesse caminho."
}

$NodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$NpmCmd = (Get-Command npm.cmd -ErrorAction Stop).Source

New-Item -ItemType Directory -Force -Path $ConfigDir, $ReleasesDir, $LogsDir | Out-Null

Write-Step "Preparando variaveis de ambiente para a build"
Copy-Item $EnvSource $EnvBuild -Force

try {
    Push-Location $RepoRoot

    Write-Step "Instalando dependencias"
    if (Test-Path (Join-Path $RepoRoot "package-lock.json")) {
        & $NpmCmd ci --no-audit --no-fund
        Assert-LastExit "npm ci"
    }
    else {
        Write-Warning "package-lock.json nao existe. Usando npm install. Gere e versione o lockfile para builds reproduziveis."
        & $NpmCmd install --no-audit --no-fund
        Assert-LastExit "npm install"
    }

    Write-Step "Compilando TaskBoard"
    & $NpmCmd run build
    Assert-LastExit "npm run build"
}
finally {
    Pop-Location
    Remove-Item $EnvBuild -Force -ErrorAction SilentlyContinue
}

$ReleaseId = if ($env:GITHUB_SHA) {
    $env:GITHUB_SHA.Substring(0, [Math]::Min(12, $env:GITHUB_SHA.Length))
}
else {
    Get-Date -Format "yyyyMMdd-HHmmss"
}

$ReleasePath = Join-Path $ReleasesDir $ReleaseId

Write-Step "Criando release $ReleaseId"
if (Test-Path $ReleasePath) {
    Remove-Item $ReleasePath -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $ReleasePath | Out-Null

$RoboArgs = @(
    $RepoRoot,
    $ReleasePath,
    "/MIR",
    "/R:2",
    "/W:2",
    "/NFL",
    "/NDL",
    "/NJH",
    "/NJS",
    "/NP",
    "/XD",
    (Join-Path $RepoRoot ".git"),
    (Join-Path $RepoRoot ".github"),
    (Join-Path $RepoRoot ".next\cache")
)

& robocopy @RoboArgs | Out-Host
if ($LASTEXITCODE -ge 8) {
    throw "robocopy falhou com exit code $LASTEXITCODE."
}

Copy-Item $EnvSource (Join-Path $ReleasePath ".env.production.local") -Force

$ExistingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
$PreviousDirectory = $null

if ($ExistingService) {
    $PreviousDirectory = ((& $NssmPath get $ServiceName AppDirectory) | Out-String).Trim()
}

try {
    if (-not $ExistingService) {
        Write-Step "Instalando servico Windows '$ServiceName'"

        & $NssmPath install $ServiceName $NodeExe "node_modules\next\dist\bin\next start -H 127.0.0.1 -p $Port" | Out-Host
        Assert-LastExit "nssm install"

        & $NssmPath set $ServiceName AppDirectory $ReleasePath | Out-Host
        Assert-LastExit "nssm AppDirectory"

        & $NssmPath set $ServiceName AppEnvironmentExtra "NODE_ENV=production" | Out-Host
        Assert-LastExit "nssm AppEnvironmentExtra"

        & $NssmPath set $ServiceName Start SERVICE_AUTO_START | Out-Host
        Assert-LastExit "nssm Start"

        & $NssmPath set $ServiceName AppStdout (Join-Path $LogsDir "taskboard-out.log") | Out-Host
        & $NssmPath set $ServiceName AppStderr (Join-Path $LogsDir "taskboard-error.log") | Out-Host
        & $NssmPath set $ServiceName AppRotateFiles 1 | Out-Host
        & $NssmPath set $ServiceName AppRotateOnline 1 | Out-Host
        & $NssmPath set $ServiceName AppRotateBytes 10485760 | Out-Host

        & $NssmPath start $ServiceName | Out-Host
        Assert-LastExit "nssm start"
    }
    else {
        Write-Step "Ativando nova release"
        & $NssmPath set $ServiceName AppDirectory $ReleasePath | Out-Host
        Assert-LastExit "nssm AppDirectory"

        & $NssmPath restart $ServiceName | Out-Host
        Assert-LastExit "nssm restart"
    }

    Write-Step "Validando aplicacao"
    if (-not (Test-TaskBoardHealth)) {
        throw "A nova release nao respondeu ao health check."
    }
}
catch {
    Write-Error $_

    if ($PreviousDirectory -and (Test-Path $PreviousDirectory)) {
        Write-Warning "Executando rollback para: $PreviousDirectory"
        & $NssmPath set $ServiceName AppDirectory $PreviousDirectory | Out-Host
        & $NssmPath restart $ServiceName | Out-Host
        Start-Sleep -Seconds 3

        if (Test-TaskBoardHealth -Attempts 6 -DelaySeconds 5) {
            Write-Host "Rollback concluido com sucesso." -ForegroundColor Yellow
        }
        else {
            Write-Error "Rollback executado, mas o servico ainda nao respondeu."
        }
    }

    throw
}

Set-Content -Path (Join-Path $DeployRoot "current-release.txt") -Value $ReleasePath -Encoding UTF8

Write-Step "Limpando releases antigas"
$CurrentFullPath = (Resolve-Path $ReleasePath).Path
$Protected = @($CurrentFullPath)

if ($PreviousDirectory -and (Test-Path $PreviousDirectory)) {
    $Protected += (Resolve-Path $PreviousDirectory).Path
}

$OldReleases = Get-ChildItem $ReleasesDir -Directory |
    Sort-Object LastWriteTime -Descending |
    Where-Object { $Protected -notcontains $_.FullName } |
    Select-Object -Skip ([Math]::Max(0, $KeepReleases - $Protected.Count))

foreach ($Old in $OldReleases) {
    try {
        Remove-Item $Old.FullName -Recurse -Force
        Write-Host "Removida release antiga: $($Old.Name)"
    }
    catch {
        Write-Warning "Nao foi possivel remover '$($Old.FullName)': $($_.Exception.Message)"
    }
}

Write-Host ""
Write-Host "Deploy concluido: $ReleasePath" -ForegroundColor Green
