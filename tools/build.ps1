# Сборка архива для загрузки в Консоль разработчика Яндекс Игр.
#
# Compress-Archive из Windows PowerShell использовать НЕЛЬЗЯ: он пишет в имена
# записей виндовые обратные слеши. На Windows такой архив распаковывается
# нормально, поэтому локально проблема не видна, а на серверах платформы
# (Linux) файлы появляются с буквальными именами вида "js\sdk.js" — папок нет,
# index.html не находит ни один скрипт, и автопроверка справедливо сообщает,
# что SDK в игру не встроен.
#
# Поэтому архив собирается вручную через ZipArchive с явными прямыми слешами.
param(
  [string]$Version = '1.0.0.3',
  [string]$Root = (Split-Path $PSScriptRoot -Parent)
)

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$outDir = Join-Path $Root 'shots'
if (-not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }
$zipPath = Join-Path $outDir "deepcore-$Version.zip"

# В сборку идёт только сама игра. tools/ и shots/ класть нельзя: платформа
# считает вес распакованным, а рабочий материал к игре отношения не имеет.
$files = New-Object System.Collections.ArrayList
[void]$files.Add(@{ src = Join-Path $Root 'index.html';    name = 'index.html' })
[void]$files.Add(@{ src = Join-Path $Root 'css\style.css'; name = 'css/style.css' })
Get-ChildItem (Join-Path $Root 'js') -File -Filter '*.js' | Sort-Object Name | ForEach-Object {
  [void]$files.Add(@{ src = $_.FullName; name = 'js/' + $_.Name })
}

foreach ($f in $files) {
  if (-not (Test-Path -LiteralPath $f.src)) { throw "Нет файла: $($f.src)" }
}

$fs = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::Create)
$ar = New-Object System.IO.Compression.ZipArchive($fs, 1)   # 1 = Create
try {
  foreach ($f in $files) {
    $entry = $ar.CreateEntry($f.name, [System.IO.Compression.CompressionLevel]::Optimal)
    $stream = $entry.Open()
    $bytes = [System.IO.File]::ReadAllBytes($f.src)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()
  }
} finally {
  $ar.Dispose(); $fs.Close()
}

# Проверяем то, ради чего скрипт и написан
$check = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$backslash = [string][char]92
$bad = @($check.Entries | Where-Object { $_.FullName.Contains($backslash) })
$hasIndex = @($check.Entries | Where-Object { $_.FullName -eq 'index.html' }).Count -gt 0
$hasSdk   = @($check.Entries | Where-Object { $_.FullName -eq 'js/sdk.js' }).Count -gt 0
$unpacked = ($check.Entries | Measure-Object -Property Length -Sum).Sum
$names = $check.Entries | ForEach-Object { $_.FullName }
$check.Dispose()

Write-Host ''
Write-Host "Архив: $zipPath"
Write-Host ("  сжатый        {0} KB" -f [math]::Round((Get-Item -LiteralPath $zipPath).Length / 1KB, 1))
Write-Host ("  распакованный {0} KB (лимит платформы 100 МБ)" -f [math]::Round($unpacked / 1KB, 1))
Write-Host ''
$names | ForEach-Object { Write-Host "  $_" }
Write-Host ''

$ok = $true
if ($bad.Count -gt 0) { Write-Host "  ОШИБКА: виндовые слеши в $($bad.Count) записях" -ForegroundColor Red; $ok = $false }
else { Write-Host '  прямые слеши в путях: да' -ForegroundColor Green }
if ($hasIndex) { Write-Host '  index.html в корне: да' -ForegroundColor Green } else { Write-Host '  ОШИБКА: нет index.html в корне' -ForegroundColor Red; $ok = $false }
if ($hasSdk)   { Write-Host '  js/sdk.js на месте: да' -ForegroundColor Green } else { Write-Host '  ОШИБКА: нет js/sdk.js' -ForegroundColor Red; $ok = $false }

$html = Get-Content (Join-Path $Root 'index.html') -Raw
if ($html -match 'yandex\.ru/games/sdk/v2') { Write-Host '  тег SDK в index.html: да' -ForegroundColor Green }
else { Write-Host '  ОШИБКА: в index.html нет тега SDK' -ForegroundColor Red; $ok = $false }

Write-Host ''
if ($ok) { Write-Host 'Готово к загрузке в консоль.' -ForegroundColor Green }
else     { Write-Host 'Собран с ошибками — не загружай.' -ForegroundColor Red; exit 1 }
