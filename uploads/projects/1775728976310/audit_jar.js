const fs = require('fs');
const path = require('path');

const jarPath = 'secexample-1.0.jar';
const extractPath = 'extracted';

console.log('Starting JAR analysis and extraction...');

try {
    // Read the JAR file
    const data = fs.readFileSync(jarPath);
    console.log('JAR file size:', data.length, 'bytes');

    // Check ZIP signature
    const zipSignature = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
    const isZip = data.slice(0, 4).equals(zipSignature);
    console.log('Is valid ZIP/JAR file:', isZip);

    if (!isZip) {
        console.error('Not a valid ZIP/JAR file!');
        process.exit(1);
    }

    // Simple ZIP parser
    let offset = 0;
    const entries = [];

    while (offset < data.length - 4) {
        // Check for local file header signature
        if (data.slice(offset, offset + 4).equals(zipSignature)) {
            // Parse local file header
            const version = data.readUInt16LE(offset + 4);
            const flags = data.readUInt16LE(offset + 6);
            const compressionMethod = data.readUInt16LE(offset + 8);
            const modTime = data.readUInt16LE(offset + 10);
            const modDate = data.readUInt16LE(offset + 12);
            const crc32 = data.readUInt32LE(offset + 14);
            const compressedSize = data.readUInt32LE(offset + 18);
            const uncompressedSize = data.readUInt32LE(offset + 22);
            const nameLength = data.readUInt16LE(offset + 26);
            const extraLength = data.readUInt16LE(offset + 28);

            const nameStart = offset + 30;
            const name = data.slice(nameStart, nameStart + nameLength).toString('utf8');

            const dataStart = nameStart + nameLength + extraLength;
            const fileData = data.slice(dataStart, dataStart + compressedSize);

            entries.push({
                name: name,
                compressedSize: compressedSize,
                uncompressedSize: uncompressedSize,
                compressionMethod: compressionMethod,
                crc32: crc32,
                data: fileData
            });

            console.log(`Found entry: ${name} (${uncompressedSize} bytes, compressed: ${compressedSize} bytes)`);

            offset = dataStart + compressedSize;
        } else {
            // Check for central directory signature
            const centralDirSignature = Buffer.from([0x50, 0x4B, 0x01, 0x02]);
            if (data.slice(offset, offset + 4).equals(centralDirSignature)) {
                console.log('Reached central directory, stopping parsing');
                break;
            }
            offset++;
        }

        // Safety check
        if (offset > data.length) {
            console.log('Reached end of file');
            break;
        }
    }

    console.log(`\nTotal entries found: ${entries.length}`);

    // Create extraction directory
    if (!fs.existsSync(extractPath)) {
        fs.mkdirSync(extractPath, { recursive: true });
    }

    // Extract files
    let extractedCount = 0;
    for (const entry of entries) {
        if (entry.name.endsWith('/')) {
            // Directory
            const dirPath = path.join(extractPath, entry.name);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }
        } else {
            // File
            const filePath = path.join(extractPath, entry.name);
            const dirPath = path.dirname(filePath);

            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }

            // Write file (assuming no compression for simplicity)
            fs.writeFileSync(filePath, entry.data);
            extractedCount++;
            console.log(`Extracted: ${entry.name}`);
        }
    }

    console.log(`\nExtraction complete! Extracted ${extractedCount} files to '${extractPath}' directory.`);

    // Look for interesting files
    console.log('\nLooking for interesting files...');
    const interestingFiles = entries.filter(e =>
        e.name.endsWith('.class') ||
        e.name.endsWith('.java') ||
        e.name.endsWith('.xml') ||
        e.name.endsWith('.properties') ||
        e.name.includes('META-INF')
    );

    console.log(`Found ${interestingFiles.length} interesting files:`);
    interestingFiles.forEach(f => console.log(`  - ${f.name}`));

} catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
    process.exit(1);
}
