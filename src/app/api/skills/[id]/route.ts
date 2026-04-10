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

    return NextResponse.json({ skill });
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
    // 管理员可以修改任何 Skill
    const isAdmin = hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE);
    
    if (!isAdmin) {
      // 非管理员只能修改自己的私有 Skill
      if (skill.userId === null) {
        return NextResponse.json({ error: '禁止访问 - 修改公共 Skill 需要管理员权限' }, { status: 403 });
      }
      if (skill.userId !== payload.userId) {
        return NextResponse.json({ error: '禁止访问 - 只能修改自己的私有 Skill' }, { status: 403 });
      }
    }

    // 管理员可以修改内置 Skill，普通用户不能修改
    if (skill.isBuiltin && !isAdmin) {
      return NextResponse.json({ error: '内置 Skill 只有管理员可以修改' }, { status: 400 });
    }

    // 管理员可以修改任何版本，普通用户只能修改最新版本
    if (!skill.isLatest && !isAdmin) {
      return NextResponse.json({ error: '只能修改最新版本的 Skill' }, { status: 400 });
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
      if (updates.content !== undefined) updateData.content = updates.content;
      if (updates.isActive !== undefined) updateData.isActive = updates.isActive;
      // 处理技术栈
      if (updates.techStack !== undefined) {
        updateData.techStack = updates.techStack && Array.isArray(updates.techStack) && updates.techStack.length > 0
          ? JSON.stringify(updates.techStack)
          : null;
      }

      // 创建新版本
      updatedSkill = await prisma.skill.create({
        data: {
          name: skill.name,
          displayName: (updateData.displayName as string) ?? skill.displayName,
          description: (updateData.description as string) ?? skill.description,
          category: (updateData.category as string) ?? skill.category,
          techStack: (updateData.techStack as string | null) ?? skill.techStack,
          cwe: (updateData.cwe as string | null) ?? skill.cwe,
          content: (updateData.content as string) ?? skill.content,
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
        content: skill.content,
      };

      const afterData = {
        displayName: updatedSkill.displayName,
        description: updatedSkill.description,
        content: updatedSkill.content,
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
      if (updates.content !== undefined) updateData.content = updates.content;
      if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

      updatedSkill = await prisma.skill.update({
        where: { id },
        data: updateData,
      });

      // 双写：根据 isActive 状态同步磁盘文件
      if (updates.isActive !== undefined) {
        if (updatedSkill.isActive) {
          // 启用：保存到磁盘
          saveSkillToDisk(updatedSkill).catch(err => {
            console.error('[Skills API] 更新磁盘文件失败:', err);
          });
        } else {
          // 禁用：从磁盘删除
          deleteSkillFromDisk(updatedSkill.name, updatedSkill.userId).catch(err => {
            console.error('[Skills API] 删除磁盘文件失败:', err);
          });
        }
      } else {
        // 其他更新：直接保存
        saveSkillToDisk(updatedSkill).catch(err => {
          console.error('[Skills API] 更新磁盘文件失败:', err);
        });
      }
    }

    return NextResponse.json({ skill: updatedSkill });
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
    // 管理员可以删除任何 Skill
    const isAdmin = hasPermission(payload.permissions, PERMISSIONS.CONFIG_DELETE);
    
    if (!isAdmin) {
      // 非管理员只能删除自己的私有 Skill
      if (skill.userId === null) {
        return NextResponse.json({ error: '禁止访问 - 删除公共 Skill 需要管理员权限' }, { status: 403 });
      }
      if (skill.userId !== payload.userId) {
        return NextResponse.json({ error: '禁止访问 - 只能删除自己的私有 Skill' }, { status: 403 });
      }
    }

    // 管理员可以删除内置 Skill，普通用户不能删除
    if (skill.isBuiltin && !isAdmin) {
      return NextResponse.json({ error: '内置 Skill 只有管理员可以删除' }, { status: 400 });
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
