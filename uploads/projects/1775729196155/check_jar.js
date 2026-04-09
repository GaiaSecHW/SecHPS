const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

try {
    // 使用7z命令列出jar文件内容
    const output = execSync('7z l secexample-1.0.jar', { encoding: 'utf8' });
    console.log(output);

    // 检查是否包含lib目录
    if (output.includes('lib/')) {
        console.log('\n这是一个fatJar格式的jar文件');

    } else {
        console.log('\n这不是一个fatJar格式的jar文件');
    }
} catch (error) {
    console.error('Error:', error.message);
}
