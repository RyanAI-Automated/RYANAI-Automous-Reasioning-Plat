$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Push-Location $root

# Ensure Cargo binary directory is in user PATH for Tauri builds
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if ($env:Path -notlike "*$cargoBin*") {
    $env:Path = "$cargoBin;$env:Path"
}

try {
    Write-Host "=== 1. Preparing build dependencies ===" -ForegroundColor Cyan
    npm.cmd ci --legacy-peer-deps
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }

    cargo fetch --manifest-path src-tauri/Cargo.toml
    if ($LASTEXITCODE -ne 0) { throw "cargo fetch failed with exit code $LASTEXITCODE" }

    Write-Host "=== 2. Validating & building frontend & backend ===" -ForegroundColor Cyan
    
    # Validate the web and API projects separately before bundling the desktop app.
    npm.cmd run typecheck
    if ($LASTEXITCODE -ne 0) { throw "TypeScript validation failed with exit code $LASTEXITCODE" }

    npm.cmd run build:server
    if ($LASTEXITCODE -ne 0) { throw "API build failed with exit code $LASTEXITCODE" }

    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "Web build failed with exit code $LASTEXITCODE" }

    npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw "Tests failed with exit code $LASTEXITCODE" }

    Write-Host "=== 3. Building Tauri installers ===" -ForegroundColor Cyan
    npm.cmd run build:desktop
    if ($LASTEXITCODE -ne 0) { throw "Tauri installer build failed with exit code $LASTEXITCODE" }

    Write-Host "=== Build complete ===" -ForegroundColor Green
    Write-Host "Installers generated at: $root\src-tauri\target\release\bundle\" -ForegroundColor Yellow
}
catch {
    Write-Error "Build pipeline failed: $_"
    exit 1
}
finally {
    Pop-Location
}
