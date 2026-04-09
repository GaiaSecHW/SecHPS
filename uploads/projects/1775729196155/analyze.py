import zipfile
import os
import sys

jar_path = 'secexample-1.0.jar'

try:
    with zipfile.ZipFile(jar_path, 'r') as z:
        files = z.namelist()
        print(f"Total files: {len(files)}")

        lib_files = [f for f in files if f.startswith('lib/')]
        print(f"Files in lib/: {len(lib_files)}")

        boot_inf_files = [f for f in files if f.startswith('BOOT-INF/')]
        print(f"Files in BOOT-INF/: {len(boot_inf_files)}")

        boot_lib_files = [f for f in files if f.startswith('BOOT-INF/lib/')]
        print(f"Files in BOOT-INF/lib/: {len(boot_lib_files)}")

        if len(lib_files) > 0 or len(boot_lib_files) > 0:
            print("\nThis is a fatJar format")

            if len(boot_lib_files) > 0:
                print("This is Spring Boot fatJar format")
                print("\nFirst 20 files in BOOT-INF/lib/:")
                for f in boot_lib_files[:20]:
                    print(f"  {f}")
            elif len(lib_files) > 0:
                print("This is standard fatJar format")
                print("\nFirst 20 files in lib/:")
                for f in lib_files[:20]:
                    print(f"  {f}")
        else:
            print("\nThis is not a fatJar format")

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
    import traceback
    traceback.print_exc()
