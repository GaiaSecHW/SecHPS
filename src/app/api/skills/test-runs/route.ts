import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);
    
    if (!payload) {
      return NextResponse.json({ error: '无效的 token' }, { status: 401 });
    }

    const body = await request.json();
    const { testCase, skillData, runType } = body;

    if (!testCase || !skillData) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    // 模拟测试运行（实际应该调用 AI4WEB API 或 Python 脚本）
    const startTime = Date.now();
    
    // TODO: 实际实现应该：
    // 1. 如果 runType === 'with_skill'，使用 skillData.systemPrompt 和 skillData.userPrompt
    // 2. 如果 runType === 'without_skill'，使用默认提示词
    // 3. 调用 AI4WEB API 或 Claude API
    // 4. 收集输出和指标
    
    // 模拟输出
    const simulatedOutput = await simulateTestRun(testCase, skillData, runType);
    
    const duration = Date.now() - startTime;
    
    // 模拟 token 使用
    const tokens = Math.floor(Math.random() * 2000) + 500;

    return NextResponse.json({
      output: simulatedOutput,
      duration,
      tokens,
    });
  } catch (error) {
    console.error('测试运行失败:', error);
    return NextResponse.json(
      { error: '测试运行失败' },
      { status: 500 }
    );
  }
}

async function simulateTestRun(testCase: any, skillData: any, runType: string): Promise<string> {
  // 模拟 API 调用延迟
  await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 2000));

  // 根据是否有 Skill 生成不同的输出
  if (runType === 'with_skill') {
    return `## 安全审计报告

### 发现的问题
1. **SQL 注入漏洞** - 高危
   - 位置: UserController.java:45
   - 代码: \`String query = "SELECT * FROM users WHERE id = " + userId;\`
   - 影响: 攻击者可以执行任意 SQL 命令

2. **XSS 漏洞** - 中危
   - 位置: CommentRenderer.java:123
   - 代码: \`output += "<div>" + comment + "</div>";\`
   - 影响: 可能执行恶意脚本

### 风险等级
- 高危: 1
- 中危: 1
- 低危: 0

### 详细说明
SQL 注入漏洞存在于用户查询接口，攻击者可以通过构造特殊的 userId 参数来绕过认证或获取敏感数据。XSS 漏洞存在于评论渲染逻辑，未对用户输入进行转义。

### 修复建议
1. 使用参数化查询替代字符串拼接：
   \`PreparedStatement stmt = conn.prepareStatement("SELECT * FROM users WHERE id = ?");\`
   
2. 对用户输入进行 HTML 转义：
   \`output += "<div>" + StringEscapeUtils.escapeHtml4(comment) + "</div>";\`

### 统计
- 扫描文件数: 156
- 分析代码行数: 12,345
- 发现漏洞数: 2
- 扫描耗时: ${Date.now() % 1000 + 500}ms`;
  } else {
    return `## 代码审查结果

发现了以下问题：

1. 第45行有字符串拼接，可能有安全问题
2. 第123行有未转义的用户输入

建议进一步检查这些代码位置。`;
  }
}
