const fs = require('fs');
const path = require('path');

const jarPath = 'D:\\claude-web-platform\\uploads\\projects\\1775728976310\\secexample-1.0.jar';

try {
    // Read the JAR file
    const data = fs.readFileSync(jarPath);

    console.log('JAR file size:', data.length, 'bytes');
    console.log('First 100 bytes (hex):');
    for (let i = 0; i < Math.min(100, data.length); i++) {
        process.stdout.write(data[i].toString(16).padStart(2, '0') + ' ');
        if ((i + 1) % 16 === 0) console.log();
    }
    console.log('\n');

    // Check for ZIP signature
    const zipSignature = [0x50, 0x4B, 0x03, 0x04];
    const isZip = zipSignature.every((byte, i) => data[i] === byte);
    console.log('Is valid ZIP/JAR file:', isZip);

    // Try to find some text content that might give us hints
    console.log('\nSearching for text content...');
    const textContent = data.toString('utf8', 0, Math.min(10000, data.length));
    console.log('Text preview:', textContent.substring(0, 500));

} catch (error) {
    console.error('Error:', error.message);
}
