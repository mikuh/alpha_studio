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

function Initialize-MsvcBuildEnvironment {
    param([Parameter(Mandatory = $true)][string]$RustHost)

    $existingCompiler = Get-Command "cl.exe" -ErrorAction SilentlyContinue
    $existingResourceCompiler = Get-Command "rc.exe" -ErrorAction SilentlyContinue
    if ($null -ne $existingCompiler -and $null -ne $existingResourceCompiler) {
        Write-Host "MSVC: $($existingCompiler.Source)"
        Write-Host "Windows SDK: $($existingResourceCompiler.Source)"
        return
    }

    $rustTarget = $RustHost -replace "^host:\s*", ""
    if ($rustTarget -like "x86_64-*") {
        $targetArchitecture = "x64"
        $hostArchitecture = "x64"
        $toolsComponent = "Microsoft.VisualStudio.Component.VC.Tools.x86.x64"
    }
    elseif ($rustTarget -like "aarch64-*") {
        $targetArchitecture = "arm64"
        $hostArchitecture = "arm64"
        $toolsComponent = "Microsoft.VisualStudio.Component.VC.Tools.ARM64"
    }
    else {
        throw "Unsupported Rust host '$rustTarget'. Use an x86_64 or ARM64 Windows MSVC toolchain."
    }

    $visualStudioPath = $null
    $vswhere = Get-Command "vswhere.exe" -ErrorAction SilentlyContinue
    if ($null -eq $vswhere) {
        $vswhereCandidates = @(
            (Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"),
            (Join-Path $env:ProgramFiles "Microsoft Visual Studio\Installer\vswhere.exe")
        )
        $vswherePath = $vswhereCandidates |
            Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
            Select-Object -First 1
    }
    else {
        $vswherePath = $vswhere.Source
    }

    if (-not [string]::IsNullOrWhiteSpace($vswherePath)) {
        $visualStudioPath = @(
            & $vswherePath -latest -products * -requires $toolsComponent -property installationPath 2>$null
        ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1
    }

    # vswhere's instance catalog can be missing/corrupt while Build Tools remain on disk.
    if ([string]::IsNullOrWhiteSpace($visualStudioPath)) {
        $hostBin = if ($hostArchitecture -eq "arm64") { "Hostarm64" } else { "Hostx64" }
        $targetBin = $targetArchitecture
        $fallbackRoots = @(
            (Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\2022\BuildTools"),
            (Join-Path $env:ProgramFiles "Microsoft Visual Studio\2022\BuildTools"),
            (Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\2022\Community"),
            (Join-Path $env:ProgramFiles "Microsoft Visual Studio\2022\Community"),
            (Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\2022\Professional"),
            (Join-Path $env:ProgramFiles "Microsoft Visual Studio\2022\Professional"),
            (Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\2022\Enterprise"),
            (Join-Path $env:ProgramFiles "Microsoft Visual Studio\2022\Enterprise"),
            (Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\18\BuildTools"),
            (Join-Path $env:ProgramFiles "Microsoft Visual Studio\18\BuildTools")
        )

        foreach ($root in $fallbackRoots) {
            $devCmd = Join-Path $root "Common7\Tools\VsDevCmd.bat"
            $msvcRoot = Join-Path $root "VC\Tools\MSVC"
            if (-not (Test-Path -LiteralPath $devCmd -PathType Leaf)) {
                continue
            }
            if (-not (Test-Path -LiteralPath $msvcRoot -PathType Container)) {
                continue
            }

            $hasCompiler = Get-ChildItem -LiteralPath $msvcRoot -Directory -ErrorAction SilentlyContinue |
                ForEach-Object {
                    Join-Path $_.FullName "bin\$hostBin\$targetBin\cl.exe"
                } |
                Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
                Select-Object -First 1

            if ($null -ne $hasCompiler) {
                $visualStudioPath = $root
                Write-Host "MSVC: using fallback Visual Studio path (vswhere unavailable): $visualStudioPath"
                break
            }
        }
    }

    if ([string]::IsNullOrWhiteSpace($visualStudioPath)) {
        throw "The Visual Studio C++ toolchain is incomplete. In Visual Studio Installer, add 'Desktop development with C++', MSVC build tools, and a Windows 10/11 SDK."
    }

    $developerCommand = Join-Path $visualStudioPath "Common7\Tools\VsDevCmd.bat"
    if (-not (Test-Path -LiteralPath $developerCommand -PathType Leaf)) {
        throw "Visual Studio developer environment script is missing: $developerCommand"
    }

    $developerArguments = @(
        "/d",
        "/s",
        "/c",
        "`"$developerCommand`" -no_logo -arch=$targetArchitecture -host_arch=$hostArchitecture && set"
    )
    $developerEnvironment = @(& $env:ComSpec @developerArguments 2>&1)
    $developerExitCode = $LASTEXITCODE
    if ($developerExitCode -ne 0) {
        $details = ($developerEnvironment | ForEach-Object { "$_" }) -join [Environment]::NewLine
        throw "Failed to initialize the Visual Studio build environment.$([Environment]::NewLine)$details"
    }

    foreach ($line in $developerEnvironment) {
        if ("$line" -match "^([^=]+)=(.*)$") {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
        }
    }

    $compiler = Get-Command "cl.exe" -ErrorAction SilentlyContinue
    $linker = Get-Command "link.exe" -ErrorAction SilentlyContinue
    $resourceCompiler = Get-Command "rc.exe" -ErrorAction SilentlyContinue
    if ($null -eq $compiler -or $null -eq $linker -or $null -eq $resourceCompiler) {
        throw "MSVC or the Windows SDK is still unavailable after loading Visual Studio. Repair the 'Desktop development with C++' workload and ensure a Windows 10/11 SDK is selected."
    }

    Write-Host "MSVC: $($compiler.Source)"
    Write-Host "Windows SDK: $($resourceCompiler.Source)"
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
    Initialize-MsvcBuildEnvironment -RustHost "$rustHostLine"

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
