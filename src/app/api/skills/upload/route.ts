import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { AuditLogger } from '@/lib/audit/logger';
import { PERMISSIONS } from '@/types/permissions';
import { generateId } from '@/lib/id-generator';
import { getTenantIdForCreate } from '@/lib/tenant-filter';
import { quickDuplicateCheck, analyzeSkillPair } from '@/services/skill-governance';
import { logger, LOG_MODULES } from '@/lib/logger';
import { gitSkillSync } from '@/services/git-skill-sync';
import AdmZip from 'adm-zip';

interface ParsedSkill {
  name: string;
  displayName: string;
  description: string;
  content: string;
  cwe?: string;
}

function parseSkillMarkdown(content: string): ParsedSkill | null {
  try {
    let name = '';
    let description = '';
    let bodyContent = content;

    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      const nameMatch = frontmatter.match(/name:\s*(.+)/);
      const descMatch = frontmatter.match(/description:\s*(?:\n([\s\S]*?)\n\s*\S|$)|description:\s*(.+)/);
      
      if (nameMatch) name = nameMatch[1].trim();
      if (descMatch) {
        description = descMatch[1] ? descMatch[1].trim() : (descMatch[2] ? descMatch[2].trim() : '');
      }
      
      bodyContent = content.substring(frontmatterMatch[0].length);
    }

    const titleMatch = bodyContent.match(/^#\s+(.+)\s*\n/);
    let displayName = '';
    if (titleMatch) {
      displayName = titleMatch[1].trim();
    }

    if (!name) {
      const firstLine = bodyContent.split('\n')[0];
      name = firstLine.replace(/^#\s+/, '').toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '') || 'imported-skill';
    }

    if (!displayName) {
      displayName = name;
    }

    if (!description) {
      const lines = bodyContent.split('\n');
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && !line.startsWith('#') && !line.startsWith('-') && !line.startsWith('>')) {
          description = line.substring(0, 200);
          break;
        }
      }
      if (!description) description = displayName;
    }

    const cweMatch = content.match(/CWE-(\d+)/i);
    const cwe = cweMatch ? `CWE-${cweMatch[1]}` : undefined;

    return {
      name,
      displayName,
      description,
      content,
      cwe,
    };
  } catch (e) {
    logger.error(LOG_MODULES.SKILL, '解析 Skill 文件失败', { details: { error: e instanceof Error ? e.message : String(e) } });
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const auth = authenticateRequestEnhanced(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const { payload, tenant } = auth as AuthSuccessResult;

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const categoryId = formData.get('categoryId') as string;
    const vulnerabilityTreeId = formData.get('vulnerabilityTreeId') as string | null;
    const vulnerabilityTreeIdInt = vulnerabilityTreeId ? Number(vulnerabilityTreeId) : null;
    const vulnerabilityTreeIdStr = vulnerabilityTreeId || null;
    const productTagIdsStr = formData.get('productTagIds') as string;
    const isPublicStr = formData.get('isPublic') as string;
    const skillNameOverride = formData.get('skillName') as string | null;
    const skillDisplayNameOverride = formData.get('skillDisplayName') as string | null;
    const skillDescriptionOverride = formData.get('skillDescription') as string | null;

    if (!file) {
      return NextResponse.json({ details: { error: '请上传文件' } }, { status: 400 });
    }

    const isZip = file.name.toLowerCase().endsWith('.zip');
    const isMd = file.name.toLowerCase().endsWith('.md');

    if (!isZip && !isMd) {
      return NextResponse.json({ details: { error: '请上传 ZIP 压缩包或 Markdown (.md) 文件' } }, { status: 400 });
    }

    if (!categoryId) {
      return NextResponse.json({ details: { error: '请选择分类' } }, { status: 400 });
    }

    const skillCategory = await prisma.skillCategory.findUnique({ where: { id: categoryId } });
    if (!skillCategory) {
      return NextResponse.json({ details: { error: `分类 ID "${categoryId}" 不存在` } }, { status: 400 });
    }

    if (skillCategory.hasSubDimension && !vulnerabilityTreeIdStr) {
      return NextResponse.json(
        { details: { error: `分类 "${skillCategory.displayName}" 需要指定漏洞模式` } },
        { status: 400 }
      );
    }

    if (vulnerabilityTreeIdInt) {
      const treeNode = await prisma.attackPattern.findUnique({ where: { id: vulnerabilityTreeIdInt } });
      if (!treeNode || treeNode.is_valid !== 1) {
        return NextResponse.json({ details: { error: `漏洞模式 ID "${vulnerabilityTreeIdInt}" 无效` } }, { status: 400 });
      }
    }

    const isPublic = isPublicStr === 'true';
    const productTagIds = productTagIdsStr ? JSON.parse(productTagIdsStr) : [];

    const tenantId = getTenantIdForCreate(tenant, isPublic);

    let userId: string | null = null;
    if (isPublic) {
      if (!tenant.isIcsTenant && !tenant.isPlatformAdmin) {
        return NextResponse.json({ details: { error: '创建公共 Skill 需要管理员权限' } }, { status: 403 });
      }
      userId = null;
    } else {
      userId = payload.userId;
    }

    let skillContent: string;
    let zipFiles: Map<string, Buffer> | null = null;

    if (isZip) {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      const zip = new AdmZip(buffer);
      const zipEntries = zip.getEntries();
      
      const skillMdEntries = zipEntries.filter(e => !e.isDirectory && e.entryName.endsWith('SKILL.md') && e.entryName.split('/').length <= 2);
      
      if (skillMdEntries.length === 0) {
        return NextResponse.json({ 
          details: { error: 'ZIP 压缩包中未找到 SKILL.md 文件（仅支持根目录或单层子目录内的 SKILL.md）' } 
        }, { status: 400 });
      }

      if (skillMdEntries.length > 1) {
        return NextResponse.json({ 
          details: { error: 'ZIP 包含多个 SKILL.md，请逐个上传' } 
        }, { status: 400 });
      }

      const skillMdEntry = skillMdEntries[0];
      skillContent = skillMdEntry.getData().toString('utf-8');
      
      const skillMdPath = skillMdEntry.entryName;
      const skillDirPrefix = skillMdPath.includes('/') ? skillMdPath.substring(0, skillMdPath.lastIndexOf('/') + 1) : '';
      
      zipFiles = new Map();
      for (const entry of zipEntries) {
        if (!entry.isDirectory) {
          const entryPath = entry.entryName;
          if (!skillDirPrefix) {
            if (!entryPath.startsWith('__MACOSX') && !entryPath.includes('.DS_Store')) {
              zipFiles.set(entryPath, entry.getData());
            }
          } else if (entryPath.startsWith(skillDirPrefix)) {
            const relativePath = entryPath.substring(skillDirPrefix.length);
            if (relativePath && !relativePath.startsWith('__MACOSX') && !relativePath.includes('.DS_Store')) {
              zipFiles.set(relativePath, entry.getData());
            }
          }
        }
      }
    } else {
      skillContent = await file.text();
      zipFiles = new Map();
      zipFiles.set('SKILL.md', Buffer.from(skillContent, 'utf-8'));
    }

    const parsed = parseSkillMarkdown(skillContent);
    if (!parsed) {
      return NextResponse.json({ details: { error: '无法解析 Skill 文件，请检查文件格式' } }, { status: 400 });
    }

    const skillName = skillNameOverride?.trim() || parsed.name;
    const skillDisplayName = skillDisplayNameOverride?.trim() || parsed.displayName;
    const skillDescription = skillDescriptionOverride?.trim() || parsed.description;

    const existing = await prisma.skill.findFirst({
      where: {
        name: skillName,
        userId,
        tenantId: isPublic ? null : tenantId,
      },
    });
    if (existing) {
      return NextResponse.json(
        { details: { error: isPublic ? '公共 Skill 名称已存在' : '该 Skill 名称在平台已被注册' } },
        { status: 400 }
      );
    }

    const skill = await prisma.skill.create({
      data: {
        id: generateId('skill'),
        name: skillName,
        displayName: skillDisplayName,
        description: skillDescription,
        categoryId,
        vulnerabilityTreeId: vulnerabilityTreeIdInt,
        cwe: parsed.cwe || null,
        content: skillContent,
        userId,
        tenantId,
        isPublic,
        isBuiltin: false,
        version: 1,
        isLatest: true,
        updatedAt: new Date(),
        ...(productTagIds.length > 0 && {
          SkillProductTag: {
            create: productTagIds.map((tagId: string) => ({
              id: generateId('spt'),
              productTagId: tagId,
            })),
          },
        }),
      },
    });

    AuditLogger.log({
      userId: payload.userId,
      action: 'skill_create' as any,
      resource: skill.id,
      details: { name: skill.name, displayName: skillDisplayName, isPublic, source: 'upload' },
    }).catch(err => logger.errorWithUser(LOG_MODULES.SKILL, payload, '记录审计日志失败', skill.id, { details: { error: err instanceof Error ? err.message : String(err) } }));

    // Git 方式上传文件
    const gitResult = await gitSkillSync.uploadSkill(skillName, zipFiles);
    
    if (!gitResult.success) {
      logger.errorWithUser(LOG_MODULES.SKILL, payload, 'Git 上传文件失败', skill.id, { 
        details: { skillName, errors: gitResult.errors } 
      });
    }

    // 快速检测相似 Skill
    let governanceWarning: {
      isPotentialDuplicate: boolean;
      duplicates: Array<{
        skillId: string;
        skillName: string;
        displayName: string;
        confidence: number;
        overlapType?: string;
        reason?: string;
        recommendation?: string;
      }>;
    } = { isPotentialDuplicate: false, duplicates: [] };

    try {
      // 获取现有 Skill 列表进行快速检测
      const existingSkills = await prisma.skill.findMany({
        where: {
          id: { not: skill.id },
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          displayName: true,
          categoryId: true,
          vulnerabilityTreeId: true,
          cwe: true,
        },
      });

      const quickResult = quickDuplicateCheck(
        {
          id: skill.id,
          name: skill.name,
          displayName: skill.displayName,
          cwe: parsed.cwe,
          vulnerabilityPatternId: skill.vulnerabilityTreeId != null ? String(skill.vulnerabilityTreeId) : null,  // 添加漏洞模式
        },
        existingSkills.map(s => ({
          id: s.id,
          name: s.name,
          displayName: s.displayName,
          techStackId: null,
          vulnerabilityPatternId: s.vulnerabilityTreeId != null ? String(s.vulnerabilityTreeId) : null,
          cwe: s.cwe,
        }))
      );

      if (quickResult.isPotentialDuplicate && quickResult.duplicates.length > 0) {
        // 对高置信度的进行 LLM 深度分析（降低阈值以测试）
        const highConfidenceDuplicates = quickResult.duplicates.filter(d => d.confidence >= 0.5);
        
        for (const dup of highConfidenceDuplicates.slice(0, 3)) { // 只分析前3个
          const existingSkill = await prisma.skill.findUnique({
            where: { id: dup.skillId },
            select: { id: true, name: true, displayName: true, description: true, content: true, cwe: true },
          });

          if (existingSkill) {
            try {
              const analysisResult = await analyzeSkillPair(
                {
                  id: skill.id,
                  name: skill.name,
                  displayName: skill.displayName,
                  description: skillDescription,
                  content: skillContent.substring(0, 2000),
                  cwe: parsed.cwe,
                },
                {
                  id: existingSkill.id,
                  name: existingSkill.name,
                  displayName: existingSkill.displayName,
                  description: existingSkill.description,
                  content: existingSkill.content?.substring(0, 2000) || '',
                  cwe: existingSkill.cwe,
                }
              );

              governanceWarning.duplicates.push({
                skillId: dup.skillId,
                skillName: existingSkill.name,
                displayName: existingSkill.displayName,
                confidence: analysisResult.confidence,
                overlapType: analysisResult.overlapType,
                reason: analysisResult.llmReason,
                recommendation: analysisResult.recommendation,
              });

              governanceWarning.isPotentialDuplicate = analysisResult.isDuplicate;
            } catch (analysisErr) {
              logger.errorWithUser(LOG_MODULES.SKILL, payload, 'LLM 分析失败', skill.id, {
                details: { duplicateSkillId: dup.skillId, error: analysisErr instanceof Error ? analysisErr.message : String(analysisErr) }
              });
            }
          }
        }

        // 添加低置信度的潜在重复（不执行 LLM 分析）
        const lowConfidenceDuplicates = quickResult.duplicates.filter(d => d.confidence < 0.85);
        for (const dup of lowConfidenceDuplicates.slice(0, 5)) {
          governanceWarning.duplicates.push({
            skillId: dup.skillId,
            skillName: dup.skillName,
            displayName: dup.displayName,
            confidence: dup.confidence,
            reason: dup.reason,
          });
        }
      }
    } catch (govErr) {
      logger.errorWithUser(LOG_MODULES.SKILL, payload, '治理分析失败', skill.id, {
        details: { error: govErr instanceof Error ? govErr.message : String(govErr) }
      });
    }

    return NextResponse.json({ 
      skill,
      gitUpload: { 
        success: gitResult.success, 
        message: gitResult.message,
        errors: gitResult.errors 
      },
      governanceWarning,
    }, { status: 201 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '上传创建 Skill 错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}