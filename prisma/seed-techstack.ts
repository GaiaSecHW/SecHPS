// prisma/seed-techstack.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TECHSTACK_DATA = [
  // 编程语言
  { name: 'Python', category: 'language', description: 'Python 编程语言', sortOrder: 1 },
  { name: 'Java', category: 'language', description: 'Java 编程语言', sortOrder: 2 },
  { name: 'JavaScript', category: 'language', description: 'JavaScript 编程语言', sortOrder: 3 },
  { name: 'TypeScript', category: 'language', description: 'TypeScript 编程语言', sortOrder: 4 },
  { name: 'C', category: 'language', description: 'C 编程语言', sortOrder: 5 },
  { name: 'C++', category: 'language', description: 'C++ 编程语言', sortOrder: 6 },
  { name: 'C#', category: 'language', description: 'C# 编程语言', sortOrder: 7 },
  { name: 'PHP', category: 'language', description: 'PHP 编程语言', sortOrder: 8 },
  { name: 'Ruby', category: 'language', description: 'Ruby 编程语言', sortOrder: 9 },
  { name: 'Go', category: 'language', description: 'Go 编程语言', sortOrder: 10 },
  { name: 'Rust', category: 'language', description: 'Rust 编程语言', sortOrder: 11 },
  { name: 'Swift', category: 'language', description: 'Swift 编程语言', sortOrder: 12 },
  { name: 'Kotlin', category: 'language', description: 'Kotlin 编程语言', sortOrder: 13 },
  { name: 'Scala', category: 'language', description: 'Scala 编程语言', sortOrder: 14 },
  { name: 'R', category: 'language', description: 'R 编程语言', sortOrder: 15 },
  { name: 'SQL', category: 'language', description: 'SQL 查询语言', sortOrder: 16 },
  
  // 框架
  { name: 'Spring', category: 'framework', description: 'Spring 框架', sortOrder: 1 },
  { name: 'Spring Boot', category: 'framework', description: 'Spring Boot 框架', sortOrder: 2 },
  { name: 'MyBatis', category: 'framework', description: 'MyBatis 持久层框架', sortOrder: 3 },
  { name: 'Hibernate', category: 'framework', description: 'Hibernate ORM 框架', sortOrder: 4 },
  { name: 'Django', category: 'framework', description: 'Django Web 框架', sortOrder: 5 },
  { name: 'Flask', category: 'framework', description: 'Flask Web 框架', sortOrder: 6 },
  { name: 'FastAPI', category: 'framework', description: 'FastAPI Web 框架', sortOrder: 7 },
  { name: 'React', category: 'framework', description: 'React 前端框架', sortOrder: 8 },
  { name: 'Vue', category: 'framework', description: 'Vue 前端框架', sortOrder: 9 },
  { name: 'Angular', category: 'framework', description: 'Angular 前端框架', sortOrder: 10 },
  { name: 'Node.js', category: 'framework', description: 'Node.js 运行时', sortOrder: 11 },
  { name: 'Express', category: 'framework', description: 'Express Web 框架', sortOrder: 12 },
  { name: 'Next.js', category: 'framework', description: 'Next.js 全栈框架', sortOrder: 13 },
  { name: 'NestJS', category: 'framework', description: 'NestJS 后端框架', sortOrder: 14 },
  { name: 'Laravel', category: 'framework', description: 'Laravel PHP 框架', sortOrder: 15 },
  { name: 'ASP.NET', category: 'framework', description: 'ASP.NET 框架', sortOrder: 16 },
  { name: 'ASP.NET Core', category: 'framework', description: 'ASP.NET Core 框架', sortOrder: 17 },
  { name: 'Gin', category: 'framework', description: 'Gin Go Web 框架', sortOrder: 18 },
  
  // 数据库
  { name: 'MySQL', category: 'database', description: 'MySQL 数据库', sortOrder: 1 },
  { name: 'PostgreSQL', category: 'database', description: 'PostgreSQL 数据库', sortOrder: 2 },
  { name: 'Oracle', category: 'database', description: 'Oracle 数据库', sortOrder: 3 },
  { name: 'SQL Server', category: 'database', description: 'SQL Server 数据库', sortOrder: 4 },
  { name: 'MongoDB', category: 'database', description: 'MongoDB 数据库', sortOrder: 5 },
  { name: 'Redis', category: 'database', description: 'Redis 缓存数据库', sortOrder: 6 },
  { name: 'Elasticsearch', category: 'database', description: 'Elasticsearch 搜索引擎', sortOrder: 7 },
  { name: 'SQLite', category: 'database', description: 'SQLite 数据库', sortOrder: 8 },
  
  // 中间件
  { name: 'Kafka', category: 'middleware', description: 'Kafka 消息队列', sortOrder: 1 },
  { name: 'RabbitMQ', category: 'middleware', description: 'RabbitMQ 消息队列', sortOrder: 2 },
  { name: 'Nginx', category: 'middleware', description: 'Nginx Web 服务器', sortOrder: 3 },
  { name: 'Docker', category: 'middleware', description: 'Docker 容器', sortOrder: 4 },
  { name: 'Kubernetes', category: 'middleware', description: 'Kubernetes 容器编排', sortOrder: 5 },
  
  // 云服务
  { name: 'AWS', category: 'cloud', description: 'Amazon Web Services', sortOrder: 1 },
  { name: 'Azure', category: 'cloud', description: 'Microsoft Azure', sortOrder: 2 },
  { name: 'Google Cloud', category: 'cloud', description: 'Google Cloud Platform', sortOrder: 3 },
  { name: 'Alibaba Cloud', category: 'cloud', description: '阿里云', sortOrder: 4 },
];

async function main() {
  console.log('开始初始化技术栈数据...');

  for (const data of TECHSTACK_DATA) {
    const existing = await prisma.techStackOption.findUnique({
      where: { name: data.name },
    });

    if (existing) {
      console.log(`技术栈 "${data.name}" 已存在，跳过`);
      continue;
    }

    await prisma.techStackOption.create({
      data: {
        ...data,
        isBuiltin: true,
        isActive: true,
      },
    });
    console.log(`创建技术栈: ${data.name}`);
  }

  console.log('技术栈数据初始化完成！');
}

main()
  .catch((e) => {
    console.error('初始化失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
