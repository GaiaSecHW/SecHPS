# PowerShell script to check jar file
$jarPath = "secexample-1.0.jar"

Write-Host "Checking jar file: $jarPath"

# Check if file exists
if (-not (Test-Path $jarPath)) {
    Write-Host "Error: File not found"
    exit 1
}

# Try to use 7z to list contents
try {
    $output = & 7z l $jarPath 2>&1 | Out-String
    Write-Host $output

    # Check for lib directory
    if ($output -match 'lib/') {
        Write-Host "`nThis is a fatJar format"
    } else {
        Write-Host "`nThis is not a fatJar format"
    }
} catch {
    Write-Host "Error using 7z: $_"
    Write-Host "Trying alternative method..."

    # Try using .NET ZipFile
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [System.IO.Compression.ZipFile]::OpenRead($jarPath)

        Write-Host "Total files: $($zip.Entries.Count)"

        # Find lib directory
        $libFiles = $zip.Entries | Where-Object { $_.FullName -like 'lib/*' }
        Write-Host "Files in lib/: $($libFiles.Count)"

        if ($libFiles.Count -gt 0) {
            Write-Host "`nFirst 20 files in lib/:"
            $libFiles | Select-Object -First 20 | ForEach-Object { Write-Host "  $($_.FullName)" }
            Write-Host "`nThis is a fatJar format"
        } else {
            Write-Host "`nThis is not a fatJar format"
        }

        $zip.Dispose()
    } catch {
        Write-Host "Error: $_"
    }
}
