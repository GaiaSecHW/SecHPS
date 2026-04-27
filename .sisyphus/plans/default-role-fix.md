# Plan: 默认角色处理逻辑

## TL;DR
> 如果编排无角色定义，前端添加默认角色让用户选择模型，所有节点使用该模型。

## Context
用户启动评估时选择工作流，如果该编排节点没有分配角色（角色nodes为空或无角色），需要添加默认角色让用户选择模型。

## Work Objectives
- 前端fetchWorkflowRoles：检测是否存在没有节点的角色
- 如果存在，添加一个"默认角色"供用户选择模型

## TODOs

- [x] 1. 修改fetchWorkflowRoles函数

  **What to do**:
  - 文件：`src/app/dashboard/sessions/page.tsx`
  - 位置：第269-270行
  - 逻辑变更：
    - **不是**过滤掉没有节点的角色
    - **而是**检测是否存在没有节点的角色
    - 如果存在，添加默认角色
  
  **Code change**:
  ```typescript
  const data = await response.json();
  let roles = data.roles || [];
  
  // 检查是否有角色没有节点（表示有节点未分配角色）
  const hasEmptyRole = roles.some((r: any) => !r.nodes || r.nodes.length === 0);
  
  // 如果存在没有节点的角色，添加默认角色
  if (hasEmptyRole || roles.length === 0) {
    // 移除没有节点的角色（它们不需要配置模型）
    roles = roles.filter((r: any) => r.nodes && r.nodes.length > 0);
    
    // 添加默认角色
    roles.push({
      id: 'default',
      name: '默认角色',
      description: '未分配角色的节点将使用此模型',
      color: '#6b7280', // Tailwind gray-500
      order: 999,
      nodes: [],
      nodeCount: 0,
    });
  }
  ```

- [x] 2. 验证build

  **What to do**:
  - 运行 `npm run build`
  - 确认无编译错误

## Success Criteria
- 启动评估时，无角色编排显示"默认角色"选项
- 用户可以为默认角色选择模型
- build成功