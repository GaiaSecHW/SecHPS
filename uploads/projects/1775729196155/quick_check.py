import zipfile

jar_path = 'secexample-1.0.jar'

with open('quick_result.txt', 'w') as f:
    try:
        with zipfile.ZipFile(jar_path, 'r') as z:
            files = z.namelist()
            f.write(f"Total files: {len(files)}\n")

            lib_files = [f for f in files if f.startswith('lib/')]
            f.write(f"Files in lib/: {len(lib_files)}\n")

            if lib_files:
                f.write("This is a fatJar format\n")
                f.write("\nFirst 20 files in lib/:\n")
                for file in lib_files[:20]:
                    f.write(f"  {file}\n")
            else:
                f.write("Not a fatJar format\n")

            main_dirs = set()
            for file in files:
                parts = file.split('/')
                if len(parts) > 1:
                    main_dirs.add(parts[0])

            f.write("\nMain directories:\n")
            for d in sorted(main_dirs):
                f.write(f"  {d}/\n")

    except Exception as e:
        f.write(f"Error: {e}\n")
