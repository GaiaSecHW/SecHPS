import zipfile
import os
import shutil

jar_path = 'secexample-1.0.jar'
result_file = 'jar_analysis_result.txt'

with open(result_file, 'w', encoding='utf-8') as f:
    f.write(f"检查jar文件: {jar_path}\n\n")

    try:
        with zipfile.ZipFile(jar_path, 'r') as z:
            files = z.namelist()
            f.write(f"总文件数: {len(files)}\n\n")

            # 查找lib目录
            lib_files = [file for file in files if file.startswith('lib/')]
            f.write(f"lib目录下的文件数: {len(lib_files)}\n\n")

            if lib_files:
                f.write("lib目录下的前20个文件:\n")
                for file in lib_files[:20]:
                    f.write(f"  {file}\n")
                f.write("\n")

                # 检查是否是fatJar
                f.write("检查是否为fatJar格式...\n")
                if len(lib_files) > 0:
                    f.write("✓ 这是一个fatJar格式的jar文件\n\n")

                    # 解压整个jar文件
                    extract_dir = 'extracted'
                    if os.path.exists(extract_dir):
                        shutil.rmtree(extract_dir)

                    f.write(f"解压jar文件到 {extract_dir} 目录...\n")
                    with zipfile.ZipFile(jar_path, 'r') as z:
                        z.extractall(extract_dir)

                    f.write(f"✓ 解压完成\n\n")

                    # 检查lib目录
                    lib_dir = os.path.join(extract_dir, 'lib')
                    if os.path.exists(lib_dir):
                        f.write(f"lib目录存在: {lib_dir}\n")
                        lib_jars = [file for file in os.listdir(lib_dir) if file.endswith('.jar')]
                        f.write(f"lib目录中的jar文件数: {len(lib_jars)}\n\n")

                        if lib_jars:
                            f.write("lib目录中的jar文件:\n")
                            for jar in lib_jars[:10]:
                                f.write(f"  {jar}\n")
                            if len(lib_jars) > 10:
                                f.write(f"  ... 还有 {len(lib_jars) - 10} 个文件\n")
                            f.write("\n")

                            # 解压lib目录中的jar文件
                            lib_extract_dir = os.path.join(extract_dir, 'lib_extracted')
                            os.makedirs(lib_extract_dir, exist_ok=True)

                            f.write(f"解压lib目录中的jar文件到 {lib_extract_dir}...\n")
                            success_count = 0
                            for i, jar_file in enumerate(lib_jars):
                                jar_path = os.path.join(lib_dir, jar_file)
                                jar_extract_dir = os.path.join(lib_extract_dir, jar_file.replace('.jar', ''))
                                os.makedirs(jar_extract_dir, exist_ok=True)

                                try:
                                    with zipfile.ZipFile(jar_path, 'r') as jar_z:
                                        jar_z.extractall(jar_extract_dir)
                                    success_count += 1
                                    if (i + 1) % 10 == 0 or i == len(lib_jars) - 1:
                                        f.write(f"  已解压 {i + 1}/{len(lib_jars)} 个jar文件\n")
                                except Exception as e:
                                    f.write(f"  解压 {jar_file} 失败: {e}\n")

                            f.write(f"\n✓ 成功解压 {success_count}/{len(lib_jars)} 个lib jar文件\n\n")
                        else:
                            f.write("lib目录中没有jar文件\n\n")
                    else:
                        f.write("lib目录不存在\n\n")
                else:
                    f.write("✗ 这不是一个fatJar格式的jar文件\n\n")
            else:
                f.write("未找到lib目录，这不是一个fatJar格式的jar文件\n\n")

            # 显示主要目录结构
            f.write("主要目录结构:\n")
            main_dirs = set()
            for file in files:
                parts = file.split('/')
                if len(parts) > 1:
                    main_dirs.add(parts[0])

            for d in sorted(main_dirs):
                f.write(f"  {d}/\n")

    except Exception as e:
        f.write(f"错误: {e}\n")

print("分析完成，结果已写入 jar_analysis_result.txt")
