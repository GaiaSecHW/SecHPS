/**
 * 删除项目 API
 * 
 * DELETE: 从项目配置中移除项目
 * 不删除实际的 JSONL 文件
 */

import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

/**
 * 加载项目配置
 */
async function loadProjectConfig(): Promise<Record<string, any>> {
  const configPath = path.join(os.homedir(), '.claude', 'project-config.json');
  try {
    const configData = await fs.readFile(configPath, 'utf8');
    return JSON.parse(configData);
  } catch {
    return {};
  }
}

/**
 * 保存项目配置
 */
async function saveProjectConfig(config: Record<string, any>): Promise<void> {
  const claudeDir = path.join(os.homedir(), '.claude');
  const configPath = path.join(claudeDir, 'project-config.json');

  await fs.mkdir(claudeDir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name: projectName } = await params;
    const decodedProjectName = decodeURIComponent(projectName);

    // 加载配置
    const config = await loadProjectConfig();

    // 检查项目是否存在
    if (!config[decodedProjectName]) {
      return NextResponse.json(
        { error: '项目不存在' },
        { status: 404 }
      );
    }

    // 检查项目是否是手动添加的
    const isManuallyAdded = config[decodedProjectName]?.manuallyAdded === true;

    // 如果不是手动添加的项目，也检查是否有对应的目录
    if (!isManuallyAdded) {
      const projectDir = path.join(os.homedir(), '.claude', 'projects', decodedProjectName);
      try {
        await fs.access(projectDir);
        // 目录存在，询问是否删除
        // 为了安全，只删除配置，不删除目录
        // 用户需要手动确认删除会话文件
      } catch {
        // 目录不存在，只从配置中移除
      }
    }

    // 从配置中移除
    delete config[decodedProjectName];
    await saveProjectConfig(config);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('删除项目错误:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}

/**
 * 获取项目详情
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name: projectName } = await params;
    const decodedProjectName = decodeURIComponent(projectName);

    // 加载配置
    const config = await loadProjectConfig();

    // 检查项目是否存在
    if (!config[decodedProjectName]) {
      return NextResponse.json(
        { error: '项目不存在' },
        { status: 404 }
      );
    }

    const projectConfig = config[decodedProjectName];

    return NextResponse.json({
      name: decodedProjectName,
      path: projectConfig.originalPath || '',
      displayName: projectConfig.displayName || decodedProjectName,
      config: projectConfig,
    });
  } catch (error) {
    console.error('获取项目详情错误:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}
