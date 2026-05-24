'use client';

import Link from 'next/link';
import {
  Shield,
  Zap,
  Brain,
  Layers,
  Search,
  GitBranch,
  Network,
  Cpu,
  Play,
} from 'lucide-react';

const features = [
  {
    icon: <Brain size={22} />,
    gradient: 'from-cyan-400 to-blue-500',
    title: '人机协同',
    desc: '融合人的知识沉淀与 AI 智能化能力，协同挖掘深层漏洞',
  },
  {
    icon: <Network size={22} />,
    gradient: 'from-purple-400 to-indigo-500',
    title: '知识图谱',
    desc: '代码结构、数据流、调用关系的可视化分析与追踪',
  },
  {
    icon: <GitBranch size={22} />,
    gradient: 'from-emerald-400 to-green-500',
    title: '闭环进化',
    desc: 'Skill 精准率自适应优化，从失败中学习持续提升检测能力',
  },
  {
    icon: <Cpu size={22} />,
    gradient: 'from-amber-400 to-orange-500',
    title: '分布式调度',
    desc: '多 Agent 协同执行，CodeSwarm 集群调度大规模并发扫描',
  },
  {
    icon: <Search size={22} />,
    gradient: 'from-rose-400 to-red-500',
    title: '污点分析',
    desc: '基于 Joern 的代码安全分析引擎，精准定位注入与越权',
  },
  {
    icon: <Layers size={22} />,
    gradient: 'from-violet-400 to-purple-500',
    title: '工作流编排',
    desc: 'DAG/FSM 双引擎可视化编排，灵活定制审计流程',
  },
];

export default function DashboardPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] gap-0">
      {/* ===== Hero 区 ===== */}
      <section className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 w-full">
        {/* 背景装饰 */}
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/4" />
        </div>

        <div className="relative px-6 md:px-10 py-8 md:py-14 flex flex-col items-center text-center">
          {/* 品牌名 */}
          <div className="flex items-center gap-3 mb-4 md:mb-6">
            <div className="w-10 md:w-12 h-10 md:h-12 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Shield size={24} className="text-white" />
            </div>
            <h1 className="text-2xl md:text-4xl font-bold tracking-tight">
              <span className="text-zinc-100">SecICSL</span>
              <span className="text-cyan-400">-JVS</span>
            </h1>
          </div>

          {/* 标语 */}
          <p className="text-base md:text-lg text-zinc-200 font-medium mb-2 md:mb-3">
            人机协同 · 智能漏洞挖掘引擎
          </p>
          <p className="text-sm md:text-base text-zinc-400 max-w-xl whitespace-nowrap text-center mb-6 md:mb-8">
            将安全测试工程师的实战经验持续沉淀，驱动 AI 能力自我进化，构建越用越强的漏洞挖掘引擎
          </p>

          {/* 核心特性卡片 */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 w-full max-w-3xl">
            {features.map((f) => (
              <div
                key={f.title}
                className="bg-zinc-800/60 border border-zinc-700/50 rounded-lg p-4 md:p-5 hover:bg-zinc-800/80 hover:border-zinc-600/50 transition-all group"
              >
                <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${f.gradient} flex items-center justify-center mb-2.5 shadow-sm`}>
                  <span className="text-white">{f.icon}</span>
                </div>
                <p className="text-zinc-100 font-medium text-sm mb-1">{f.title}</p>
                <p className="text-zinc-400 text-xs leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>

          {/* 快速开始按钮 */}
          <div className="mt-6 md:mt-8 flex items-center gap-3">
            <Link
              href="/dashboard/task-builder"
              className="group flex items-center gap-2 px-4 md:px-6 py-2.5 md:py-3 rounded-lg font-medium text-sm transition-all duration-200 bg-cyan-500 text-white shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 hover:bg-cyan-400"
            >
              <Play size={16} className="transition-transform group-hover:rotate-90 duration-200" />
              开始挖掘
            </Link>
            <Link
              href="/dashboard/overview"
              className="flex items-center gap-2 px-4 md:px-6 py-2.5 md:py-3 rounded-lg font-medium text-sm transition-all duration-200 border border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 hover:border-zinc-600"
            >
              <Zap size={16} />
              数据看板
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}