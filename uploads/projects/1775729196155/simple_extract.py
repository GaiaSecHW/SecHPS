import zipfile
import os

jar_path = 'secexample-1.0.jar'

print("Checking jar file...")

try:
    with zipfile.ZipFile(jar_path, 'r') as z:
        files = z.namelist()
        print(f"Total files: {len(files)}")

        # 查找lib目录
        lib_files = [f for f in files if f.startswith('lib/')]
        print(f"Files in lib/: {len(lib_files)}")

        if lib_files:
            print("\nThis is a fatJar format")
            print("\nFirst 20 files in lib/:")
            for f in lib_files[:20]:
                print(f"  {f}")
        else:
            print("\nNot a fatJar format")

except Exception as e:
    print(f"Error: {e}")
