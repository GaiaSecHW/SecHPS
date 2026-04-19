import { PrismaClient } from './node_modules/.prisma/client/index.js';
const p = new PrismaClient();
const rows = await p.skill.findMany({ take: 5, select: { name: true, description: true, content: true } });
for (const s of rows) {
  console.log('name:', s.name);
  console.log('desc:', s.description ? s.description.slice(0, 80) : '(empty)');
  console.log('content:', s.content ? s.content.slice(0, 80) : '(empty)');
  console.log('---');
}
await p.$disconnect();
