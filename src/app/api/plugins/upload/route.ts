import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PluginManager } from '@/services/plugin-manager';
import { PERMISSIONS } from '@/types/permissions';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pipeline } from 'stream/promises';
import { createReadStream, createWriteStream } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger, LOG_MODULES } from '@/lib/logger';

const execAsync = promisify(exec);
const PLUGINS_DIR = path.join(process.cwd(), 'plugins');

/**
 * 解压 zip 文件
 */
async function extractZip(zipPath: string, targetDir: string): Promise<void> {
  // 在 Windows 上使用 PowerShell 解压
  const isWindows = process.platform === 'win32';
  
  if (isWindows) {
    await execAsync(`powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${targetDir}' -Force"`);
  } else {
    // 在 Unix 系统上使用 unzip
    await execAsync(`unzip -o "${zipPath}" -d "${targetDir}"`);
  }
}

/**
 * 解压 tar.gz 文件
 */
async function extractTarGz(tarPath: string, targetDir: string): Promise<void> {
  // 在 Windows 上需要使用 tar 命令（Windows 10+ 自带）
  const isWindows = process.platform === 'win32';
  
  if (isWindows) {
    await execAsync(`tar -xzf "${tarPath}" -C "${targetDir}"`);
  } else {
    await execAsync(`tar -xzf "${tarPath}" -C "${targetDir}"`);
  }
}

/**
 * POST /api/plugins/upload
 * 上传并安装插件
 */
export async function POST(request: Request) {
  // 使用统一认证中间件（需要 PLUGIN_CREATE 权限）
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.PLUGIN_CREATE });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const { payload } = auth;

  try {

    // 解析 multipart/form-data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: '请选择要上传的文件' },
        { status: 400 }
      );
    }

    // 验证文件类型
    const fileName = file.name.toLowerCase();
    const isZip = fileName.endsWith('.zip');
    const isTarGz = fileName.endsWith('.tar.gz') || fileName.endsWith('.tgz');

    if (!isZip && !isTarGz) {
      return NextResponse.json(
        { error: '不支持的文件格式，请上传 .zip、.tar.gz 或 .tgz 文件' },
        { status: 400 }
      );
    }

    // 创建临时目录
    const tempDir = path.join(os.tmpdir(), `plugin-upload-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    // 保存上传的文件
    const tempFilePath = path.join(tempDir, file.name);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(tempFilePath, buffer);

    // 创建解压目录
    const extractDir = path.join(tempDir, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });

    try {
      // 解压文件
      if (isZip) {
        await extractZip(tempFilePath, extractDir);
      } else {
        await extractTarGz(tempFilePath, extractDir);
      }

      // 查找 manifest.json
      let manifestPath = path.join(extractDir, 'manifest.json');
      let pluginRootDir = extractDir;

      // 如果根目录没有 manifest.json，检查子目录
      if (!fs.existsSync(manifestPath)) {
        const entries = fs.readdirSync(extractDir, { withFileTypes: true });
        const subDirs = entries.filter(e => e.isDirectory());
        
        for (const dir of subDirs) {
          const subManifestPath = path.join(extractDir, dir.name, 'manifest.json');
          if (fs.existsSync(subManifestPath)) {
            manifestPath = subManifestPath;
            pluginRootDir = path.join(extractDir, dir.name);
            break;
          }
        }
      }

      if (!fs.existsSync(manifestPath)) {
        throw new Error('压缩包中未找到 manifest.json 文件');
      }

      // 读取 manifest.json
      const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent);

      // 验证 manifest
      if (!manifest.name || !manifest.displayName) {
        throw new Error('manifest.json 缺少必要字段（name, displayName）');
      }

      // 确保插件目录存在
      if (!fs.existsSync(PLUGINS_DIR)) {
        fs.mkdirSync(PLUGINS_DIR, { recursive: true });
      }

      // 创建插件目标目录
      const pluginTargetDir = path.join(PLUGINS_DIR, manifest.name);
      
      // 如果插件已存在，先删除
      if (fs.existsSync(pluginTargetDir)) {
        fs.rmSync(pluginTargetDir, { recursive: true, force: true });
      }

      // 复制插件文件到目标目录
      fs.cpSync(pluginRootDir, pluginTargetDir, { recursive: true });

      // 安装插件到数据库
      const plugin = await PluginManager.installPlugin(manifest, pluginTargetDir);

      logger.create(LOG_MODULES.PLUGIN, payload, `plugin:${plugin.id}`, { name: manifest.name, fileName: file.name });
      return NextResponse.json({
        message: '插件安装成功',
        plugin,
      });
    } finally {
      // 清理临时目录
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        logger.errorNoUser(LOG_MODULES.PLUGIN, '清理临时目录失败', cleanupError instanceof Error ? cleanupError.message : cleanupError);
      }
    }
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.PLUGIN, '上传插件失败', error instanceof Error ? error.message : error);
    
    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: '上传插件失败' },
      { status: 500 }
    );
  }
}
