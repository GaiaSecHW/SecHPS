const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function listTables(dbPath) {
  const tables = await p. + "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%'";
  console.log('Tables:', tables.map(t => t.name).join(', '));
  for (const t of tables) {
    const cols = await p. + "PRAGMA table_info()";
    console.log(${t.name}:, cols.map(c => ${c.name} ).join(', '));
  }
}

listTables().catch(e => console.error('Error:', e));
