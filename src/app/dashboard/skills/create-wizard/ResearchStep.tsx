'use client';

import { useState } from 'react';
import { HelpCircle, Plus, X, FileText, AlertCircle, CheckCircle } from 'lucide-react';

interface ResearchData {
  edgeCases: string[];
  inputOutputFormats: string;
  exampleFiles: string[];
  successCriteria: string[];
  dependencies: string[];
}

interface Props {
  data: ResearchData;
  onChange: (data: ResearchData) => void;
  onNext: () => void;
  onPrevious: () => void;
}

export default function ResearchStep({ data, onChange, onNext, onPrevious }: Props) {
  const [newEdgeCase, setNewEdgeCase] = useState('');
  const [newExampleFile, setNewExampleFile] = useState('');
  const [newSuccessCriterion, setNewSuccessCriterion] = useState('');
  const [newDependency, setNewDependency] = useState('');

  const handleAddEdgeCase = () => {
    if (newEdgeCase.trim()) {
      onChange({ ...data, edgeCases: [...data.edgeCases, newEdgeCase.trim()] });
      setNewEdgeCase('');
    }
  };

  const handleRemoveEdgeCase = (index: number) => {
    onChange({ ...data, edgeCases: data.edgeCases.filter((_, i) => i !== index) });
  };

  const handleAddExampleFile = () => {
    if (newExampleFile.trim()) {
      onChange({ ...data, exampleFiles: [...data.exampleFiles, newExampleFile.trim()] });
      setNewExampleFile('');
    }
  };

  const handleRemoveExampleFile = (index: number) => {
    onChange({ ...data, exampleFiles: data.exampleFiles.filter((_, i) => i !== index) });
  };

  const handleAddSuccessCriterion = () => {
    if (newSuccessCriterion.trim()) {
      onChange({ ...data, successCriteria: [...data.successCriteria, newSuccessCriterion.trim()] });
      setNewSuccessCriterion('');
    }
  };

  const handleRemoveSuccessCriterion = (index: number) => {
    onChange({ ...data, successCriteria: data.successCriteria.filter((_, i) => i !== index) });
  };

  const handleAddDependency = () => {
    if (newDependency.trim()) {
      onChange({ ...data, dependencies: [...data.dependencies, newDependency.trim()] });
      setNewDependency('');
    }
  };

  const handleRemoveDependency = (index: number) => {
    onChange({ ...data, dependencies: data.dependencies.filter((_, i) => i !== index) });
  };

  const isValid = () => {
    return data.inputOutputFormats.trim() !== '';
  };

  return (
    <div className="space-y-6">
      {/* 说明 */}
      <div className="bg-blue-900/20 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start">
          <HelpCircle className="w-5 h-5 text-blue-400 mt-0.5 mr-3 flex-shrink-0" />
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-2">这一步做什么？</p>
            <p className="text-blue-400">
              深入了解你的需求细节。我们会询问一些关键问题，帮助生成更精准的 Skill 定义。
              信息越详细，生成的 Skill 质量越高。
            </p>
          </div>
        </div>
      </div>

      {/* 边缘情况 */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          有哪些边缘情况或特殊情况需要考虑？
        </label>
        <div className="space-y-2 mb-2">
          {data.edgeCases.map((edgeCase, index) => (
            <div key={index} className="flex items-center justify-between bg-[#0F172A] border border-gray-700/50 rounded-md px-3 py-2">
              <span className="text-sm text-gray-300">{edgeCase}</span>
              <button
                type="button"
                onClick={() => handleRemoveEdgeCase(index)}
                className="text-gray-400 hover:text-red-400"
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newEdgeCase}
            onChange={(e) => setNewEdgeCase(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleAddEdgeCase()}
            placeholder="例如：处理大文件时内存溢出、空输入的处理..."
            className="flex-1 px-4 py-2 border border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          <button
            type="button"
            onClick={handleAddEdgeCase}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      {/* 输入格式 */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          期望的输入格式是什么？ <span className="text-red-500">*</span>
        </label>
        <textarea
          value={data.inputOutputFormats}
          onChange={(e) => onChange({ ...data, inputOutputFormats: e.target.value })}
          rows={4}
          placeholder="描述输入数据的格式。例如：&#10;- Java 代码文件，包含用户输入验证逻辑&#10;- 项目目录路径，包含多个源代码文件&#10;- 特定格式的配置文件（YAML/JSON）"
          className="w-full px-4 py-2 border border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
        <p className="mt-1 text-xs text-gray-500">
          输出格式由系统配置的标准输出模板统一规定
        </p>
      </div>

      {/* 示例文件 */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          <FileText size={16} className="inline mr-1" />
          有示例文件或代码片段吗？
        </label>
        <p className="text-xs text-gray-500 mb-2">
          提供示例可以帮助 Skill 更准确地理解你的需求
        </p>
        <div className="space-y-2 mb-2">
          {data.exampleFiles.map((file, index) => (
            <div key={index} className="flex items-center justify-between bg-[#0F172A] border border-gray-700/50 rounded-md px-3 py-2">
              <span className="text-sm text-gray-300 font-mono">{file}</span>
              <button
                type="button"
                onClick={() => handleRemoveExampleFile(index)}
                className="text-gray-400 hover:text-red-400"
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newExampleFile}
            onChange={(e) => setNewExampleFile(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleAddExampleFile()}
            placeholder="例如：/path/to/example.java 或 https://..."
            className="flex-1 px-4 py-2 border border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          <button
            type="button"
            onClick={handleAddExampleFile}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      {/* 成功标准 */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          <CheckCircle size={16} className="inline mr-1" />
          如何判断 Skill 是否成功执行？
        </label>
        <div className="space-y-2 mb-2">
          {data.successCriteria.map((criterion, index) => (
            <div key={index} className="flex items-center justify-between bg-green-900/20 border border-green-200 rounded-md px-3 py-2">
              <span className="text-sm text-gray-300">{criterion}</span>
              <button
                type="button"
                onClick={() => handleRemoveSuccessCriterion(index)}
                className="text-gray-400 hover:text-red-400"
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newSuccessCriterion}
            onChange={(e) => setNewSuccessCriterion(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleAddSuccessCriterion()}
            placeholder="例如：准确识别出所有 SQL 注入点、无漏报..."
            className="flex-1 px-4 py-2 border border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          <button
            type="button"
            onClick={handleAddSuccessCriterion}
            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      {/* 依赖项 */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          <AlertCircle size={16} className="inline mr-1" />
          需要依赖哪些工具或资源？
        </label>
        <p className="text-xs text-gray-500 mb-2">
          例如：需要访问数据库、需要特定的分析工具、需要网络连接等
        </p>
        <div className="space-y-2 mb-2">
          {data.dependencies.map((dep, index) => (
            <div key={index} className="flex items-center justify-between bg-yellow-900/20 border border-yellow-200 rounded-md px-3 py-2">
              <span className="text-sm text-gray-300">{dep}</span>
              <button
                type="button"
                onClick={() => handleRemoveDependency(index)}
                className="text-gray-400 hover:text-red-400"
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newDependency}
            onChange={(e) => setNewDependency(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleAddDependency()}
            placeholder="例如：read_file、search_pattern、数据库访问..."
            className="flex-1 px-4 py-2 border border-gray-600 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          <button
            type="button"
            onClick={handleAddDependency}
            className="px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      {/* 导航按钮 */}
      <div className="flex justify-between pt-4 border-t">
        <button
          onClick={onPrevious}
          className="px-4 py-2 border border-gray-600 rounded-md text-gray-300 hover:bg-[#0F172A]"
        >
          上一步
        </button>
        <button
          onClick={onNext}
          disabled={!isValid()}
          className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          下一步：生成 Skill
        </button>
      </div>
    </div>
  );
}
