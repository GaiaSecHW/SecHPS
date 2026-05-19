'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

// --- Types ---
interface ApiParam {
  name: string;
  type: string;
  required?: boolean;
  desc: string;
}

interface ApiEndpoint {
  method: string;
  path: string;
  desc: string;
  requestParams?: ApiParam[];
  requestBody?: ApiParam[];
  response?: ApiParam[];
}

// --- ApiDocCard ---
function ApiDocCard({ endpoint }: { endpoint: ApiEndpoint }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center space-x-3 p-4 bg-[#0F172A] hover:bg-dark-surface-hover transition-colors"
      >
        <span className={`px-2 py-0.5 text-xs font-medium rounded ${
          endpoint.method === 'GET' ? 'bg-green-500/15 text-green-400' :
          endpoint.method === 'POST' ? 'bg-blue-500/15 text-blue-400' :
          endpoint.method === 'PATCH' ? 'bg-yellow-500/15 text-yellow-400' :
          'bg-red-500/15 text-red-400'
        }`}>
          {endpoint.method}
        </span>
        <code className="text-sm text-gray-200 font-mono flex-1 text-left">{endpoint.path}</code>
        <span className="text-sm text-gray-500">{endpoint.desc}</span>
        {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>

      {expanded && (
        <div className="p-4 space-y-4 border-t">
          {endpoint.requestParams && endpoint.requestParams.length > 0 && (
            <div>
              <h5 className="text-xs font-medium text-gray-500 uppercase mb-2">URL 参数</h5>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400">
                    <th className="pb-1">参数</th>
                    <th className="pb-1">类型</th>
                    <th className="pb-1">必填</th>
                    <th className="pb-1">说明</th>
                  </tr>
                </thead>
                <tbody className="text-gray-300">
                  {endpoint.requestParams.map((p) => (
                    <tr key={p.name} className="border-t">
                      <td className="py-2 font-mono text-blue-400">{p.name}</td>
                      <td className="py-2 text-gray-500">{p.type}</td>
                      <td className="py-2">{p.required ? <span className="text-red-500">是</span> : <span className="text-gray-400">否</span>}</td>
                      <td className="py-2">{p.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {endpoint.requestBody && endpoint.requestBody.length > 0 && (
            <div>
              <h5 className="text-xs font-medium text-gray-500 uppercase mb-2">请求体 (JSON)</h5>
              <pre className="bg-gray-900 text-cyan-400 p-3 rounded text-xs overflow-x-auto border border-gray-700">
{JSON.stringify(
  endpoint.requestBody.reduce((acc, p) => ({ ...acc, [p.name]: p.type }), {}),
  null, 2
)}
              </pre>
              <table className="w-full text-sm mt-2">
                <thead>
                  <tr className="text-left text-gray-400">
                    <th className="pb-1">字段</th>
                    <th className="pb-1">类型</th>
                    <th className="pb-1">必填</th>
                    <th className="pb-1">说明</th>
                  </tr>
                </thead>
                <tbody className="text-gray-300">
                  {endpoint.requestBody.map((p) => (
                    <tr key={p.name} className="border-t">
                      <td className="py-2 font-mono text-blue-400">{p.name}</td>
                      <td className="py-2 text-gray-500">{p.type}</td>
                      <td className="py-2">{p.required ? <span className="text-red-500">是</span> : <span className="text-gray-400">否</span>}</td>
                      <td className="py-2">{p.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {endpoint.response && endpoint.response.length > 0 && (
            <div>
              <h5 className="text-xs font-medium text-gray-500 uppercase mb-2">响应示例</h5>
              <pre className="bg-gray-900 text-cyan-400 p-3 rounded text-xs overflow-x-auto border border-gray-700">
{JSON.stringify(
  endpoint.response.reduce((acc, p) => ({ ...acc, [p.name]: p.type }), {}),
  null, 2
)}
              </pre>
              <table className="w-full text-sm mt-2">
                <thead>
                  <tr className="text-left text-gray-400">
                    <th className="pb-1">字段</th>
                    <th className="pb-1">类型</th>
                    <th className="pb-1">说明</th>
                  </tr>
                </thead>
                <tbody className="text-gray-300">
                  {endpoint.response.map((p) => (
                    <tr key={p.name} className="border-t">
                      <td className="py-2 font-mono text-blue-400">{p.name}</td>
                      <td className="py-2 text-gray-500">{p.type}</td>
                      <td className="py-2">{p.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- API docs data ---
const apiDocs = [
  {
    category: '认证方式',
    description: '所有 API 请求需在 Header 中携带 API Key：\n\n```\nAuthorization: Bearer icsl-xxxxxxxxxxxxxxxx\n```\n\n- 认证失败返回 `401 Unauthorized`\n- 权限不足返回 `403 Forbidden`\n- 限频返回 `429 Too Many Requests`\n- 资源不存在返回 `404 Not Found`',
    endpoints: [],
  },
  {
    category: 'Agent 查询',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/agents',
        desc: '获取当前 API Key 授权访问的 Agent 列表',
        response: [
          { name: 'agents', type: 'Agent[]', desc: 'Agent 数组，每项含 id/name/engine/description' },
        ],
      } as ApiEndpoint,
    ],
  },
  {
    category: '任务管理',
    endpoints: [
      {
        method: 'POST',
        path: '/api/v1/tasks',
        desc: '创建任务',
        requestBody: [
          { name: 'agentId', type: 'string', required: true, desc: 'Agent ID（必须在 API Key 授权范围内）' },
          { name: 'name', type: 'string', required: true, desc: '任务名称' },
          { name: 'notes', type: 'string', required: true, desc: '任务描述/指令' },
          { name: 'modelId', type: 'string', required: false, desc: '模型 ID' },
          { name: 'modelName', type: 'string', required: false, desc: '模型名称' },
          { name: 'parameters', type: 'object', required: false, desc: '额外参数 (JSON)' },
          { name: 'fileUrls', type: 'string[]', required: false, desc: '附件 URL 列表（JSON 模式下使用）' },
        ],
        response: [
          { name: 'taskId', type: 'string', desc: '任务 ID' },
          { name: 'status', type: 'string', desc: '初始状态 (pending)' },
          { name: 'createdAt', type: 'string', desc: '创建时间 (ISO 8601)' },
        ],
      },
      {
        method: 'GET',
        path: '/api/v1/tasks',
        desc: '分页获取任务列表',
        requestParams: [
          { name: 'page', type: 'number', required: false, desc: '页码（默认 1）' },
          { name: 'limit', type: 'number', required: false, desc: '每页数量（默认 10）' },
          { name: 'status', type: 'string', required: false, desc: '按状态筛选（pending/running/completed/failed）' },
        ],
        response: [
          { name: 'tasks', type: 'Task[]', desc: '任务数组' },
          { name: 'pagination', type: 'object', desc: '{ total, page, limit, totalPages }' },
        ],
      },
      {
        method: 'GET',
        path: '/api/v1/tasks/:taskId/status',
        desc: '查询任务实时状态',
        requestParams: [
          { name: 'taskId', type: 'string', required: true, desc: '任务 ID' },
        ],
        response: [
          { name: 'taskId', type: 'string', desc: '任务 ID' },
          { name: 'status', type: 'string', desc: '当前状态' },
          { name: 'startedAt', type: 'string', desc: '开始时间' },
          { name: 'completedAt', type: 'string', desc: '完成时间' },
          { name: 'errorMessage', type: 'string', desc: '错误信息（如有）' },
          { name: 'inputTokens', type: 'number', desc: '输入 Token 数' },
          { name: 'outputTokens', type: 'number', desc: '输出 Token 数' },
          { name: 'totalTokens', type: 'number', desc: '总 Token 数' },
        ],
      },
      {
        method: 'GET',
        path: '/api/v1/tasks/:taskId/result',
        desc: '获取任务执行结果',
        requestParams: [
          { name: 'taskId', type: 'string', required: true, desc: '任务 ID' },
        ],
        response: [
          { name: 'taskId', type: 'string', desc: '任务 ID' },
          { name: 'status', type: 'string', desc: '当前状态' },
          { name: 'executionResult', type: 'object', desc: '执行结果（自动 JSON 解析）' },
          { name: 'startedAt', type: 'string', desc: '开始时间' },
          { name: 'completedAt', type: 'string', desc: '完成时间' },
          { name: 'inputTokens', type: 'number', desc: '输入 Token 数' },
          { name: 'outputTokens', type: 'number', desc: '输出 Token 数' },
        ],
      },
      {
        method: 'GET',
        path: '/api/v1/tasks/:taskId/report',
        desc: '下载任务报告文件',
        requestParams: [
          { name: 'taskId', type: 'string', required: true, desc: '任务 ID' },
        ],
        response: [
          { name: '(binary)', type: 'file', desc: '报告文件流，Content-Type 自动判断' },
        ],
      },
      {
        method: 'POST',
        path: '/api/v1/tasks/:taskId/stop',
        desc: '停止运行中的任务',
        requestParams: [
          { name: 'taskId', type: 'string', required: true, desc: '任务 ID' },
        ],
        response: [
          { name: 'taskId', type: 'string', desc: '任务 ID' },
          { name: 'status', type: 'string', desc: '最终状态 (failed)' },
          { name: 'message', type: 'string', desc: '操作结果' },
        ],
      },
    ],
  },
  {
    category: '漏洞提交',
    endpoints: [
      {
        method: 'POST',
        path: '/api/v1/vulnerabilities',
        desc: '批量创建漏洞记录（上限 100 条/次）',
        requestBody: [
          { name: 'projectId', type: 'string', required: true, desc: '所属项目 ID' },
          { name: 'filePath', type: 'string', required: true, desc: 'AUDIT_REPORT.md 文件完整路径' },
          { name: 'evaluationId', type: 'string', required: false, desc: '关联评估会话 ID' },
          { name: 'skillExecutionId', type: 'string', required: false, desc: '关联 Skill 执行记录 ID' },
          { name: 'vulnerabilities', type: 'array', required: true, desc: '漏洞数组（1~100 条）' },
          { name: 'vulnerabilities[].title', type: 'string', required: true, desc: '漏洞标题' },
          { name: 'vulnerabilities[].type', type: 'string', required: true, desc: '漏洞类型（如 sql-injection）' },
          { name: 'vulnerabilities[].description', type: 'string', required: false, desc: '漏洞描述（默认空字符串）' },
          { name: 'vulnerabilities[].severity', type: 'string', required: false, desc: '严重程度（默认 medium，自动标准化）' },
          { name: 'vulnerabilities[].cwe', type: 'string', required: false, desc: 'CWE 编号' },
          { name: 'vulnerabilities[].skill', type: 'string', required: false, desc: '发现漏洞的 Skill 名称' },
          { name: 'vulnerabilities[].location', type: 'string', required: false, desc: '问题代码位置' },
          { name: 'vulnerabilities[].POC', type: 'string', required: false, desc: 'POC 验证代码' },
          { name: 'vulnerabilities[].vulnerable', type: 'boolean', required: false, desc: '是否确认存在漏洞（默认 true）' },
          { name: 'vulnerabilities[].fixSuggestion', type: 'string', required: false, desc: '修复建议' },
          { name: 'vulnerabilities[].rawReport', type: 'string', required: false, desc: '原始扫描报告文件内容' },
        ],
        response: [
          { name: 'created', type: 'array', desc: '创建成功的漏洞列表 [{id, title, type, severity}]' },
          { name: 'skipped', type: 'array', desc: '跳过的漏洞列表 [{title, type, reason}]' },
          { name: 'summary', type: 'object', desc: '{ total, created, skipped }' },
        ],
      } as ApiEndpoint,
    ],
  },
];

export default function SdkPage() {
  return (
    <div className="space-y-6">
      {/* 接口文档 */}
      {apiDocs.map((section) => (
        <div key={section.category}>
          {section.description ? (
            <div className="bg-blue-900/20 border border-blue-700/40 rounded-lg p-4">
              <h3 className="text-sm font-medium text-blue-400 mb-2">{section.category}</h3>
              <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono">{section.description}</pre>
            </div>
          ) : (
            <>
              <h3 className="text-lg font-medium text-gray-200 mb-3">{section.category}</h3>
              <div className="space-y-2">
                {section.endpoints.map((ep) => (
                  <ApiDocCard key={`${ep.method}-${ep.path}`} endpoint={ep} />
                ))}
              </div>
            </>
          )}
        </div>
      ))}

      {/* 错误码说明 */}
      <div className="bg-dark-surface rounded-lg p-6 border border-gray-700/50">
        <h3 className="text-lg font-medium text-gray-200 mb-3">错误码说明</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-700">
              <th className="pb-2">HTTP 状态码</th>
              <th className="pb-2">错误码</th>
              <th className="pb-2">说明</th>
            </tr>
          </thead>
          <tbody className="text-gray-300">
            <tr className="border-t border-gray-800">
              <td className="py-2 font-mono text-yellow-400">400</td>
              <td className="py-2 font-mono">INVALID_REQUEST</td>
              <td className="py-2">请求参数错误（缺少必填字段、格式错误等）</td>
            </tr>
            <tr className="border-t border-gray-800">
              <td className="py-2 font-mono text-red-400">401</td>
              <td className="py-2 font-mono">UNAUTHORIZED</td>
              <td className="py-2">认证失败（API Key 缺失、无效或已撤销）</td>
            </tr>
            <tr className="border-t border-gray-800">
              <td className="py-2 font-mono text-red-400">403</td>
              <td className="py-2 font-mono">FORBIDDEN</td>
              <td className="py-2">权限不足（租户不匹配或无权访问指定资源）</td>
            </tr>
            <tr className="border-t border-gray-800">
              <td className="py-2 font-mono text-gray-400">404</td>
              <td className="py-2 font-mono">NOT_FOUND</td>
              <td className="py-2">资源不存在</td>
            </tr>
            <tr className="border-t border-gray-800">
              <td className="py-2 font-mono text-orange-400">429</td>
              <td className="py-2 font-mono">RATE_LIMITED</td>
              <td className="py-2">请求频率超限</td>
            </tr>
            <tr className="border-t border-gray-800">
              <td className="py-2 font-mono text-red-500">500</td>
              <td className="py-2 font-mono">INTERNAL_ERROR</td>
              <td className="py-2">服务器内部错误</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 任务状态流转 */}
      <div className="bg-dark-surface rounded-lg p-6 border border-gray-700/50">
        <h3 className="text-lg font-medium text-gray-200 mb-3">任务状态流转</h3>
        <div className="flex items-center space-x-2 text-sm flex-wrap gap-y-2">
          <span className="px-2 py-1 bg-yellow-500/15 text-yellow-400 rounded">pending</span>
          <span className="text-gray-500">→</span>
          <span className="px-2 py-1 bg-blue-500/15 text-blue-400 rounded">running</span>
          <span className="text-gray-500">→</span>
          <span className="px-2 py-1 bg-green-500/15 text-green-400 rounded">completed</span>
          <span className="text-gray-400 mx-2">|</span>
          <span className="px-2 py-1 bg-red-500/15 text-red-400 rounded">failed</span>
        </div>
      </div>
    </div>
  );
}
