# Минимальный статический сервер для локальной проверки игры.
# Ничего не требует, кроме самого Windows PowerShell.
param(
  [int]$Port = 8412,
  [string]$Root = $PSScriptRoot
)

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.ico'  = 'image/x-icon'
  '.webp' = 'image/webp'
  '.mp3'  = 'audio/mpeg'
}

$rootFull = [System.IO.Path]::GetFullPath($Root)

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "deepcore served at http://localhost:$Port/ from $rootFull"

while ($listener.IsListening) {
  $ctx = $null
  try {
    $ctx = $listener.GetContext()
  } catch {
    Write-Host "accept error: $($_.Exception.Message)"
    continue
  }

  try {
    $rawPath = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)

    # POST /shot?name=foo.png — сохранить кадр канваса на диск.
    # Нужно для съёмки промо-скриншотов и для проверки картинки без глазного
    # контакта с экраном: игра сама отдаёт кадр, сервер кладёт его в shots/.
    if ($ctx.Request.HttpMethod -eq 'POST' -and $rawPath -eq '/shot') {
      $name = $ctx.Request.QueryString['name']
      if (-not $name) { $name = 'shot.png' }
      $name = [System.IO.Path]::GetFileName($name)
      $dir = Join-Path $rootFull 'shots'
      if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
      $ms = New-Object System.IO.MemoryStream
      $ctx.Request.InputStream.CopyTo($ms)
      [System.IO.File]::WriteAllBytes((Join-Path $dir $name), $ms.ToArray())
      $ok = [System.Text.Encoding]::UTF8.GetBytes('saved ' + $name)
      $ctx.Response.StatusCode = 200
      $ctx.Response.ContentType = 'text/plain; charset=utf-8'
      $ctx.Response.ContentLength64 = $ok.Length
      $ctx.Response.OutputStream.Write($ok, 0, $ok.Length)
      Write-Host "200 POST /shot -> shots\$name ($($ms.Length) bytes)"
      $ctx.Response.OutputStream.Close(); $ctx.Response.Close()
      continue
    }

    if ($rawPath -eq '/') { $rawPath = '/index.html' }
    $candidate = Join-Path $rootFull ($rawPath.TrimStart('/') -replace '/', '\')

    $resolved = $null
    try { $resolved = [System.IO.Path]::GetFullPath($candidate) } catch { $resolved = $null }

    $res = $ctx.Response
    $res.Headers['Cache-Control'] = 'no-store'

    if ($resolved -and $resolved.StartsWith($rootFull) -and (Test-Path -LiteralPath $resolved -PathType Leaf)) {
      $ext = [System.IO.Path]::GetExtension($resolved).ToLower()
      $type = $mime[$ext]
      if (-not $type) { $type = 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($resolved)
      $res.ContentType = $type
      $res.StatusCode = 200
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      Write-Host "200 $rawPath"
    } else {
      $body = [System.Text.Encoding]::UTF8.GetBytes('404 not found')
      $res.StatusCode = 404
      $res.ContentType = 'text/plain; charset=utf-8'
      $res.ContentLength64 = $body.Length
      $res.OutputStream.Write($body, 0, $body.Length)
      Write-Host "404 $rawPath"
    }
  } catch {
    Write-Host "request error: $($_.Exception.Message)"
  } finally {
    try { $ctx.Response.OutputStream.Close() } catch {}
    try { $ctx.Response.Close() } catch {}
  }
}
