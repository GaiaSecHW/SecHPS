// src/lib/techstack-options.ts
/**
 * 技术栈选项列表
 * 管理员可在系统配置中修改
 */

// 开发语言
export const PROGRAMMING_LANGUAGES = [
  'Python',
  'Java',
  'JavaScript',
  'TypeScript',
  'C',
  'C++',
  'C#',
  'PHP',
  'Ruby',
  'Go',
  'Rust',
  'Swift',
  'Kotlin',
  'Scala',
  'R',
  'MATLAB',
  'Perl',
  'Lua',
  'Shell',
  'SQL',
] as const;

// 框架和库
export const FRAMEWORKS = [
  // Java
  'Spring',
  'Spring Boot',
  'MyBatis',
  'Hibernate',
  'Struts',
  // Python
  'Django',
  'Flask',
  'FastAPI',
  'Tornado',
  'Pyramid',
  // JavaScript/TypeScript
  'React',
  'Vue',
  'Angular',
  'Node.js',
  'Express',
  'Next.js',
  'Nuxt.js',
  'NestJS',
  // PHP
  'Laravel',
  'Symfony',
  'CodeIgniter',
  // Go
  'Gin',
  'Echo',
  'Beego',
  // Rust
  'Actix',
  'Rocket',
  // .NET
  'ASP.NET',
  'ASP.NET Core',
  // Mobile
  'React Native',
  'Flutter',
  // Other
  'Electron',
] as const;

// 数据库
export const DATABASES = [
  'MySQL',
  'PostgreSQL',
  'Oracle',
  'SQL Server',
  'MongoDB',
  'Redis',
  'Elasticsearch',
  'SQLite',
  'MariaDB',
  'Cassandra',
  'DynamoDB',
  'CouchDB',
] as const;

// 中间件和工具
export const MIDDLEWARE = [
  'Kafka',
  'RabbitMQ',
  'ActiveMQ',
  'Nginx',
  'Apache',
  'Tomcat',
  'Docker',
  'Kubernetes',
  'Jenkins',
  'Git',
  'Maven',
  'Gradle',
  'npm',
  'yarn',
  'pip',
] as const;

// 云服务
export const CLOUD_SERVICES = [
  'AWS',
  'Azure',
  'Google Cloud',
  'Alibaba Cloud',
  'Tencent Cloud',
  'Huawei Cloud',
] as const;

// 所有技术栈选项（合并）
export const ALL_TECHSTACK_OPTIONS = [
  ...PROGRAMMING_LANGUAGES,
  ...FRAMEWORKS,
  ...DATABASES,
  ...MIDDLEWARE,
  ...CLOUD_SERVICES,
] as const;

// 技术栈选项类型
export type TechStackOption = typeof ALL_TECHSTACK_OPTIONS[number];

// 按类别分组的技术栈选项
export const TECHSTACK_BY_CATEGORY = {
  languages: PROGRAMMING_LANGUAGES,
  frameworks: FRAMEWORKS,
  databases: DATABASES,
  middleware: MIDDLEWARE,
  cloud: CLOUD_SERVICES,
} as const;
