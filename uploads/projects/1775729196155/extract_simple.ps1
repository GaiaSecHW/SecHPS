# 简单的PowerShell脚本来解压jar文件
$jarPath = "secexample-1.0.jar"
$extractDir = "extracted"

Write-Host "Extracting jar file: $jarPath"

# 删除已存在的目录
if (Test-Path $extractDir) {
    Remove-Item -Path $extractDir -Recurse -Force
}

# 创建目录
New-Item -ItemType Directory -Path $extractDir | Out-Null

# 解压jar文件
Write-Host "Extracting to: $extractDir"
Expand-Archive -Path $jarPath -DestinationPath $extractDir -Force

Write-Host "Extraction completed"

# 检查lib目录
$libDir = Join-Path $extractDir "lib"
if (Test-Path $libDir) {
    Write-Host "`nlib directory found!"
    $libJars = Get-ChildItem -Path $libDir -Filter "*.jar"
    Write-Host "JAR files in lib/: $($libJars.Count)"

    if ($libJars.Count -gt 0) {
        Write-Host "`nJAR files in lib/:"
        $libJars | Select-Object -First 10 | ForEach-Object { Write-Host "  $($_.Name)" }
        if ($libJars.Count -gt 10) {
            Write-Host "  ... and $($libJars.Count - 10) more files"
        }
    }
} else {
    Write-Host "`nNo lib directory found"
}

# 显示主要目录
Write-Host "`nMain directories:"
Get-ChildItem -Path $extractDir -Directory | Select-Object -First 20 | ForEach-Object { Write-Host "  $($_.Name)/" }
