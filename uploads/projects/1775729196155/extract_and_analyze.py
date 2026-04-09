import zipfile
import os
import shutil
import sys

jar_path = 'secexample-1.0.jar'
extract_dir = 'extracted'
result_file = 'extraction_result.txt'

def write_result(text):
    with open(result_file, 'a', encoding='utf-8') as f:
        f.write(text + '\n')

try:
    write_result(f"Analyzing jar file: {jar_path}")

    # 检查jar文件
    with zipfile.ZipFile(jar_path, 'r') as z:
        files = z.namelist()
        write_result(f"\nTotal files: {len(files)}")

        # 查找lib目录
        lib_files = [f for f in files if f.startswith('lib/')]
        write_result(f"Files in lib/: {len(lib_files)}")

        if lib_files:
            write_result("\nFirst 20 files in lib/:")
            for f in lib_files[:20]:
                write_result(f"  {f}")
            write_result("\nThis is a fatJar format")
        else:
            write_result("\nNo lib/ directory found - not a fatJar")

        # 显示主要目录
        write_result("\nMain directories:")
        main_dirs = set()
        for f in files:
            parts = f.split('/')
            if len(parts) > 1:
                main_dirs.add(parts[0])

        for d in sorted(main_dirs):
            write_result(f"  {d}/")

    # 解压jar文件
    write_result(f"\nExtracting jar file to {extract_dir}...")
    if os.path.exists(extract_dir):
        shutil.rmtree(extract_dir)
    os.makedirs(extract_dir)

    with zipfile.ZipFile(jar_path, 'r') as z:
        z.extractall(extract_dir)

    write_result("Extraction completed")

    # 检查lib目录
    lib_dir = os.path.join(extract_dir, 'lib')
    if os.path.exists(lib_dir):
        write_result(f"\nlib directory exists: {lib_dir}")
        lib_jars = [f for f in os.listdir(lib_dir) if f.endswith('.jar')]
        write_result(f"JAR files in lib/: {len(lib_jars)}")

        if lib_jars:
            write_result("\nJAR files in lib/:")
            for jar in lib_jars[:10]:
                write_result(f"  {jar}")
            if len(lib_jars) > 10:
                write_result(f"  ... and {len(lib_jars) - 10} more files")

            # 解压lib目录中的jar文件
            lib_extract_dir = os.path.join(extract_dir, 'lib_extracted')
            os.makedirs(lib_extract_dir, exist_ok=True)

            write_result(f"\nExtracting JAR files from lib to {lib_extract_dir}...")
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
                    write_result(f"  Failed to extract {jar_file}: {e}")

                if (i + 1) % 10 == 0 or i == len(lib_jars) - 1:
                    write_result(f"  Extracted {i + 1}/{len(lib_jars)} JAR files")

            write_result(f"\nSuccessfully extracted {success_count}/{len(lib_jars)} lib JAR files")
        else:
            write_result("\nNo JAR files found in lib directory")
    else:
        write_result("\nlib directory does not found")

    write_result("\nProcessing completed successfully")

except Exception as e:
    write_result(f"Error: {e}")
    sys.exit(1)
