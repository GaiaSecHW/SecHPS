import zipfile
import os
import shutil

# 配置路径
BASE_DIR = r'D:\claude-web-platform\uploads\projects\1775729196155'
jar_path = os.path.join(BASE_DIR, 'secexample-1.0.jar')
result_file = os.path.join(BASE_DIR, 'jar_analysis_result.txt')
extract_dir = os.path.join(BASE_DIR, 'extracted')

# 初始化结果文本
result_text = []
result_text.append(f"Analyzing JAR file: {jar_path}")
result_text.append("")

try:
    # 检查JAR文件是否存在
    if not os.path.exists(jar_path):
        result_text.append(f"ERROR: JAR file not found at {jar_path}")
        raise FileNotFoundError(f"JAR file not found: {jar_path}")

    # 打开JAR文件
    with zipfile.ZipFile(jar_path, 'r') as z:
        files = z.namelist()
        result_text.append(f"Total files: {len(files)}")
        result_text.append("")

        # 查找lib目录
        lib_files = [file for file in files if file.startswith('lib/')]
        result_text.append(f"Files in lib/ directory: {len(lib_files)}")
        result_text.append("")

        if lib_files:
            result_text.append("First 20 files in lib/:")
            for file in lib_files[:20]:
                result_text.append(f"  {file}")
            result_text.append("")

            # 检查是否是fatJar
            result_text.append("Checking if this is a fatJar format...")
            if len(lib_files) > 0:
                result_text.append("✓ This IS a fatJar format JAR file")
                result_text.append("")

                # 解压整个jar文件
                if os.path.exists(extract_dir):
                    shutil.rmtree(extract_dir)

                result_text.append(f"Extracting JAR file to {extract_dir}...")
                with zipfile.ZipFile(jar_path, 'r') as z:
                    z.extractall(extract_dir)

                result_text.append("✓ Extraction completed")
                result_text.append("")

                # 检查lib目录
                lib_dir = os.path.join(extract_dir, 'lib')
                if os.path.exists(lib_dir):
                    result_text.append(f"lib directory exists: {lib_dir}")
                    lib_jars = [file for file in os.listdir(lib_dir) if file.endswith('.jar')]
                    result_text.append(f"Number of JAR files in lib directory: {len(lib_jars)}")
                    result_text.append("")

                    if lib_jars:
                        result_text.append("JAR files in lib directory:")
                        for jar in lib_jars[:10]:
                            result_text.append(f"  {jar}")
                        if len(lib_jars) > 10:
                            result_text.append(f"  ... and {len(lib_jars) - 10} more files")
                        result_text.append("")

                        # 解压lib目录中的jar文件
                        lib_extract_dir = os.path.join(extract_dir, 'lib_extracted')
                        os.makedirs(lib_extract_dir, exist_ok=True)

                        result_text.append(f"Extracting JAR files from lib directory to {lib_extract_dir}...")
                        success_count = 0
                        for i, jar_file in enumerate(lib_jars):
                            jar_path_lib = os.path.join(lib_dir, jar_file)
                            jar_extract_dir = os.path.join(lib_extract_dir, jar_file.replace('.jar', ''))
                            os.makedirs(jar_extract_dir, exist_ok=True)

                            try:
                                with zipfile.ZipFile(jar_path_lib, 'r') as jar_z:
                                    jar_z.extractall(jar_extract_dir)
                                success_count += 1
                                if (i + 1) % 10 == 0 or i == len(lib_jars) -1:
                                    result_text.append(f"  Extracted {i + 1}/{len(lib_jars)} JAR files")
                            except Exception as e:
                                result_text.append(f"  Failed to extract {jar_file}: {e}")

                        result_text.append("")
                        result_text.append(f"✓ Successfully extracted {success_count}/{len(lib_jars)} lib JAR files")
                        result_text.append("")
                    else:
                        result_text.append("No JAR files found in lib directory")
                        result_text.append("")
                else:
                    result_text.append("lib directory does not exist")
                    result_text.append("")
            else:
                result_text.append("✗ This is NOT a fatJar format JAR file")
                result_text.append("")
        else:
            result_text.append("No lib/ directory found, this is not a fatJar format")
            result_text.append("")

        # 显示主要目录结构
        result_text.append("Main directory structure:")
        main_dirs = set()
        for file in files:
            parts = file.split('/')
            if len(parts) > 1:
                main_dirs.add(parts[0])

        for d in sorted(main_dirs):
            result_text.append(f"  {d}/")

    # 写入结果文件
    with open(result_file, 'w', encoding='utf-8') as f:
        f.write('\n'.join(result_text))

    print("Analysis completed successfully!")
    print("Results written to:", result_file)
    print("\n" + "="*50)
    print("ANALYSIS SUMMARY:")
    print("="*50)
    for line in result_text:
        print(line)

except Exception as e:
    error_msg = f"Error occurred: {str(e)}"
    print(error_msg)
    try:
        with open(result_file, 'w', encoding='utf-8') as f:
            f.write(error_msg)
    except:
        pass
