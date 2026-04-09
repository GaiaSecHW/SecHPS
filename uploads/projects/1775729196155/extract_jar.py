import zipfile
import os
import shutil

jar_path = 'secexample-1.0.jar'
extract_dir = 'extracted'

print("Processing jar file:", jar_path)

try:
    with zipfile.ZipFile(jar_path, 'r') as z:
        files = z.namelist()
        print(f"\nTotal files: {len(files)}")

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

        # 显示主要目录
        print("\nMain directories:")
        main_dirs = set()
        for f in files:
            parts = f.split('/')
            if len(parts) > 1:
                main_dirs.add(parts[0])

        for d in sorted(main_dirs):
            print(f"  {d}/")

    # 解压jar文件
    print(f"\nExtracting jar file to {extract_dir}...")
    if os.path.exists(extract_dir):
        shutil.rmtree(extract_dir)
    os.makedirs(extract_dir)

    with zipfile.ZipFile(jar_path, 'r') as z:
        z.extractall(extract_dir)

    print("Extraction completed")

    # 检查lib目录
    lib_dir = os.path.join(extract_dir, 'lib')
    if os.path.exists(lib_dir):
        print(f"\nlib directory exists: {lib_dir}")
        lib_jars = [f for f in os.listdir(lib_dir) if f.endswith('.jar')]
        print(f"JAR files in lib/: {len(lib_jars)}")

        if lib_jars:
            print("\nJAR files in lib/:")
            for jar in lib_jars[:10]:
                print(f"  {jar}")
            if len(lib_jars) > 10:
                print(f"  ... and {len(lib_jars) - 10} more files")

            # 解压lib目录中的jar文件
            lib_extract_dir = os.path.join(extract_dir, 'lib_extracted')
            os.makedirs(lib_extract_dir, exist_ok=True)

            print(f"\nExtracting JAR files from lib to {lib_extract_dir}...")
            success_count = 0

            for i, jar_file in enumerate(lib_jars):
                jar_path = os.path.join(lib_dir, jar_file)
                jar_extract_dir = os.path.join(lib_extract_dir, jar_file.replace('.jar', ''))
                os.makedirs(jar_extract_dir, exist_ok=True)

                try:
                    with zipfile.ZipFile(jar_path, 'r') as jar_z:
                        jar_z.extractall(jar_extract_dir)
                    success_count += 1
                except Exception as e:
                    print(f"  Failed to extract {jar_file}: {e}")

                if (i + 1) % 10 == 0 or i == len(lib_jars) - 1:
                    print(f"  Extracted {i + 1}/{len(lib_jars)} JAR files")

            print(f"\nSuccessfully extracted {success_count}/{len(lib_jars)} lib JAR files")
        else:
            print("\nNo JAR files found in lib directory")
    else:
        print("\nlib directory does not exist")

    print("\nProcessing completed successfully")

except Exception as e:
    print(f"Error: {e}")
