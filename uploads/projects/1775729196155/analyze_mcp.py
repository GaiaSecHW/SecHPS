import zipfile
import os
import sys

jar_path = 'secexample-1.0.jar'

print(f"Analyzing jar file: {jar_path}")

try:
    with zipfile.ZipFile(jar_path, 'r') as z:
        files = z.namelist()
        print(f"\nTotal files: {len(files)}")

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

        # 查找Spring Boot相关文件
        print("\nSpring Boot related files:")
        spring_files = [f for f in files if 'spring' in f.lower()]
        for f in spring_files[:10]:
            print(f"  {f}")

        # 查找主类
        print("\nMain class files:")
        main_class_files = [f for f in files if 'main' in f.lower() and f.endswith('.class')]
        for f in main_class_files[:10]:
            print(f"  {f}")

except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
