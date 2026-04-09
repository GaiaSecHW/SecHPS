const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const jarPath = 'secexample-1.0.jar';
const extractDir = 'extracted';

try {
    console.log('Processing jar file:', jarPath);

    // 使用7z命令列出jar文件内容
    console.log('\nListing jar file contents...');
    const listOutput = execSync('7z l "' + jarPath + '"', { encoding: 'utf8' });
    console.log(listOutput);

    // 检查是否包含lib目录
    if (listOutput.includes('lib/')) {
        console.log('\nThis is a fatJar format');

        // 解压jar文件
        console.log('\nExtracting jar file to', extractDir, '...');
        if (fs.existsSync(extractDir)) {
            fs.rmSync(extractDir, { recursive: true });
        }
        fs.mkdirSync(extractDir, { recursive: true });

        execSync('7z x "' + jarPath + '" -o"' + extractDir + '" -y', { encoding: 'utf8' });
        console.log('Extraction completed');

        // 检查lib目录
        const libDir = path.join(extractDir, 'lib');
        if (fs.existsSync(libDir)) {
            console.log('\nlib directory exists:', libDir);
            const libJars = fs.readdirSync(libDir).filter(file => file.endsWith('.jar'));
            console.log('JAR files in lib/:', libJars.length);

            if (libJars.length > 0) {
                console.log('\nJAR files in lib/:');
                libJars.slice(0, 10).forEach(jar => console.log('  ' + jar));
                if (libJars.length > 10) {
                    console.log('  ... and', libJars.length - 10, 'more files');
                }

                // 解压lib目录中的jar文件
                const libExtractDir = path.join(extractDir, 'lib_extracted');
                fs.mkdirSync(libExtractDir, { recursive: true });

                console.log('\nExtracting JAR files from lib to', libExtractDir, '...');
                let successCount = 0;

                for (let i = 0; i < libJars.length; i++) {
                    const jarFile = libJars[i];
                    const jarPath = path.join(libDir, jarFile);
                    const jarExtractDir = path.join(libExtractDir, jarFile.replace('.jar', ''));
                    fs.mkdirSync(jarExtractDir, { recursive: true });

                    try {
                        execSync('7z x "' + jarPath + '" -o"' + jarExtractDir + '" -y', { encoding: 'utf8' });
                        successCount++;
                    } catch (error) {
                        console.log('  Failed to extract', jarFile, ':', error.message);
                    }

                    if ((i + 1) % 10 === 0 || i === libJars.length - 1) {
                        console.log('  Extracted', i + 1, '/', libJars.length, 'JAR files');
                    }
                }

                console.log('\nSuccessfully extracted', successCount, '/', libJars.length, 'lib JAR files');
            } else {
                console.log('\nNo JAR files found in lib directory');
            }
        } else {
            console.log('\nlib directory does not exist');
        }
    } else {
        console.log('\nThis is not a fatJar format');
    }

    console.log('\nProcessing completed successfully');

} catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
}
