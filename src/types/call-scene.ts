/**
 * 调用场景枚举
 * 用于 Token 统计分类
 */

export type CallScene =
  // Skill 相关
  | 'skill-generate'      // Skill 生成
  | 'skill-match'         // Skill 匹配
  | 'skill-optimize'      // Skill 优化
  | 'skill-predict'       // 任务预测
  | 'skill-test'          // Skill 测试
  // 模型相关
  | 'model-test'          // 模型连接测试
  // 自主进化
  | 'experience-gen'      // 经验生成
  // Agent/评估相关
  | 'evaluation'          // 评估调用
  | 'agent-team'          // Agent Team 执行
  | 'agent-executor'      // Agent 执行器
  // 其他
  | 'other';

/**
 * Token 使用上下文
 * 用于记录谁在什么时候用什么模型消耗了多少 token
 */
export interface TokenUsageContext {
  userId: string;          // 用户 ID（必填）
  username?: string;       // 用户名
  projectId?: string;      // 项目 ID
  evaluationId?: string;   // 评估 ID
  scene: CallScene;        // 调用场景（必填）
  description?: string;    // 描述
}

/**
 * 场景显示名称
 */
export const CALL_SCENE_LABELS: Record<CallScene, string> = {
  'skill-generate': 'Skill 生成',
  'skill-match': 'Skill 匹配',
  'skill-optimize': 'Skill 优化',
  'skill-predict': '任务预测',
  'skill-test': 'Skill 测试',
  'model-test': '模型测试',
  'experience-gen': '经验生成',
  'evaluation': '评估调用',
  'agent-team': 'Agent Team',
  'agent-executor': 'Agent 执行',
  'other': '其他',
};
