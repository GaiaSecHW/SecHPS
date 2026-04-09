import zipfile
import os
import sys

jar_path = 'secexample-1.0.jar'

print("=== JAR文件分析 ===")
print(f"文件: {jar_path}")

try:
    with zipfile.ZipFile(jar_path, 'r') as z:
        files = z.namelist()
        print(f"总文件数: {len(files)}")

        # 查找lib目录
        lib_files = [f for f in files if f.startswith('lib/')]
        print(f"lib目录文件数: {len(lib_files)}")

        # 查找BOOT-INF目录
        boot_inf_files = [f for f in files if f.startswith('BOOT-INF/')]
        print(f"BOOT-INF目录文件数: {len(boot_inf_files)}")

        # 查找BOOT-INF/lib目录
        boot_lib_files = [f for f in files if f.startswith('BOOT-INF/lib/')]
        print(f"BOOT-INF/lib目录文件数: {len(boot_lib_files)}")

        # 判断是否为fatJar
        if len(lib_files) > 0 or len(boot_lib_files) > 0:
            print("\n这是一个fatJar格式的jar文件")

            if len(boot_lib_files) > 0:
                print("这是Spring Boot fatJar格式")
                print("\nBOOT-INF/lib目录下的前20个文件:")
                for f in boot_lib_files[:20]:
                    print(f"  {f}")
            elif len(lib_files) > 0:
                print("这是标准fatJar格式")
                print("\nlib目录下的前20个文件:")
                for f in lib_files[:20]:
                    print(f"  {f}")
        else:
            print("\n这不是一个fatJar格式的jar文件")

        # 显示主要目录
        print("\n主要目录:")
        main_dirs = set()
        for f in files:
            parts = f.split('/')
            if len(parts) > 1:
                main_dirs.add(parts[0])

        for d in sorted(main_dirs):
            print(f"  {d}/")

except Exception as e:
    print(f"错误: {e}")
    import traceback
    traceback.print_exc()
