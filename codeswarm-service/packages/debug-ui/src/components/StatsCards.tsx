import { useMemo } from 'react';
import { Wifi, Loader2, CheckCircle, Activity } from 'lucide-react';

interface Task {
  taskId: string;
  state: string;
}

interface Worker {
  nodeId: string;
  status: string;
}

export function StatsCards({ tasks, workers }: { tasks: Task[]; workers: Worker[] }) {
  const stats = useMemo(() => {
    const onlineWorkers = workers.filter(w => w.status === 'online').length;
    const totalWorkers = workers.length;
    const activeTasks = tasks.filter(t => ['queued', 'dispatched', 'building', 'running'].includes(t.state)).length;
    const completedTasks = tasks.filter(t => t.state === 'completed').length;
    const failedTasks = tasks.filter(t => t.state === 'failed').length;
    const successRate = (completedTasks + failedTasks) > 0
      ? Math.round((completedTasks / (completedTasks + failedTasks)) * 100)
      : 0;
    return { onlineWorkers, totalWorkers, activeTasks, completedTasks, failedTasks, successRate };
  }, [tasks, workers]);

  const cards = [
    {
      label: '在线节点',
      value: `${stats.onlineWorkers}/${stats.totalWorkers}`,
      icon: Wifi,
      color: stats.onlineWorkers > 0 ? 'text-green-400' : 'text-gray-400',
      bg: stats.onlineWorkers > 0 ? 'bg-green-100' : 'bg-dark-surface-hover',
    },
    {
      label: '活跃任务',
      value: stats.activeTasks,
      icon: Loader2,
      color: 'text-blue-400',
      bg: 'bg-blue-100',
      spin: stats.activeTasks > 0,
    },
    {
      label: '已完成',
      value: stats.completedTasks,
      icon: CheckCircle,
      color: 'text-green-400',
      bg: 'bg-green-100',
    },
    {
      label: '成功率',
      value: `${stats.successRate}%`,
      icon: Activity,
      color: stats.successRate >= 80 ? 'text-green-400' : stats.successRate >= 50 ? 'text-yellow-400' : 'text-red-400',
      bg: stats.successRate >= 80 ? 'bg-green-100' : stats.successRate >= 50 ? 'bg-yellow-100' : 'bg-red-100',
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-4">
      {cards.map((card) => (
        <div key={card.label} className="bg-dark-surface rounded-lg border border-gray-700/50 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">{card.label}</p>
              <p className="text-2xl font-bold text-gray-100 mt-1">{card.value}</p>
            </div>
            <div className={`p-3 rounded-lg ${card.bg}`}>
              <card.icon className={`w-6 h-6 ${card.color} ${card.spin ? 'animate-spin' : ''}`} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
