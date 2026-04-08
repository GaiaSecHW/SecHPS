'use client';

import { useState } from 'react';
import { Plus, Trash2, Play, FileText, AlertCircle } from 'lucide-react';

interface TestCase {
  id: string;
  name: string;
  prompt: string;
  expectedOutput?: string;
  testFiles?: string[];
}

interface Props {
  testCases: TestCase[];
  onChange: (testCases: TestCase[]) => void;
  onNext: () => void;
  onPrevious: () => void;
  needsTestCases: boolean;
}

export default function TestCasesStep({ testCases, onChange, onNext, onPrevious, needsTestCases }: Props) {
  const [newTestCase, setNewTestCase] = useState<Partial<TestCase>>({
    name: '',
    prompt: '',
    expectedOutput: '',
    testFiles: [],
  });
  const [newTestFile, setNewTestFile] = useState('');

  const handleAddTestCase = () => {
    if (newTestCase.name?.trim() && newTestCase.prompt?.trim()) {
      const testCase: TestCase = {
        id: Date.now().toString(),
        name: newTestCase.name.trim(),
        prompt: newTestCase.prompt.trim(),
        expectedOutput: newTestCase.expectedOutput?.trim(),
        testFiles: newTestCase.testFiles || [],
      };
      onChange([...testCases, testCase]);
      setNewTestCase({
        name: '',
        prompt: '',
        expectedOutput: '',
        testFiles: [],
      });
    }
  };

  const handleRemoveTestCase = (id: string) => {
    onChange(testCases.filter((tc) => tc.id !== id));
  };

  const handleAddTestFile = () => {
    if (newTestFile.trim()) {
      setNewTestCase({
        ...newTestCase,
        testFiles: [...(newTestCase.testFiles || []), newTestFile.trim()],
      });
      setNewTestFile('');
    }
  };

  const handleRemoveTestFile = (index: number) => {
    setNewTestCase({
      ...newTestCase,
      testFiles: newTestCase.testFiles?.filter((_, i) => i !== index),
    });
  };

  const isValid = () => {
    if (!needsTestCases) return true;
    return testCases.length > 0;
  };

  // 如果不需要测试用例，显示提示并允许跳过
  if (!needsTestCases) {
    return (
      <div className="space-y-6">
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
          <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">已跳过测试用例</h3>
          <p className="text-sm text-gray-600 mb-4">
            你在第一步选择了不需要测试用例。你可以直接进入下一步完成 Skill 创建。
          </p>
          <p className="text-sm text-gray-500">
            提示：测试用例可以帮助验证和改进 Skill 的效果，建议后续添加。
          </p>
        </div>

        <div className="flex justify-between pt-4 border-t">
          <button
            onClick={onPrevious}
            className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
          >
            上一步
          </button>
          <button
            onClick={onNext}
            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            跳过此步骤
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 说明 */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start">
          <Play className="w-5 h-5 text-blue-600 mt-0.5 mr-3 flex-shrink-0" />
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-2">为什么要创建测试用例？</p>
            <p className="text-blue-700">
              测试用例可以帮助验证 Skill 的效果。我们会用这些用例测试 Skill，
              对比有 Skill 和无 Skill 两种情况的效果，帮助你改进 Skill 质量。
            </p>
          </div>
        </div>
      </div>

      {/* 已添加的测试用例列表 */}
      {testCases.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-700">已添加的测试用例 ({testCases.length})</h3>
          {testCases.map((testCase, index) => (
            <div key={testCase.id} className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-gray-900">
                    {index + 1}. {testCase.name}
                  </h4>
                  <p className="mt-1 text-xs text-gray-500 line-clamp-2">
                    {testCase.prompt}
                  </p>
                  {testCase.testFiles && testCase.testFiles.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {testCase.testFiles.map((file, i) => (
                        <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
                          {file}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleRemoveTestCase(testCase.id)}
                  className="ml-4 text-gray-400 hover:text-red-600"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 添加新测试用例 */}
      <div className="border border-gray-300 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-4">添加新测试用例</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              测试用例名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={newTestCase.name}
              onChange={(e) => setNewTestCase({ ...newTestCase, name: e.target.value })}
              placeholder="例如：检测简单 SQL 注入"
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              测试提示词 <span className="text-red-500">*</span>
            </label>
            <textarea
              value={newTestCase.prompt}
              onChange={(e) => setNewTestCase({ ...newTestCase, prompt: e.target.value })}
              rows={4}
              placeholder="用户会说的话，例如：&#10;请分析这段 Java 代码中的 SQL 注入漏洞：&#10;&#10;String query = &quot;SELECT * FROM users WHERE id = &quot; + userId;"
               className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              期望输出（可选）
            </label>
            <textarea
              value={newTestCase.expectedOutput}
              onChange={(e) => setNewTestCase({ ...newTestCase, expectedOutput: e.target.value })}
              rows={3}
              placeholder="描述你期望的输出结果..."
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <FileText size={16} className="inline mr-1" />
              测试文件（可选）
            </label>
            <div className="space-y-2">
              {newTestCase.testFiles && newTestCase.testFiles.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {newTestCase.testFiles.map((file, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded"
                    >
                      {file}
                      <button
                        onClick={() => handleRemoveTestFile(index)}
                        className="ml-1 text-blue-600 hover:text-blue-800"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newTestFile}
                  onChange={(e) => setNewTestFile(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleAddTestFile()}
                  placeholder="例如：/path/to/test.java"
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={handleAddTestFile}
                  className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleAddTestCase}
            disabled={!newTestCase.name?.trim() || !newTestCase.prompt?.trim()}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus size={16} className="inline mr-2" />
            添加测试用例
          </button>
        </div>
      </div>

      {/* 建议 */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <div className="flex items-start">
          <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 mr-3 flex-shrink-0" />
          <div className="text-sm text-yellow-800">
            <p className="font-medium mb-1">建议</p>
            <ul className="text-yellow-700 space-y-1">
              <li>• 创建 2-5 个测试用例以获得最佳效果</li>
              <li>• 涵盖不同的场景和边缘情况</li>
              <li>• 包含清晰的期望输出描述</li>
            </ul>
          </div>
        </div>
      </div>

      {/* 导航按钮 */}
      <div className="flex justify-between pt-4 border-t">
        <button
          onClick={onPrevious}
          className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
        >
          上一步
        </button>
        <button
          onClick={onNext}
          disabled={!isValid()}
          className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {testCases.length > 0 ? `下一步：运行评估 (${testCases.length} 个用例)` : '添加至少一个测试用例'}
        </button>
      </div>
    </div>
  );
}
