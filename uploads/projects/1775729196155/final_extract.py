import zipfile
import os
import shutil

jar_path = 'secexample-1.0.jar'
extract_dir = 'extracted'
result_file = 'final_result.txt'

# 清空结果文件
with open(result_file, 'w', encoding='utf-8') as f:
    f.write("")

def log(message):
    print(message)
    with open(result_file, 'a', encoding='utf-8') as f:
        f.write(message + '\n')

try:
    log(f"Processing jar file: {jar_path}")

    # 检查jar文件
    with zipfile.ZipFile(jar_path, 'r') as z:
        files = z.namelist()
        log(f"Total files: {len(files)}")

        # 查找lib目录
        lib_files = [f for f in files if f.startswith('lib/')]
        log(f"Files in lib/: {len(lib_files)}")

        if lib_files:
            log("\nThis is a fatJar format")
            log("\nFirst 20 files in lib/:")
            for f in lib_files[:20]:
                log(f"  {f}")
        else:
            log("\nNot a fatJar format")

        # 显示主要目录
        log("\nMain directories:")
        main_dirs = set()
        for f in files:
            parts = f.split('/')
            if len(parts) > 1:
                main_dirs.add(parts[0])

        for d in sorted(main_dirs):
            log(f"  {d}/")

    # 解压jar文件
    log(f"\nExtracting jar file to {extract_dir}...")
    if os.path.exists(extract_dir):
        shutil.rmtree(extract_dir)
    os.makedirs(extract_dir)

    with zipfile.ZipFile(jar_path, 'r') as z:
        z.extractall(extract_dir)

    log("Extraction completed")

    # 检查lib目录
    lib_dir = os.path.join(extract_dir, 'lib')
    if os.path.exists(lib_dir):
        log(f"\nlib directory exists: {lib_dir}")
        lib_jars = [f for f in os.listdir(lib_dir) if f.endswith('.jar')]
        log(f"JAR files in lib/: {len(lib_jars)}")

        if lib_jars:
            log("\nJAR files in lib/:")
            for jar in lib_jars[:10]:
                log(f"  {jar}")
            if len(lib_jars) > 10:
                log(f"  ... and {len(lib_jars) - 10} more files")

            # 解压lib目录中的jar文件
            lib_extract_dir = os
                .path.join(extract_dir, 'lib_extracted')
            os.makedirs(lib_extract_dir, exist_ok=True)

            log(f"\nExtracting JAR files from lib to {lib_extract_dir}...")
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
                    log(f"  Failed to extract {jar_file}: {e}")

                if (i + 1) % 10 == 0 or i == len(lib_jars) - 1:
                    log(f"  Extracted {i + 1}/{len(lib_jars)} JAR files")

            log(f"\nSuccessfully extracted {success_count}/{len(lib_jars)} lib JAR files")
        else:
            log("\nNo JAR files found in lib directory")
    else:
        log("\nlib directory does not exist")

    log("\nProcessing completed successfully")

except Exception as e:
    log(f"Error: {e}")
    import traceback
    log(traceback.format_exc())
