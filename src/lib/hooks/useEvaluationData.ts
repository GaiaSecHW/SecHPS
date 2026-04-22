import useSWR from 'swr';
import useSWRImmutable from 'swr/immutable';

// 通用的 fetcher 函数
const fetcher = async (url: string) => {
  const token = localStorage.getItem('token');
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`);
  }
  
  return response.json();
};

/**
 * 获取评估详情
 * 运行中时自动刷新，完成后停止刷新
 */
export function useEvaluation(evaluationId: string | null) {
  const { data, error, isLoading, mutate } = useSWR(
    evaluationId ? `/api/evaluations/${evaluationId}` : null,
    fetcher,
    {
      refreshInterval: (data) => {
        // 根据评估状态决定刷新间隔
        const status = data?.evaluation?.status;
        if (status === 'running') return 5000; // 运行中每5秒刷新
        if (status === 'preparing') return 3000; // 准备中每3秒刷新
        return 0; // 其他状态不刷新
      },
      revalidateOnFocus: true, // 窗口聚焦时刷新
      revalidateOnReconnect: true, // 网络恢复时刷新
      onErrorRetry: (error, key, config, revalidate, { retryCount }) => {
        // 最多重试3次
        if (retryCount >= 3) return;
        // 5秒后重试
        setTimeout(() => revalidate({ retryCount }), 5000);
      },
    }
  );

  return {
    evaluation: data?.evaluation,
    isLoading,
    error,
    mutate, // 手动刷新
  };
}

/**
 * 获取节点列表
 * 运行中时自动刷新
 */
export function useWorkflowNodes(evaluationId: string | null, status?: string) {
  const shouldRefresh = status === 'running' || status === 'preparing';
  
  const { data, error, isLoading, mutate } = useSWR(
    evaluationId ? `/api/evaluations/${evaluationId}/nodes` : null,
    fetcher,
    {
      refreshInterval: shouldRefresh ? 5000 : 0,
      revalidateOnFocus: shouldRefresh,
    }
  );

  return {
    nodes: data?.nodes || [],
    isLoading,
    error,
    mutate,
  };
}

/**
 * 获取节点消息（点击节点后实时刷新）
 * 运行中时自动刷新该节点的消息
 */
export function useNodeMessages(evaluationId: string | null, nodeId: string | null, status?: string) {
  const shouldRefresh = Boolean(nodeId && (status === 'running' || status === 'preparing'));
  
  const { data, error, isLoading, mutate } = useSWR(
    evaluationId && nodeId 
      ? `/api/evaluations/${evaluationId}/messages?source=db&nodeId=${encodeURIComponent(nodeId)}&limit=200` 
      : null,
    fetcher,
    {
      refreshInterval: shouldRefresh ? 3000 : 0, // 节点消息刷新更快
      revalidateOnFocus: shouldRefresh,
      dedupingInterval: 1000, // 防止重复请求
    }
  );

  return {
    messages: data?.messages || [],
    total: data?.total || 0,
    isLoading,
    error,
    mutate, // 手动刷新消息
  };
}

/**
 * 获取节点任务（点击节点后实时刷新）
 * 运行中时自动刷新该节点的TODO
 */
export function useNodeTodos(evaluationId: string | null, nodeId: string | null, status?: string) {
  const shouldRefresh = Boolean(nodeId && (status === 'running' || status === 'preparing'));
  
  const { data, error, isLoading, mutate } = useSWR(
    evaluationId && nodeId 
      ? `/api/evaluations/${evaluationId}/todos?nodeId=${encodeURIComponent(nodeId)}` 
      : null,
    fetcher,
    {
      refreshInterval: shouldRefresh ? 3000 : 0,
      revalidateOnFocus: shouldRefresh,
      dedupingInterval: 1000,
    }
  );

  return {
    todos: data?.todos || [],
    isLoading,
    error,
    mutate,
  };
}

/**
 * 获取节点子Agent（点击节点后实时刷新）
 * 运行中时自动刷新该节点的子Agent
 */
export function useNodeChildren(evaluationId: string | null, nodeId: string | null, status?: string) {
  const shouldRefresh = Boolean(nodeId && (status === 'running' || status === 'preparing'));
  
  const { data, error, isLoading, mutate } = useSWR(
    evaluationId && nodeId 
      ? `/api/evaluations/${evaluationId}/children?nodeId=${encodeURIComponent(nodeId)}` 
      : null,
    fetcher,
    {
      refreshInterval: shouldRefresh ? 3000 : 0,
      revalidateOnFocus: shouldRefresh,
      dedupingInterval: 1000,
    }
  );

  return {
    children: data?.children || [],
    isLoading,
    error,
    mutate,
  };
}

/**
 * 获取所有任务列表（用于概览）
 * 运行中时自动刷新
 */
export function useTodos(evaluationId: string | null, status?: string) {
  const shouldRefresh = status === 'running' || status === 'preparing';
  
  const { data, error, isLoading, mutate } = useSWR(
    evaluationId ? `/api/evaluations/${evaluationId}/todos` : null,
    fetcher,
    {
      refreshInterval: shouldRefresh ? 5000 : 0,
      revalidateOnFocus: shouldRefresh,
    }
  );

  return {
    todos: data?.todos || [],
    isLoading,
    error,
    mutate,
  };
}

/**
 * 获取子Agent列表（用于概览）
 * 运行中时自动刷新
 */
export function useChildrenSessions(evaluationId: string | null, status?: string) {
  const shouldRefresh = status === 'running' || status === 'preparing';
  
  const { data, error, isLoading, mutate } = useSWR(
    evaluationId ? `/api/evaluations/${evaluationId}/children` : null,
    fetcher,
    {
      refreshInterval: shouldRefresh ? 5000 : 0,
      revalidateOnFocus: shouldRefresh,
    }
  );

  return {
    children: data?.children || [],
    isLoading,
    error,
    mutate,
  };
}