export interface SDKClientEvents {
  text: (content: string) => void;
  toolCall: (toolName: string, input: unknown) => void;
  toolResult: (toolName: string, result: unknown) => void;
  skillStart: (skillName: string) => void;
  skillComplete: (skillName: string) => void;
  error: (message: string) => void;
  sessionCreated: (sessionId: string) => void;
}

export interface SDKClientConfig {
  cwd: string;
  env?: Record<string, string>;
  model?: string;
  agent?: string;
  apiKey?: string;
  apiBaseUrl?: string;
}

export type SDKClientEventHandlers = Partial<SDKClientEvents>;

export interface SkillInvocation {
  skillName: string;
  startTime: string;
  endTime?: string;
  input?: unknown;
  output?: unknown;
  success?: boolean;
}

export interface SDKClient {
  on(handlers: SDKClientEventHandlers): void;
  start(config: SDKClientConfig): Promise<void>;
  createSession(agent?: string): Promise<string>;
  sendPrompt(prompt: string): Promise<void>;
  destroy(): Promise<void>;
  getSkillInvocations(): SkillInvocation[];
}
