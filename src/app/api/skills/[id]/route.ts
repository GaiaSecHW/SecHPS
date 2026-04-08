// src/app/api/skills/[id]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { saveSkillToDisk, deleteSkillFromDisk } from '@/services/skill-files';

// GET /api/skills/:id - 获取 Skill 详情
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { id } = await params;

    const skill = await prisma.skill.findUnique({
      where: { id },
      include: {
        executions: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
        evolutions: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
        parent: true,  // 父版本
        versions: {    // 子版本
          take: 5,
          orderBy: { version: 'desc' },
        },
      },
    });

    if (!skill) {
      return NextResponse.json({ error: 'Skill 不存在' }, { status: 404 });
    }

    // 检查访问权限：私有 Skill 只有创建者可以访问
    if (skill.userId && skill.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    return NextResponse.json({
      skill: {
        ...skill,
        tools: JSON.parse(skill.tools),
        parameters: JSON.parse(skill.parameters),
        executions: skill.executions.map(e => ({
          ...e,
          input: JSON.parse(e.input),
          output: e.output ? JSON.parse(e.output) : null,
        })),
        evolutions: skill.evolutions.map(ev => ({
          ...ev,
          beforeData: JSON.parse(ev.beforeData),
          afterData: JSON.parse(ev.afterData),
        })),
      },
    });
  } catch (error) {
    console.error('获取 Skill 详情错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// PUT /api/skills/:id - 更新 Skill
// 支持两种模式：
// 1. 直接更新（默认）：修改当前版本
// 2. 创建新版本（createVersion=true）：创建新版本并记录进化历史
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { createVersion, changeType, changeDesc, reason, ...updates } = body;

    const skill = await prisma.skill.findUnique({ where: { id } });
    if (!skill) {
      return NextResponse.json({ error: 'Skill 不存在' }, { status: 404 });
    }

    // 检查权限
    // 1. 公共 Skill 需要管理员权限
    // 2. 私有 Skill 只有创建者可以修改
    if (skill.userId === null) {
      if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
        return NextResponse.json({ error: '禁止访问 - 修改公共 Skill 需要管理员权限' }, { status: 403 });
      }
    } else if (skill.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问 - 只能修改自己的私有 Skill' }, { status: 403 });
    }

    // 内置 Skill 不能修改
    if (skill.isBuiltin) {
      return NextResponse.json({ error: '内置 Skill 不能修改' }, { status: 400 });
    }

    // 只能修改最新版本
    if (!skill.isLatest) {
      return NextResponse.json({ error: '只能修改最新版本，请先切换到最新版本' }, { status: 400 });
    }

    let updatedSkill;

    if (createVersion) {
      // 创建新版本模式
      if (!changeType || !changeDesc || !reason) {
        return NextResponse.json(
          { error: '创建新版本需要提供 changeType, changeDesc, reason' },
          { status: 400 }
        );
      }

      // 将当前版本标记为非最新
      await prisma.skill.update({
        where: { id },
        data: { isLatest: false },
      });

      // 构建更新数据
      const updateData: Record<string, unknown> = {};
      if (updates.displayName !== undefined) updateData.displayName = updates.displayName;
      if (updates.description !== undefined) updateData.description = updates.description;
      if (updates.category !== undefined) updateData.category = updates.category;
      if (updates.cwe !== undefined) updateData.cwe = updates.cwe;
      if (updates.severity !== undefined) updateData.severity = updates.severity;
      if (updates.systemPrompt !== undefined) updateData.systemPrompt = updates.systemPrompt;
      if (updates.userPrompt !== undefined) updateData.userPrompt = updates.userPrompt;
      if (updates.tools !== undefined) updateData.tools = JSON.stringify(updates.tools);
      if (updates.parameters !== undefined) updateData.parameters = JSON.stringify(updates.parameters);
      if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

      // 创建新版本
      updatedSkill = await prisma.skill.create({
        data: {
          name: skill.name,
          displayName: (updateData.displayName as string) ?? skill.displayName,
          description: (updateData.description as string) ?? skill.description,
          category: (updateData.category as string) ?? skill.category,
          cwe: (updateData.cwe as string | null) ?? skill.cwe,
          severity: (updateData.severity as string) ?? skill.severity,
          systemPrompt: (updateData.systemPrompt as string) ?? skill.systemPrompt,
          userPrompt: (updateData.userPrompt as string) ?? skill.userPrompt,
          tools: (updateData.tools as string) ?? skill.tools,
          parameters: (updateData.parameters as string) ?? skill.parameters,
          userId: skill.userId,
          isBuiltin: skill.isBuiltin,
          isActive: (updateData.isActive as boolean) ?? skill.isActive,
          version: skill.version + 1,
          parentId: skill.id,
          isLatest: true,
          successRate: skill.successRate,
          avgDuration: skill.avgDuration,
          execCount: skill.execCount,
        },
      });

      // 记录进化历史
      const beforeData = {
        displayName: skill.displayName,
        description: skill.description,
        systemPrompt: skill.systemPrompt,
        userPrompt: skill.userPrompt,
        tools: JSON.parse(skill.tools),
        parameters: JSON.parse(skill.parameters),
      };

      const afterData = {
        displayName: updatedSkill.displayName,
        description: updatedSkill.description,
        systemPrompt: updatedSkill.systemPrompt,
        userPrompt: updatedSkill.userPrompt,
        tools: JSON.parse(updatedSkill.tools),
        parameters: JSON.parse(updatedSkill.parameters),
      };

      await prisma.skillEvolution.create({
        data: {
          skillId: updatedSkill.id,
          fromVersion: skill.version,
          toVersion: updatedSkill.version,
          changeType,
          changeDesc,
          beforeData: JSON.stringify(beforeData),
          afterData: JSON.stringify(afterData),
          reason,
          beforeRate: skill.successRate,
          afterRate: updatedSkill.successRate,
        },
      });

      // 双写：同步保存新版本到磁盘
      saveSkillToDisk(updatedSkill).catch(err => {
        console.error('[Skills API] 保存新版本到磁盘失败:', err);
      });
    } else {
      // 直接更新模式
      const updateData: Record<string, unknown> = {};
      if (updates.displayName !== undefined) updateData.displayName = updates.displayName;
      if (updates.description !== undefined) updateData.description = updates.description;
      if (updates.category !== undefined) updateData.category = updates.category;
      if (updates.cwe !== undefined) updateData.cwe = updates.cwe;
      if (updates.severity !== undefined) updateData.severity = updates.severity;
      if (updates.systemPrompt !== undefined) updateData.systemPrompt = updates.systemPrompt;
      if (updates.userPrompt !== undefined) updateData.userPrompt = updates.userPrompt;
      if (updates.tools !== undefined) updateData.tools = JSON.stringify(updates.tools);
      if (updates.parameters !== undefined) updateData.parameters = JSON.stringify(updates.parameters);
      if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

      updatedSkill = await prisma.skill.update({
        where: { id },
        data: updateData,
      });

      // 双写：同步更新磁盘文件
      saveSkillToDisk(updatedSkill).catch(err => {
        console.error('[Skills API] 更新磁盘文件失败:', err);
      });
    }

    return NextResponse.json({
      skill: {
        ...updatedSkill,
        tools: JSON.parse(updatedSkill.tools),
        parameters: JSON.parse(updatedSkill.parameters),
      },
    });
  } catch (error) {
    console.error('更新 Skill 错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/skills/:id - 删除 Skill
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { id } = await params;

    const skill = await prisma.skill.findUnique({ where: { id } });
    if (!skill) {
      return NextResponse.json({ error: 'Skill 不存在' }, { status: 404 });
    }

    // 检查权限
    // 1. 公共 Skill 需要管理员权限
    // 2. 私有 Skill 只有创建者可以删除
    if (skill.userId === null) {
      if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_DELETE)) {
        return NextResponse.json({ error: '禁止访问 - 删除公共 Skill 需要管理员权限' }, { status: 403 });
      }
    } else if (skill.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问 - 只能删除自己的私有 Skill' }, { status: 403 });
    }

    if (skill.isBuiltin) {
      return NextResponse.json(
        { error: '内置 Skill 不能删除' },
        { status: 400 }
      );
    }

    // 删除 Skill 及其所有版本
    await prisma.$transaction(async (tx) => {
      // 删除所有进化记录
      await tx.skillEvolution.deleteMany({
        where: {
          OR: [
            { skillId: id },
            { skill: { parentId: id } },
          ],
        },
      });

      // 删除所有子版本
      await tx.skill.deleteMany({
        where: { parentId: id },
      });

      // 删除当前版本
      await tx.skill.delete({ where: { id } });
    });

    // 双写：同步删除磁盘文件
    deleteSkillFromDisk(skill.name, skill.userId).catch(err => {
      console.error('[Skills API] 删除磁盘文件失败:', err);
    });

    return NextResponse.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除 Skill 错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
