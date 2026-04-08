#!/usr/bin/env node
/**
 * 测试 Claude 项目同步功能
 * 用法: node test-claude-sync.js
 */

const { claudeProjectManager } = require('./src/lib/claude-project-sync');

async function testClaudeSync() {
  console.log('='.repeat(60));
  console.log('测试 Claude 项目同步功能');
  console.log('='.repeat(60));

  try {
    // 测试 1: 创建 Claude 项目
    console.log('\n[测试 1] 创建 Claude 项目...');
    const testProject = {
      name: '测试项目-' + Date.now(),
      path: '/tmp/test-project-' + Date.now(),
      description: '这是一个测试项目',
      ai4webProjectId: 'test-id-' + Date.now(),
    };

    const { claudeProjectDir, claudeProjectName } = await claudeProjectManager.createClaudeProject(
      testProject.name,
      testProject.path,
      {
        description: testProject.description,
        ai4webProjectId: testProject.ai4webProjectId,
      }
    );

    console.log('✅ 创建成功:');
    console.log('   - Claude 项目名称:', claudeProjectName);
    console.log('   - Claude 项目目录:', claudeProjectDir);
    console.log('   - 原始路径:', testProject.path);

    // 测试 2: 列出所有 Claude 项目
    console.log('\n[测试 2] 列出所有 Claude 项目...');
    const projects = await claudeProjectManager.listClaudeProjects();
    console.log('✅ 找到', Object.keys(projects).length, '个项目:');
    Object.entries(projects).forEach(([name, config]) => {
      console.log(`   - ${name}: ${config.originalPath}`);
    });

    // 测试 3: 根据名称查找项目
    console.log('\n[测试 3] 根据名称查找项目...');
    const foundByName = await claudeProjectManager.findClaudeProjectByName(testProject.name);
    console.log(foundByName ? '✅ 找到项目: ' + foundByName : '❌ 未找到项目');

    // 测试 4: 根据 ID 查找项目
    console.log('\n[测试 4] 根据 ID 查找项目...');
    const foundById = await claudeProjectManager.findClaudeProjectById(testProject.ai4webProjectId);
    console.log(foundById ? '✅ 找到项目: ' + foundById : '❌ 未找到项目');

    // 测试 5: 更新项目
    console.log('\n[测试 5] 更新项目配置...');
    await claudeProjectManager.updateClaudeProject(claudeProjectName, {
      metadata: {
        name: testProject.name + '-updated',
        description: '已更新的描述',
      },
    });
    console.log('✅ 更新成功');

    // 测试 6: 验证更新
    console.log('\n[测试 6] 验证更新...');
    const updatedProjects = await claudeProjectManager.listClaudeProjects();
    const updatedProject = updatedProjects[claudeProjectName];
    console.log('✅ 更新后的描述:', updatedProject?.metadata?.description);

    // 测试 7: 删除项目
    console.log('\n[测试 7] 删除项目...');
    await claudeProjectManager.deleteClaudeProject(claudeProjectName);
    console.log('✅ 删除成功');

    // 测试 8: 验证删除
    console.log('\n[测试 8] 验证删除...');
    const afterDelete = await claudeProjectManager.listClaudeProjects();
    const deleted = !afterDelete[claudeProjectName];
    console.log(deleted ? '✅ 项目已被删除' : '❌ 项目仍然存在');

    console.log('\n' + '='.repeat(60));
    console.log('✅ 所有测试通过！');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('\n❌ 测试失败:', error);
    process.exit(1);
  }
}

// 运行测试
testClaudeSync().catch((error) => {
  console.error('测试脚本执行失败:', error);
  process.exit(1);
});
