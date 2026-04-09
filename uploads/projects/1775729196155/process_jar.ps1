$ErrorActionPreference = "Continue"

# 创建Shell Application对象
$shell = New-Object -ComObject Shell.Application

# 获取jar文件
$jarFile = Get-Item "secexample-1.0.jar"
$jarPath = $jarFile.FullName

Write-Host "Processing jar file: $jarPath"

# 创建zip文件夹对象
$zipFolder = $shell.NameSpace($jarPath)

if ($zipFolder -eq $null) {
    Write-Host "Error: Cannot open jar file"
    exit 1
}

$items = $zipFolder.Items()
Write-Host "Total items: $($items.Count)"

# 查找lib目录
$libItems = $items | Where-Object { $_.Name -eq "lib" }

if ($libItems) {
    Write-Host "Found lib directory"
    $libFolder = $libItems.GetFolder
    $libItems = $libFolder.Items()
    Write-Host "Files in lib/: $($libItems.Count)"

    Write-Host "`nFirst 20 files in lib/:"
    for ($i = 0; $i -lt [Math]::Min(20, $libItems.Count); $i++) {
        Write-Host "  $($libItems.Item($i).Name)"
    }

    Write-Host "`nThis is a fatJar format"

    # 解压jar文件
    $extractDir = "extracted"
    if (Test-Path $extractDir) {
        Remove-Item -Path $extractDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $extractDir | Out-Null

    Write-Host "`nExtracting jar file to $extractDir..."
    $destFolder = $shell.NameSpace((Get-Item $extractDir).FullName)
    $destFolder.CopyHere($zipFolder.Items(), 16)

    Write-Host "Extraction completed"

    # 检查lib目录
    $libDir = Join-Path $extractDir "lib"
    if (Test-Path $libDir) {
        Write-Host "`nlib directory exists: $libDir"
        $libJars = Get-ChildItem -Path $libDir -Filter "*.jar"
        Write-Host "JAR files in lib/: $($libJars.Count)"

        if ($libJars.Count -gt 0) {
            Write-Host "`nJAR files in lib/:"
            $libJars | Select-Object -First 10 | ForEach-Object { Write-Host "  $($_.Name)" }
            if ($libJars.Count -gt 10) {
                Write-Host "  ... and $($libJars.Count - 10) more files"
            }

            # 解压lib目录中的jar文件
            $libExtractDir = Join-Path $extractDir "lib_extracted"
            New-Item -ItemType Directory -Path $libExtractDir | Out-Null

            Write-Host "`nExtracting JAR files from lib to $libExtractDir..."
            $successCount = 0

            for ($i = 0; $i -lt $libJars.Count; $i++) {
                $jar = $libJars[$i]
                $jarExtractDir = Join-Path $libExtractDir ($jar.Name -replace '\.jar$', '')
                New-Item -ItemType Directory -Path $jarExtractDir | Out-Null

                try {
                    $jarZipFolder = $shell.NameSpace($jar.FullName)
                    $jarDestFolder = $shell.NameSpace((Get-Item $jarExtractDir).FullName)
                    $jarDestFolder.CopyHere($jarZipFolder.Items(), 16)
                    $successCount++
                } catch {
                    Write-Host "  Failed to extract $($jar.Name): $_"
                }

                if (($i + 1) % 10 -eq 0 -or $i -eq $libJars.Count - 1) {
                    Write-Host "  Extracted $($i + 1)/$($libJars.Count) JAR files"
                }
            }

            Write-Host "`nSuccessfully extracted $successCount/$($libJars.Count) lib JAR files"
        } else {
            Write-Host "`nNo JAR files found in lib directory"
        }
    } else {
        Write-Host "`nlib directory does not exist"
    }
} else {
    Write-Host "No lib directory found - not a fatJar format"
}

# 显示主要目录结构
Write-Host "`nMain directories:"
$mainDirs = @()
foreach ($item in $items) {
    if ($item.IsFolder) {
        $mainDirs += $item.Name
    }
}
$mainDirs | Sort-Object | ForEach-Object { Write-Host "  $_/" }

# 释放COM对象
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($shell) | Out-Null
