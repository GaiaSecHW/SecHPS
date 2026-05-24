'use client';

import { X, Zap, Layers, Check } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (mode: 'quick' | 'deep') => void;
}

const quickFeatures = [
  '上传 ZIP 代码包即可开始',
  '自动匹配 Agent 与模型',
  '适合快速验证和常规扫描',
  '预计耗时：10-30 分钟',
];

const deepFeatures = [
  '自定义 Agent 组合与执行顺序',
  '配置知识图谱与污点分析参数',
  '支持增量分析与多轮迭代',
  '预计耗时：30-120 分钟',
];

export default function ModeSelectModal({ isOpen, onClose, onSelect }: Props) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 rounded-lg shadow-xl w-full max-w-xl mx-4">
        <div className="border-b border-gray-700/50 px-6 py-4 flex items-center justify-between">
          <h2 className="text-white text-lg font-semibold">选择创建模式</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 p-6">
          {/* 快速模式 */}
          <div
            onClick={() => onSelect('quick')}
            className="bg-gray-800/40 border border-gray-700/50 rounded-lg p-5 cursor-pointer hover:bg-gray-800/70 hover:border-blue-500/50 transition-all"
          >
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center mb-3">
              <Zap size={20} className="text-white" />
            </div>
            <p className="text-gray-100 font-medium mb-1">快速模式</p>
            <p className="text-gray-400 text-sm mb-3">一键上传代码包，快速启动安全审计任务</p>
            <ul className="space-y-1.5">
              {quickFeatures.map((f) => (
                <li key={f} className="text-gray-500 text-xs flex items-center gap-1.5">
                  <Check size={10} className="text-green-400 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </div>

          {/* 深度模式（禁用） */}
          <div className="bg-gray-800/40 border border-gray-700/50 rounded-lg p-5 cursor-not-allowed opacity-60 relative">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center mb-3">
              <Layers size={20} className="text-white" />
            </div>
            <p className="text-gray-100 font-medium mb-1">深度模式</p>
            <p className="text-gray-400 text-sm mb-3">精细化配置，定制化深度审计流程</p>
            <ul className="space-y-1.5">
              {deepFeatures.map((f) => (
                <li key={f} className="text-gray-500 text-xs flex items-center gap-1.5">
                  <Check size={10} className="text-green-400 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
            <span className="absolute bottom-3 right-3 text-[10px] text-gray-500 bg-gray-900/80 px-1.5 py-0.5 rounded">
              开发中
            </span>
          </div>
        </div>

        <div className="border-t border-gray-700/50 px-6 py-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800 transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
