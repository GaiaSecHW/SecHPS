const fs = require('fs');
const AdmZip = require('adm-zip');

try {
    const zip = new AdmZip('D:\\cla\\web-platform\\uploads\\projects\\1775728976310\\secexample-1.0.jar');
    const zipEntries = zip.getEntries();

    console.log('JAR Contents:');
    zipEntries.forEach(entry => {
        console.log(`  ${entry.entryName}`);
    });

    zip.extractAllTo('D:\\claude-web-platform\\uploads\\projects\\1775728976310\\extracted', true);
    console.log('\nExtracted to: D:\\claude-web-platform\\uploads\\projects\\1775728976310\\extracted');
} catch (error) {
    console.error('Error:', error.message);
}
