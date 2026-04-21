// Analyze production database structure
const { PrismaClient } = require('@prisma/client');
const path = require('path');

// Use production database
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: `file:${path.join(__dirname, '../prisma/prod_dev.db')}`
    }
  }
});

async function main() {
  // Get all tables
  const tables = await prisma.$queryRaw`
    SELECT name FROM sqlite_master 
    WHERE type='table' 
    AND name NOT LIKE 'sqlite_%' 
    AND name NOT LIKE '_prisma_migrations'
    ORDER BY name
  `;
  
  console.log('=== Tables in Production Database ===');
  console.log(JSON.stringify(tables, null, 2));
  
  // Count records in each table
  console.log('\n=== Record Counts ===');
  for (const table of tables) {
    const tableName = table.name;
    try {
      const count = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM "${tableName}"`);
      console.log(`${tableName}: ${count[0].count}`);
    } catch (e) {
      console.log(`${tableName}: error - ${e.message}`);
    }
  }
  
  // Get table schemas
  console.log('\n=== Table Schemas ===');
  for (const table of tables) {
    const tableName = table.name;
    const columns = await prisma.$queryRawUnsafe(`PRAGMA table_info("${tableName}")`);
    console.log(`\n${tableName}:`);
    columns.forEach(col => {
      console.log(`  - ${col.name} (${col.type}) ${col.pk ? 'PK' : ''} ${col.notnull ? 'NOT NULL' : ''}`);
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
