import zipfile
import os
import shutil

jar_path = 'secexample-1.0.jar'

print(f"检查jar文件: {jar_path}")

# 检查jar文件内容
with zipfile.ZipFile(jar_path, 'r') as z:
    files = z.namelist()
    print(f"\n总文件数: {len(files)}")

    # 查找lib目录
    lib_files = [f for f in files if f.startswith('lib/')]
    print(f"\nlib目录下的文件数: {len(lib_files)}")

    if lib_files:
        print("\nlib目录下的前20个文件:")
        for f in lib_files[:20]:
            print(f"  {f}")

        # 检查是否是fatJar
        print("\n检查是否为fatJar格式...")
        if len(lib_files) > 0:
            print("✓ 这是一个fatJar格式的jar文件")

            # 解压整个jar文件
            extract_dir = 'extracted'
            if os.path.exists(extract_dir):
                shutil.rmtree(extract_dir)

            print(f"\n解压jar文件到 {extract_dir} 目录...")
            with zipfile.ZipFile(jar_path, 'r') as z:
                z.extractall(extract_dir)

            print(f"✓ 解压完成")

            # 检查lib目录
            lib_dir = os.path.join(extract_dir, 'lib')
            if os.path.exists(lib_dir):
                print(f"\nlib目录存在: {lib_dir}")
                lib_jars = [f for f in os.listdir(lib_dir) if f.endswith('.jar')]
                print(f"lib目录中的jar文件数: {len(lib_jars)}")

                if lib_jars:
                    print("\nlib目录中的jar文件:")
                    for jar in lib_jars[:10]:
                        print(f"  {jar}")
                    if len(lib_jars) > 10:
                        print(f"  ... 还有 {len(lib_jars) - 10} 个文件")

                    # 解压lib目录中的jar文件
                    lib_extract_dir = os.path.join(extract_dir, 'lib_extracted')
                    os.makedirs(lib_extract_dir, exist_ok=True)

                    print(f"\n解压lib目录中的jar文件到 {lib_extract_dir}...")
                    for i, jar_file in enumerate(lib_jars):
                        jar_path = os.path.join(lib_dir, jar_file)
                        jar_extract_dir = os.path.join(lib_extract_dir, jar_file.replace('.jar', ''))
                        os.makedirs(jar_extract_dir, exist_ok=True)

                        try:
                            with zipfile.ZipFile(jar_path, 'r') as jar_z:
                                jar_z.extractall(jar_extract_dir)
                            if (i + 1) % 10 == 0 or i == len(lib_jars) - 1:
                                print(f"  已解压 {i + 1}/{len(lib_jars)} 个jar文件")
                        except Exception as e:
                            print(f"  解压 {jar_file} 失败: {e}")

                    print(f"\n✓ 所有lib jar文件解压完成")
            else:
                print("\nlib目录不存在")
        else:
            print("✗ 这不是一个fatJar格式的jar文件")
    else:
        print("\n未找到lib目录，这不是一个fatJar格式的jar文件")

    # 显示主要目录结构
    print("\n主要目录结构:")
    main_dirs = set()
    for f in files[:100]:
        parts = f.split('/')
        if len(parts) > 1:
            main_dirs.add(parts[0])

    for d in sorted(main_dirs):
        print(f"  {d}/")
