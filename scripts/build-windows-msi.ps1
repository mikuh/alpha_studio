[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [switch]$OpenOutput
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Assert-LastExitCode {
    param([Parameter(Mandatory = $true)][string]$Step)

    if ($LASTEXITCODE -ne 0) {
        throw "$Step failed with exit code $LASTEXITCODE."
    }
}

function Find-CommandPath {
    param(
        [Parameter(Mandatory = $true)][string[]]$Names,
        [Parameter(Mandatory = $true)][string]$InstallHint
    )

    foreach ($name in $Names) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($null -ne $command) {
            return $command.Source
        }
    }

    throw "Missing required command '$($Names[0])'. $InstallHint"
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw "MSI packages must be built on Windows. Run build-windows-msi.cmd on a Windows 10/11 machine."
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$packageJsonPath = Join-Path $repositoryRoot "package.json"
$tauriConfigPath = Join-Path $repositoryRoot "src-tauri\tauri.conf.json"

if (-not (Test-Path -LiteralPath $packageJsonPath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $tauriConfigPath -PathType Leaf)) {
    throw "Could not find the Alpha Studio project files under '$repositoryRoot'."
}

$npm = Find-CommandPath -Names @("npm.cmd", "npm") -InstallHint "Install the current Node.js LTS release, then reopen this terminal."
$null = Find-CommandPath -Names @("cargo.exe", "cargo") -InstallHint "Install Rust from https://rustup.rs/ using the default MSVC toolchain."
$rustc = Find-CommandPath -Names @("rustc.exe", "rustc") -InstallHint "Install Rust from https://rustup.rs/ using the default MSVC toolchain."

Push-Location $repositoryRoot
try {
    Write-Host ""
    Write-Host "Alpha Studio Windows MSI build" -ForegroundColor Cyan
    Write-Host "Project: $repositoryRoot"

    $rustVersionOutput = @(& $rustc -vV 2>&1)
    $rustExitCode = $LASTEXITCODE
    if ($rustExitCode -ne 0) {
        $rustDetails = ($rustVersionOutput | ForEach-Object { "$_" }) -join [Environment]::NewLine
        if ([string]::IsNullOrWhiteSpace($rustDetails)) {
            $rustDetails = "rustc returned no diagnostic output."
        }
        throw "Reading the Rust toolchain failed with exit code $rustExitCode.$([Environment]::NewLine)$rustDetails"
    }

    $rustHostLine = $rustVersionOutput |
        Where-Object { "$_" -like "host:*" } |
        Select-Object -First 1
    if ($null -eq $rustHostLine -or $rustHostLine -notmatch "pc-windows-msvc") {
        throw "The active Rust toolchain is not the Windows MSVC toolchain. Run 'rustup default stable-x86_64-pc-windows-msvc' and try again."
    }
    Write-Host "Rust: $rustHostLine"

    if (-not $SkipInstall) {
        Write-Host ""
        Write-Host "[1/2] Installing locked Node.js dependencies..." -ForegroundColor Yellow
        & $npm ci
        Assert-LastExitCode "npm ci"
    }
    else {
        Write-Host ""
        Write-Host "[1/2] Skipping dependency installation (-SkipInstall)." -ForegroundColor DarkYellow
    }

    Write-Host ""
    Write-Host "[2/2] Building the release MSI..." -ForegroundColor Yellow
    $buildStartedAt = Get-Date
    & $npm run tauri:build:msi
    Assert-LastExitCode "Tauri MSI build"

    $targetRoots = [System.Collections.Generic.List[string]]::new()
    $targetRoots.Add((Join-Path $repositoryRoot "src-tauri\target"))
    $targetRoots.Add((Join-Path $repositoryRoot "target"))

    if (-not [string]::IsNullOrWhiteSpace($env:CARGO_TARGET_DIR)) {
        if ([System.IO.Path]::IsPathRooted($env:CARGO_TARGET_DIR)) {
            $targetRoots.Add($env:CARGO_TARGET_DIR)
        }
        else {
            $targetRoots.Add((Join-Path $repositoryRoot $env:CARGO_TARGET_DIR))
            $targetRoots.Add((Join-Path (Join-Path $repositoryRoot "src-tauri") $env:CARGO_TARGET_DIR))
        }
    }

    $msiFiles = foreach ($targetRoot in $targetRoots | Select-Object -Unique) {
        if (Test-Path -LiteralPath $targetRoot -PathType Container) {
            Get-ChildItem -LiteralPath $targetRoot -Filter "*.msi" -File -Recurse |
                Where-Object {
                    $_.FullName -match "[\\/]release[\\/]bundle[\\/]msi[\\/]" -and
                    $_.LastWriteTime -ge $buildStartedAt.AddMinutes(-1)
                }
        }
    }

    $msiFiles = @(
        $msiFiles |
            Sort-Object FullName -Unique |
            Sort-Object LastWriteTime -Descending
    )
    if ($msiFiles.Count -eq 0) {
        throw "The Tauri build succeeded, but no MSI was found under a Cargo target directory."
    }

    $outputDirectory = Join-Path $repositoryRoot "artifacts\releases\windows"
    $null = New-Item -ItemType Directory -Path $outputDirectory -Force
    $publishedFiles = [System.Collections.Generic.List[System.IO.FileInfo]]::new()

    foreach ($msiFile in $msiFiles) {
        $destination = Join-Path $outputDirectory $msiFile.Name
        Copy-Item -LiteralPath $msiFile.FullName -Destination $destination -Force
        $publishedFiles.Add((Get-Item -LiteralPath $destination))
    }

    Write-Host ""
    Write-Host "MSI build completed successfully." -ForegroundColor Green
    foreach ($publishedFile in $publishedFiles) {
        $hash = (Get-FileHash -LiteralPath $publishedFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        Write-Host "Installer: $($publishedFile.FullName)"
        Write-Host "SHA-256:  $hash"
    }

    if ($OpenOutput) {
        Start-Process explorer.exe -ArgumentList $outputDirectory
    }
}
finally {
    Pop-Location
}
