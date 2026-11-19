<#
Builds the deploy folder for Zoho Catalyst AppSail (Catalyst-managed Python 3.12 runtime):
backend + built dashboard + all dependencies vendored as Linux (x86-64) wheels. No Docker needed.

    powershell -ExecutionPolicy Bypass -File infrastructure\catalyst\build-catalyst.ps1

Output:
  deploy\catalyst-app\        the AppSail build path (point the Catalyst CLI at this folder)
  deploy\catalyst-env.txt     environment variables to paste into AppSail (generated secrets; keep private)
deploy\ is git-ignored. Re-running keeps deploy\catalyst-env.txt so your secrets stay the same.
#>
$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$Out = Join-Path $Repo "deploy\catalyst-app"
$EnvFile = Join-Path $Repo "deploy\catalyst-env.txt"
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

if (Test-Path $Out) { Remove-Item $Out -Recurse -Force -Confirm:$false }
New-Item -ItemType Directory -Force $Out | Out-Null

Write-Host "1/4 Dependencies (Linux x86-64, Python 3.12)"
$Req = Join-Path $env:TEMP "kural-catalyst-requirements.txt"
uv export --project "$Repo\backend" --frozen --no-dev --no-hashes --no-emit-project --quiet -o $Req
if ($LASTEXITCODE) { throw "uv export failed" }
uv pip install --quiet --target "$Out\vendor" --python-version 3.12 --python-platform x86_64-manylinux_2_28 -r $Req
if ($LASTEXITCODE) { throw "uv pip install failed" }

Write-Host "2/4 Backend code"
robocopy "$Repo\backend\app" "$Out\app" /E /XD __pycache__ /NFL /NDL /NJH /NJS /NP | Out-Null
robocopy "$Repo\backend\migrations" "$Out\migrations" /E /XD __pycache__ /NFL /NDL /NJH /NJS /NP | Out-Null
Copy-Item "$Repo\backend\alembic.ini", "$PSScriptRoot\catalyst_serve.py" $Out

Write-Host "3/4 Dashboard"
npm --prefix "$Repo\frontend" run build --silent
if ($LASTEXITCODE) { throw "frontend build failed" }
robocopy "$Repo\frontend\dist" "$Out\static" /E /XF web.config /NFL /NDL /NJH /NJS /NP | Out-Null

Write-Host "4/4 Settings"
if (-not (Test-Path $EnvFile)) {
    $py = { param($code) (& uv run --project "$Repo\backend" python -c $code).Trim() }
    $jwt = & $py "import secrets; print(secrets.token_urlsafe(48))"
    $fernet = & $py "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    $text = (Get-Content "$PSScriptRoot\env.template" -Raw) `
        -replace "JWT_SECRET=__GENERATED__", "JWT_SECRET=$jwt" `
        -replace "ENCRYPTION_KEY=__GENERATED__", "ENCRYPTION_KEY=$fernet"
    [IO.File]::WriteAllText($EnvFile, $text, $Utf8NoBom)
}
Get-ChildItem $Out -Recurse -Directory -Filter __pycache__ | Remove-Item -Recurse -Force -Confirm:$false
Remove-Item "$Out\vendor\bin", "$Out\vendor\include" -Recurse -Force -Confirm:$false -ErrorAction SilentlyContinue

# Precompile for Python 3.12. AppSail must be listening within 10 s of starting; compiling thousands of modules on
# every cold start takes longer than that. "unchecked-hash" .pyc files stay valid after upload changes file times.
Write-Host "Precompiling Python files"
uv run --project "$Repo\backend" python -m compileall -q -j 0 --invalidation-mode unchecked-hash "$Out" | Out-Null
if ($LASTEXITCODE) { throw "compileall failed" }

$mb = [math]::Round(((Get-ChildItem $Out -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 1)
Write-Host "Done: $Out ($mb MB)"
Write-Host "Settings to paste into AppSail: $EnvFile"
exit 0
