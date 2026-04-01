import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * 检查指定端口是否被占用
 * @param port 端口号
 * @returns true 表示端口被占用，false 表示端口可用
 */
export async function isPortInUse(port: number): Promise<boolean> {
  try {
    // Windows: 使用 netstat 检查端口
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
      return stdout.trim().length > 0;
    } else {
      // Linux/Mac: 使用 lsof 检查端口
      const { stdout } = await execAsync(`lsof -i :${port} 2>/dev/null || echo ''`);
      return stdout.trim().length > 0;
    }
  } catch (error) {
    // 如果命令执行失败，假设端口可用
    console.warn(`[PortManager] 检查端口 ${port} 时出错:`, error);
    return false;
  }
}

/**
 * 生成随机端口（10000-60000）
 * @returns 随机端口号
 */
export function generateRandomPort(): number {
  const min = 10000;
  const max = 60000;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 获取一个可用的随机端口（10000-60000）
 * @param maxAttempts 最大尝试次数，默认 100
 * @returns 可用的端口号
 * @throws 如果无法找到可用端口
 */
export async function getAvailablePort(maxAttempts: number = 100): Promise<number> {
  let attempts = 0;
  const usedPorts = new Set<number>();

  while (attempts < maxAttempts) {
    attempts++;
    const port = generateRandomPort();

    // 避免重复检查同一个端口
    if (usedPorts.has(port)) {
      continue;
    }
    usedPorts.add(port);

    console.log(`[PortManager] 尝试端口 ${port} (${attempts}/${maxAttempts})`);

    const inUse = await isPortInUse(port);
    if (!inUse) {
      console.log(`[PortManager] 找到可用端口: ${port}`);
      return port;
    }
  }

  throw new Error(`无法在 ${maxAttempts} 次尝试内找到可用端口（10000-60000）`);
}

/**
 * 批量获取多个可用的随机端口
 * @param count 需要的端口数量
 * @param maxAttempts 每个端口的最大尝试次数
 * @returns 可用端口号数组
 */
export async function getAvailablePorts(count: number, maxAttempts: number = 100): Promise<number[]> {
  const ports: number[] = [];
  const usedPorts = new Set<number>();

  for (let i = 0; i < count; i++) {
    let attempts = 0;
    let port: number | null = null;

    while (attempts < maxAttempts && port === null) {
      attempts++;
      const candidatePort = generateRandomPort();

      // 避免重复检查同一个端口
      if (usedPorts.has(candidatePort)) {
        continue;
      }

    usedPorts.add(candidatePort);
      console.log(`[PortManager] 尝试端口 ${candidatePort} (${i + 1}/${count}, ${attempts}/${maxAttempts})`);

      const inUse = await isPortInUse(candidatePort);
      if (!inUse) {
        port = candidatePort;
        console.log(`[PortManager] 找到可用端口: ${port}`);
      }
    }

    if (port === null) {
      throw new Error(`无法为第 ${i + 1} 个端口找到可用端口（10000-60000）`);
    }

    ports.push(port);
  }

  return ports;
}
