import zipfile
import os
import sys

jar_path = 'secexample-1.0.jar'

try:
    with zipfile.ZipFile(jar_path, 'r') as z:
        files = z.namelist()
        print(f"Total files: {len(files)}")

        # 查找lib目录
        lib_files = [f for f in files if f.startswith('lib/')]
        print(f"Files in lib/: {len(lib_files)}")

        if lib_files:
            print("\nFirst 20 files in lib/:")
            for f in lib_files[:20]:
                print(f"  {f}")

            print("\nThis is a fatJar format")
        else:
            print("\nNo lib/ directory found - not a fatJar")

        # 显示主要目录
        print("\nMain directories:")
        main_dirs = set()
        for f in files:
            parts = f.split('/')
            if len(parts) > 1:
                main_dirs.add(parts[0])

        for d in sorted(main_dirs):
            print(f"  {d}/")

except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
