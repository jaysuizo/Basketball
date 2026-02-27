param(
  [int]$Port = 5500
)

$ErrorActionPreference = "Stop"

$port = $Port
$root = Get-Location

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Prefixes.Add("http://127.0.0.1:$port/")
try {
  $listener.Start()
}
catch {
  Write-Host "Port $port is already in use or reserved. Try another port, e.g. 5501." -ForegroundColor Yellow
  throw
}

Write-Host "Serving $root at http://localhost:$port/ (Ctrl+C to stop)"

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $path = $ctx.Request.Url.AbsolutePath.TrimStart("/")
    if ([string]::IsNullOrWhiteSpace($path)) {
      $path = "index.html"
    }

    $safePath = $path -replace "/", "\"
    $file = Join-Path $root $safePath

    if ((Test-Path $file) -and -not (Get-Item $file).PSIsContainer) {
      $ext = [System.IO.Path]::GetExtension($file).ToLowerInvariant()
      switch ($ext) {
        ".html" { $ctx.Response.ContentType = "text/html; charset=utf-8" }
        ".css"  { $ctx.Response.ContentType = "text/css; charset=utf-8" }
        ".js"   { $ctx.Response.ContentType = "application/javascript; charset=utf-8" }
        ".json" { $ctx.Response.ContentType = "application/json; charset=utf-8" }
        ".png"  { $ctx.Response.ContentType = "image/png" }
        ".jpg"  { $ctx.Response.ContentType = "image/jpeg" }
        ".jpeg" { $ctx.Response.ContentType = "image/jpeg" }
        ".svg"  { $ctx.Response.ContentType = "image/svg+xml" }
        ".ico"  { $ctx.Response.ContentType = "image/x-icon" }
        default { $ctx.Response.ContentType = "application/octet-stream" }
      }

      $bytes = [System.IO.File]::ReadAllBytes($file)
      $ctx.Response.StatusCode = 200
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $msg = [Text.Encoding]::UTF8.GetBytes("404 Not Found")
      $ctx.Response.StatusCode = 404
      $ctx.Response.ContentType = "text/plain; charset=utf-8"
      $ctx.Response.ContentLength64 = $msg.Length
      $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
    }

    $ctx.Response.Close()
  }
}
finally {
  if ($listener.IsListening) {
    $listener.Stop()
  }
  $listener.Close()
}
