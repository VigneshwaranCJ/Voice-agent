<#
Builds a self-contained folder for Windows IIS shared hosting (e.g. SmarterASP.NET):
backend + built dashboard + a private Python 3.12 runtime, started by HttpPlatformHandler.

    powershell -ExecutionPolicy Bypass -File infrastructure\iis\build-bundle.ps1

Output: deploy\kural-iis\ (upload its contents to the site root) and deploy\kural-iis.zip.
deploy\ is git-ignored because the bundle's .env holds secrets.
Re-running keeps an existing deploy\kural-iis\.env, so your filled-in settings survive rebuilds.
#>
param(
    # Folder of a 64-bit CPython 3.12 install to copy (default: what `py -V:3.12` runs).
    [string]$PythonHome = ""
)
$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$Out = Join-Path $Repo "deploy\kural-iis"
$Zip = Join-Path $Repo "deploy\kural-iis.zip"
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

if (-not $PythonHome) { $PythonHome = (& py -V:3.12 -c "import sys; print(sys.base_prefix)").Trim() }
if (-not (Test-Path "$PythonHome\python312.dll")) { throw "Not a CPython 3.12 folder: $PythonHome" }

# Keep a filled-in .env across rebuilds.
$SavedEnv = $null
if (Test-Path "$Out\.env") { $SavedEnv = Get-Content "$Out\.env" -Raw }
if (Test-Path $Out) { Remove-Item $Out -Recurse -Force -Confirm:$false }
New-Item -ItemType Directory -Force $Out | Out-Null

Write-Host "1/5 Python runtime from $PythonHome"
$Py = Join-Path $Out "python"
# Skip docs, headers, Tk/IDLE, the test suite and anything already installed into site-packages.
robocopy $PythonHome $Py /E /NFL /NDL /NJH /NJS /NP `
    /XD "$PythonHome\Doc" "$PythonHome\include" "$PythonHome\libs" "$PythonHome\tcl" `
        "$PythonHome\Lib\test" "$PythonHome\Lib\idlelib" "$PythonHome\Lib\tkinter" "$PythonHome\Lib\turtledemo" `
        "$PythonHome\Lib\site-packages" __pycache__ `
    /XF __install__.json pythonw.exe _tkinter.pyd tcl86t.dll tk86t.dll *.pdb | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }
# A ._pth file pins sys.path relative to python.exe, whatever IIS's working directory is.
# ".." is the site root, which holds serve.py and the app package.
Set-Content -Encoding ascii "$Py\python312._pth" "Lib`r`nDLLs`r`nLib\site-packages`r`n..`r`nimport site"

Write-Host "2/5 Backend dependencies"
$Req = Join-Path $env:TEMP "kural-iis-requirements.txt"
uv export --project "$Repo\backend" --frozen --no-dev --no-hashes --no-emit-project --quiet -o $Req
if ($LASTEXITCODE) { throw "uv export failed" }
uv pip install --quiet --target "$Py\Lib\site-packages" --python-version 3.12 --python-platform x86_64-pc-windows-msvc -r $Req
if ($LASTEXITCODE) { throw "uv pip install failed" }
# SQLAlchemy's optional Cython speedups are unsigned DLLs that Windows Application Control may block;
# SQLAlchemy falls back to identical pure-Python code without them.
Get-ChildItem "$Py\Lib\site-packages\sqlalchemy" -Recurse -Filter "*_cy.*.pyd" | Remove-Item -Force -Confirm:$false

Write-Host "3/5 Backend code"
robocopy "$Repo\backend\app" "$Out\app" /E /XD __pycache__ /NFL /NDL /NJH /NJS /NP | Out-Null
robocopy "$Repo\backend\migrations" "$Out\migrations" /E /XD __pycache__ /NFL /NDL /NJH /NJS /NP | Out-Null
Copy-Item "$Repo\backend\alembic.ini" $Out
Copy-Item "$PSScriptRoot\serve.py", "$PSScriptRoot\web.config", "$PSScriptRoot\web.ancm.config" $Out
New-Item -ItemType Directory -Force "$Out\App_Data\logs" | Out-Null

Write-Host "4/5 Dashboard"
npm --prefix "$Repo\frontend" run build --silent
if ($LASTEXITCODE) { throw "frontend build failed" }
robocopy "$Repo\frontend\dist" "$Out\static" /E /XF web.config /NFL /NDL /NJH /NJS /NP | Out-Null

Write-Host "5/5 Settings and zip"
if ($SavedEnv) {
    [IO.File]::WriteAllText("$Out\.env", $SavedEnv, $Utf8NoBom)
} else {
    $jwt = & "$Py\python.exe" -c "import secrets; print(secrets.token_urlsafe(48))"
    $fernet = & "$Py\python.exe" -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    $envText = (Get-Content "$PSScriptRoot\env.template" -Raw) `
        -replace "JWT_SECRET=__GENERATED__", "JWT_SECRET=$jwt" `
        -replace "ENCRYPTION_KEY=__GENERATED__", "ENCRYPTION_KEY=$fernet"
    [IO.File]::WriteAllText("$Out\.env", $envText, $Utf8NoBom)
}
Get-ChildItem $Out -Recurse -Directory -Filter __pycache__ | Remove-Item -Recurse -Force -Confirm:$false
if (Test-Path $Zip) { Remove-Item $Zip -Force -Confirm:$false }
Compress-Archive -Path "$Out\*" -DestinationPath $Zip -CompressionLevel Optimal

$mb = [math]::Round((Get-Item $Zip).Length / 1MB, 1)
Write-Host "Done: $Out"
Write-Host "      $Zip ($mb MB)"
Write-Host "Before uploading, fill SARVAM_API_KEY and BOOTSTRAP_ADMIN_* in $Out\.env, then rebuild the zip (re-run this script)."
exit 0
