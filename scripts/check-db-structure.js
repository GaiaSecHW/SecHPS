const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

async function getDbStructure(dbPath) {
  const p = new PrismaClient();
  
  // Get all tables
  const tables = await p.$queryRaw`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%'`;
  
  const structure = {};
  
  for (const t of tables) {
    const cols = await p.$queryRawUnsafe(`PRAGMA table_info(${t.name})`);
    structure[t.name] = cols.map(c => ({
      name: c.name,
      type: c.type,
      notnull: c.notnull,
      pk: c.pk
    }));
  }
  
  return structure;
}

async function compareWithOldDb(oldDbPath) {
  // Copy old db to a temp location to read its structure
  const tempDbPath = './prisma/temp-old.db';
  fs.copyFileSync(oldDbPath, tempDbPath);
  
  // We need to read from the old db using a different Prisma client
  // But since Prisma connects to the configured db, we'll use raw SQLite
  
  console.log('Checking old database structure...');
  console.log('Old db path:', oldDbPath);
  console.log('File exists:', fs.existsSync(oldDbPath));
  console.log('File size:', fs.statSync(oldDbPath).size);
  
  // Get current db structure
  console.log('\n=== Current Database Structure ===');
  const currentStructure = await getDbStructure('./prisma/dev.db');
  
  for (const [table, cols] of Object.entries(currentStructure)) {
    console.log(`\n${table}:`);
    cols.forEach(c => console.log(`  - ${c.name}: ${c.type} (notnull: ${c.notnull}, pk: ${c.pk})`));
  }
}

compareWithOldDb('E:/dev.db').then(() => {
  console.log('\nDone');
  process.exit(0);
}).catch(e => {
  console.error('Error:', e);
  process.exit(1);
});