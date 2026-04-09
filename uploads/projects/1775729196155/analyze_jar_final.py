import zipfile
import os
import shutil

jar_path = 'secexample-1.0.jar'
extract_dir = 'extracted'
result_file = 'jar_analysis_final.txt'

def log(message):
    print(message)
    with open(result_file, 'a', encoding='utf-8') as f:
        f.write(message + '\n')

try:
    # 清空结果文件
    with open(result_file, 'w', encoding='utf-8') as f:
        f.write("")

    log(f"=== JAR文件分析报告 ===")
    log(f"文件路径: {jar_path}")
    log(f"文件大小: {os.path.getsize(jar_path)} 字节")

    # 检查jar文件
    with zipfile.ZipFile(jar_path, 'r') as z:
        files = z.namelist()
        log(f"\n=== 基本信息 ===")
        log(f"总文件数: {len(files)}")

        # 查找lib目录
        lib_files = [f for f in files if f.startswith('lib/')]
        log(f"lib目录下的文件数: {len(lib_files)}")

        if lib_files:
            log(f"\n=== FatJar格式检测 ===")
            log("✓ 这是一个fatJar格式的jar文件")
            log(f"\nlib目录下的前20个文件:")
            for f in lib_files[:20]:
                log(f"  {f}")
            if len(lib_files) > 20:
                log(f"  ... 还有 {len(lib_files) - 20} 个文件")
        else:
            log(f"\n=== FatJar格式检测 ===")
            log("✗ 这不是一个fatJar格式的jar文件")

        # 显示主要目录结构
        log(f"\n=== 主要目录结构 ===")
        main_dirs = set()
        for f in files:
            parts = f.split('/')
            if len(parts) > 1:
                main_dirs.add(parts[0])

        for d in sorted(main_dirs):
            log(f"  {d}/")

        # 查找BOOT-INF目录（Spring Boot fatJar特征）
        boot_inf_files = [f for f in files if f.startswith('BOOT-INF/')]
        if boot_inf_files:
            log(f"\n=== Spring Boot FatJar特征 ===")
            log(f"BOOT-INF目录下的文件数: {len(boot_inf_files)}")
            log("这是Spring Boot fatJar格式")

            # 查找BOOT-INF/lib目录
            boot_lib_files = [f for f in boot_inf_files if f.startswith('BOOT-INF/lib/')]
            if boot_lib_files:
                log(f"BOOT-INF/lib目录下的文件数: {len(boot_lib_files)}")
                log(f"\nBOOT-INF/lib目录下的前20个文件:")
                for f in boot_lib_files[:20]:
                    log(f"  {f}")

    # 解压jar文件
    log(f"\n=== 解压JAR文件 ===")
    log(f"解压到: {extract_dir}")
    if os.path.exists(extract_dir):
        shutil.rmtree(extract_dir)
    os.makedirs(extract_dir)

    with zipfile.ZipFile(jar_path, 'r') as z:
        z.extractall(extract_dir)

    log("✓ 解压完成")

    # 检查lib目录
    lib_dir = os.path.join(extract_dir, 'lib')
    if os.path.exists(lib_dir):
        log(f"\n=== lib目录分析 ===")
        log(f"lib目录存在: {lib_dir}")
        lib_jars = [f for f in os.listdir(lib_dir) if f.endswith('.jar')]
        log(f"lib目录中的jar文件数: {len(lib_jars)}")

        if lib_jars:
            log(f"\nlib目录中的jar文件:")
            for jar in lib_jars[:10]:
                log(f"  {jar}")
            if len(lib_jars) > 10:
            log(f"  ... 还有 {len(lib_jars) - 10} 个文件")

            # 解压lib目录中的jar文件
            lib_extract_dir = os.path.join(extract_dir, 'lib_extracted')
            os.makedirs(lib_extract_dir, exist_ok=True)

            log(f"\n=== 解压lib目录中的JAR文件 ===")
            log(f"解压到: {lib_extracted_dir}")
            success_count = 0
            fail_count = 0

            for i, jar_file in enumerate(lib_jars):
                jar_path = os.path.join(lib_dir, jar_file)
                jar_extract_dir = os.path.join(lib_extract_dir, jar_file.replace('.jar', ''))
                os.makedirs(jar_extract_dir, exist_ok=True)

                try:
                    with zipfile.ZipFile(jar_path, 'r') as jar_z:
                        jar_z.extractall(jar_extract_dir)
                    success_count += 1
                except Exception as e:
                    fail_count += 1
                    log(f"  解压 {jar_file} 失败: {e}")

                if (i + 1) % 10 == 0 or i == len(lib_jars) - 1:
                    log(f"  已解压 {i + 1}/{len(lib_jars)} 个jar文件")

            log(f"\n✓ 成功解压 {success_count}/{len(lib_jars)} 个lib jar文件")
            if fail_count > 0:
                log(f"✗ 失败 {fail_count} 个jar文件")
        else:
            log("lib目录中没有jar文件")
    else:
        log("\nlib目录不存在")

    # 检查BOOT-INF目录
    boot_inf_dir = os.path.join(extract_dir, 'BOOT-INF')
    if os.path.exists(boot_inf_dir):
        log(f"\n=== BOOT-INF目录分析 ===")
        log(f"BOOT-INF目录存在: {boot_inf_dir}")

        # 检查BOOT-INF/lib目录
        boot_lib_dir = os.path.join(boot_inf_dir, 'lib')
        if os.path.exists(boot_lib_dir):
            log(f"BOOT-INF/lib目录存在: {boot_lib_dir}")
            boot_lib_jars = [f for f in os.listdir(boot_lib_dir) if f.endswith('.jar')]
            log(f"BOOT-INF/lib目录中的jar文件数: {len(boot_lib_jars)}")

            if boot_lib_jars:
                log(f"\nBOOT-INF/lib目录中的jar文件:")
                for jar in boot_lib_jars[:10]:
                    log(f"  {jar}")
                if len(boot_lib_jars) > 10:
                    log(f"  ... 还有 {len(boot_lib_jars) - 10} 个文件")

                # 解压BOOT-INF/lib目录中的jar文件
                boot_lib_extract_dir = os.path.join(extract_dir, 'BOOT-INF/lib_extracted')
                os.makedirs(boot_lib_extract_dir, exist_ok=True)

                log(f"\n=== 解压BOOT-INF/lib目录中的JAR文件 ===")
                log(f"解压到: {boot_lib_extract_dir}")
                success_count = 0
                fail_count = 0

                for i, jar_file in enumerate(boot_lib_jars):
                    jar_path = os.path.join(boot_lib_dir, jar_file)
                    jar_extract_dir = os.path.join(boot_lib_extract_dir, jar_file.replace('.jar', ''))
                    os.makedirs(jar_extract_dir, exist_ok=True)

                    try:
                        with zipfile.ZipFile(jar_path, 'r') as jar_z:
                            jar_z.extractall(jar_extract_dir)
                        success_count += 1
                    except Exception as e:
                        fail_count += 1
                        log(f"  解压 {jar_file} 失败: {e}")

                    if (i + 1) % 10 == 0 or i == len(boot_lib_jars) - 1:
                        log(f"  已解压 {i + 1}/{len(boot_lib_jars)} 个jar文件")

                log(f"\n✓ 成功解压 {success_count}/{len(boot_lib_jars)} 个BOOT-INF/lib jar文件")
                if fail_count > 0:
                    log(f"✗ 失败 {fail_count} 个jar文件")
            else:
                log("BOOT-INF/lib目录中没有jar文件")
        else:
            log("BOOT-INF/lib目录不存在")

    log(f"\n=== 处理完成 ===")
    log(f"结果文件: {result_file}")
    log(f"解压目录: {extract_dir}")

except Exception as e:
    log(f"\n=== 错误 ===")
    log(f"错误信息: {e}")
    import traceback
    log(f"堆栈跟踪:\n{traceback.format_exc()}")
