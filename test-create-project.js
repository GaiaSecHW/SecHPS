const { PrismaClient } = require('@prisma/client');
const { claudeProjectManager } = require('./src/lib/claude-project-sync');

const prisma = new PrismaClient();

async function testCreateProject() {
  try {
    console.log('=== 测试创建 Claude 项目 ===\n');

    // 创建一个有意义的测试项目
    const testProject = {
      name: '我的测试项目-' + Date.now(),
      path: 'D:\\claude-web-platform\\uploads\\projects\\test-' + Date.now(),
      description: '这是一个测试项目，用于验证 Claude 同步功能'
    };

    console.log('项目信息:');
    console.log('  名称:', testProject.name);
    console.log('  路径:', testProject.path);
    console.log('  描述:', testProject.description);
    console.log();

    // 创建 Claude 项目
    const { claudeProjectDir, claudeProjectName } = await claudeProjectManager.createClaudeProject(
      testProject.name,
      testProject.path,
      {
        description: testProject.description,
        ai4webProjectId: 'test-' + Date.now()
      }
    );

    console.log('✅ Claude 项目创建成功!');
    console.log('  Claude 项目名称:', claudeProjectName);
    console.log('  Claude 项目目录:', claudeProjectDir);
    console.log();

    // 列出所有项目
    const projects = await claudeProjectManager.listClaudeProjects();
    console.log('当前所有 Claude 项目:');
    Object.entries(projects).forEach(([name, config]) => {
      console.log(`  - ${name}: ${config.originalPath}`);
    });

    await prisma.$disconnect();
  } catch (error) {
    console.error('错误:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

testCreateProject();
