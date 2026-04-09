@echo off
cd /d "%~dp0"
echo Extracting jar file...
powershell -Command "Expand-Archive -Path 'secexample-1.0.jar' -DestinationPath 'extracted' -Force"
echo Extraction completed
echo.
echo Checking for lib directory...
if exist "extracted\lib" (
    echo lib directory found!
    dir /b "extracted\lib\*.jar" | find /c ".jar" > temp.txt
    set /p count=<temp<.txt
    echo Number of JAR files in lib: %count%
    del temp.txt
    echo.
    echo First 10 JAR files in lib:
    dir /b "extracted\lib\*.jar" | more /e +0
) else (
    echo No lib directory found
)
echo.
echo Main directories:
dir /b /ad "extracted" | more /e +0
