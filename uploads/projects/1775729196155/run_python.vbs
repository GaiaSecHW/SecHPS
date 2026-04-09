Set objShell = CreateObject("WScript.Shell")
objShell.CurrentDirectory = "D:\claude-web-platform\uploads\projects\1775729196155"
objShell.Run "python simple_check.py > output.txt", 1, True
