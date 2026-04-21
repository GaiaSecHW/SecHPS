/**
 * 跨项目会话搜索 API
 * 自动遍历所有 Claude 项目，搜索所有会话中的消息
 */

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { SessionManager, ProjectDiscovery } from '@/services/session-manager';
import { logger, LOG_MODULES } from '@/lib/logger';

// 搜索结果类型定义
interface SessionMatch {
  sessionId: string;
  matches: Array<{
    role: string;
    snippet: string;
    timestamp: string;
  }>;
}

interface ProjectSearchResult {
  projectName: string;
  projectPath: string;
  displayName: string;
  sessions: SessionMatch[];
}

interface SearchAllResponse {
  results: ProjectSearchResult[];
  totalMatches: number;
  query: string;
  projectsSearched: number;
}

// 跨项目搜索会话消息
export async function GET(request: Request) {
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const payload = auth.payload;

  try {
    // 2. 解析查询参数
    const url = new URL(request.url);
    const query = url.searchParams.get('query') || '';
    const limitPerProject = parseInt(url.searchParams.get('limit') || '20', 10);
    const maxResults = parseInt(url.searchParams.get('maxResults') || '200', 10);

    if (!query) {
      return NextResponse.json({ error: '缺少查询参数' }, { status: 400 });
    }

    // 3. 发现所有项目
    const discovery = new ProjectDiscovery();
    const projects = await discovery.discoverProjects();

    if (projects.length === 0) {
      return NextResponse.json({
        results: [],
        totalMatches: 0,
        query,
        projectsSearched: 0,
      });
    }

    // 4. 对每个项目执行搜索
    const results: ProjectSearchResult[] = [];
    let totalMatches = 0;
    let reachedMaxResults = false;

    for (const project of projects) {
      if (reachedMaxResults) {
        break;
      }

      try {
        const sessionManager = new SessionManager(project.path);
        const searchResults = await sessionManager.searchMessages(query, limitPerProject);

        if (searchResults.length > 0) {
          // 计算匹配总数
          const projectMatchCount = searchResults.reduce(
            (sum, session) => sum + session.matches.length,
            0
          );

          results.push({
            projectName: project.name,
            projectPath: project.path,
            displayName: project.displayName,
            sessions: searchResults,
          });

          totalMatches += projectMatchCount;

          // 检查是否达到最大结果限制
          if (totalMatches >= maxResults) {
            reachedMaxResults = true;
          }
        }
      } catch (error) {
        // 单个项目搜索失败，继续搜索其他项目
        logger.errorNoUser(LOG_MODULES.SESSION, `搜索项目 ${project.name} 时出错`, { details: { projectPath: project.path, error: error instanceof Error ? error.message : String(error) } });
      }
    }

    // 5. 返回结果
    const response: SearchAllResponse = {
      results,
      totalMatches,
      query,
      projectsSearched: projects.length,
    };

    return NextResponse.json(response);
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SESSION, '跨项目搜索会话消息错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
