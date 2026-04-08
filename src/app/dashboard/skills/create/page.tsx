'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Save,
  Code,
  Shield,
  FileText,
} from 'lucide-react';
import { PERMISSIONS } from '@/types/permissions';
import { hasPermission } from '@/lib/auth';

const CATEGORIES = [
  { value: 'code-audit', label: '代码审计' },
  { value: 'auth', label: '认证鉴权' },
  { value: 'sensitive', label: '敏感信息' },
  { value: 'api', label: 'API 安全' },
  { value: 'config', label: '配置安全' },
  { value: 'crypto', label: '加密解密' },
  { value: 'web', label: 'Web 安全' },
  { value: 'business', label: '业务逻辑' },
  { value: 'client', label: '客户端安全' },
  { value: 'cloud', label: '云安全' },
];

const DEFAULT_TEMPLATE = `# Skill 名称

## 描述
简要描述这个 Skill 的作用和检测目标...

## 严重程度
critical | high | medium | low | info

## CWE 编号
CWE-89（可选）

## 系统提示词
你是一个专业的安全代码审计专家，专注于检测...

## 用户提示词
请分析以下代码中的潜在安全风险...

## 工具
- read_file
- search_pattern
- grep
`;

export default function CreateSkillPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [category, setCategory] = useState('code-audit');
  const [markdown, setMarkdown] = useState(DEFAULT_TEMPLATE);
  const [isPublic, setIsPublic] = useState(false);

  useState(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setIsAdmin(hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE));
      } catch (error) {
        console.error('解析 token 失败:', error);
      }
    }
  });

  const parseMarkdown = (content: string) => {
    const lines = content.split('\n');
    let name = '';
    let description = '';
    let severity = 'medium';
    let cwe = '';
    let systemPrompt = '';
    let userPrompt = '';
    const tools: string[] = [];
    
    let currentSection = '';
    let currentContent: string[] = [];
    
    for (const line of lines) {
      if (line.startsWith('# ')) {
        name = line.substring(2).trim();
      } else if (line.startsWith('## ')) {
        if (currentSection) {
          const content = currentContent.join('\n').trim();
          if (currentSection === '描述') {
            description = content;
          } else if (currentSection === '严重程度') {
            severity = content.toLowerCase().trim();
          } else if (currentSection === 'CWE 编号') {
            cwe = content.trim();
          } else if (currentSection === '系统提示词') {
            systemPrompt = content;
          } else if (currentSection === '用户提示词') {
            userPrompt = content;
          }
        }
        currentSection = line.substring(3).trim();
        currentContent = [];
      } else if (line.startsWith('- ')) {
        const tool = line.substring(2).trim();
        if (tool) tools.push(tool);
      } else {
        currentContent.push(line);
      }
    }
    
    if (currentSection) {
      const content = currentContent.join('\n').trim();
      if (currentSection === '描述') {
        description = content;
      } else if (currentSection === '严重程度') {
        severity = content.toLowerCase().trim();
      } else if (currentSection === 'CWE 编号') {
        cwe = content.trim();
      } else if (currentSection === '系统提示词') {
        systemPrompt = content;
      } else if (currentSection === '用户提示词') {
        userPrompt = content;
      }
    }
    
    return { name, description, severity, cwe, systemPrompt, userPrompt, tools };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        router.push('/login');
        return;
      }

      const parsed = parseMarkdown(markdown);
      
      if (!parsed.name) {
        throw new Error('请填写 Skill 名称（# 标题）');
      }
      if (!parsed.description) {
        throw new Error('请填写描述（## 描述）');
      }
      if (!parsed.systemPrompt) {
        throw new Error('请填写系统提示词（## 系统提示词）');
      }
      if (!parsed.userPrompt) {
        throw new Error('请填写用户提示词（## 用户提示词）');
      }

      const formData = {
        name: parsed.name.toLowerCase().replace(/\s+/g, '-'),
        displayName: parsed.name,
        description: parsed.description,
        category,
        cwe: parsed.cwe,
        severity: parsed.severity || 'medium',
        systemPrompt: parsed.systemPrompt,
        userPrompt: parsed.userPrompt,
        tools: parsed.tools,
        parameters: {},
        isPublic,
      };

      const response = await fetch('/api/skills', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '创建失败');
      }

      router.push(`/dashboard/skills/${data.skill.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <button
          onClick={() => router.back()}
          className="flex items-center text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft size={20} className="mr-2" />
          返回
        </button>
        <h1 className="text-2xl font-bold text-gray-900">创建新 Skill</h1>
        <p className="text-gray-600 mt-1">使用 Markdown 格式定义安全检测技能</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="texttext-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Shield size={20} className="mr-2" />
            漏洞分类 <span className="text-red-500">*</span>
          </h2>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                type="button"
                onClick={() => setCategory(cat.value)}
                className={`px-4 py-2 rounded-md border-2 transition-all ${
                  category === cat.value
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 hover:border-gray-300 text-gray-700'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="texttext-lg font-semibold text-gray-900 mb-4 flex items-center">
            <FileText size={20} className="mr-2" />
            Skill 定义（Markdown 格式）<span className="text-red-500">*</span>
          </h2>

          <div className="mb-4 bg-gray-50 border border-gray-200 rounded-lg p-4">
            <p className="text-sm text-gray-600 mb-2">支持的格式：</p>
            <div className="text-xs text-gray-500 font-mono space-y-1">
              <p># Skill 名称</p>
              <p>## 描述</p>
              <p>## 严重程度 (critical | high | medium | low | info)</p>
              <p>## CWE 编号</p>
              <p>## 系统提示词</p>
              <p>## 用户提示词</p>
              <p>## 工具 (使用 - 列表)</p>
            </div>
          </div>

          <textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            className="w-full h-[600px] px-4 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
            placeholder={DEFAULT_TEMPLATE}
            required
          />
        </div>

        {isAdmin && (
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="texttext-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Code size={20} className="mr-2" />
              可见性
            </h2>

            <label className="flex items-center">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="mlml-2 text-sm text-gray-700">
                创建为公共 Skill（所有用户可见）
              </span>
            </label>
            <p className="mt-1 text-sm text-gray-500">
              不勾选则创建为私有 Skill，仅自己可见
            </p>
          </div>
        )}

        <div className="flex justify-end space-x-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
            {loading ? (
              <>
                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></span>
                创建中...
              </>
            ) : (
              <>
                <Save size={16} className="mr-2" />
                创建 Skill
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
