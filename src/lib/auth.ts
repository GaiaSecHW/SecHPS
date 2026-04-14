import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import type { User, Role, Permission } from '@prisma/client';
import { permissionCache, cacheKeys, getOrSet, invalidateUserCaches } from '@/lib/cache';

// JWT_SECRET 必须通过环境变量设置，禁止硬编码
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('\n');
    console.error('========================================');
    console.error('❌ 错误: JWT_SECRET 环境变量未设置!');
    console.error('========================================');
    console.error('');
    console.error('请按照以下步骤设置 JWT_SECRET:');
    console.error('');
    console.error('1. 在项目根目录创建 .env.local 文件（如果不存在）');
    console.error('');
    console.error('2. 在 .env.local 中添加以下内容:');
    console.error('');
    console.error('   JWT_SECRET=your-secure-random-string-here');
    console.error('');
    console.error('3. 生成安全的密钥（推荐方式）:');
    console.error('   - Node.js: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
    console.error('   - OpenSSL: openssl rand -hex 64');
    console.error('   - 在线工具: https://generate-secret.vercel.app/64');
    console.error('');
    console.error('4. 重启应用程序');
    console.error('');
    console.error('⚠️  注意: 请勿将 JWT_SECRET 提交到版本控制系统!');
    console.error('    确保 .env.local 已添加到 .gitignore');
    console.error('');
    process.exit(1);
  }
  return secret;
}

const JWT_SECRET = getJwtSecret();

const JWT_EXPIRES_IN = '7d';

export interface JWTPayload {
  userId: string;
  email: string;
  roles: string[];
  permissions: string[];
}

// 密码哈希
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

// 密码验证
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// 生成 JWT Token
export function generateToken(user: User, roles: Role[], permissions: string[]): string {
  const payload: JWTPayload = {
    userId: user.id,
    email: user.email,
    roles: roles.map(r => r.name),
    permissions: permissions,
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

// 验证 JWT Token
export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch (error) {
    // JWT验证失败，可能是token过期、签名无效或格式错误
    if (error instanceof Error) {
      if (error.name === 'TokenExpiredError') {
        console.warn('[Auth] Token已过期');
      } else if (error.name === 'JsonWebTokenError') {
        console.warn('[Auth] Token签名无效:', error.message);
      } else {
        console.warn('[Auth] Token验证失败:', error.message);
      }
    }
    return null;
  }
}

// 获取用户完整信息（包含角色和权限）- 使用缓存
export async function getUserWithPermissions(userId: string): Promise<{
  user: User;
  roles: Role[];
  permissions: string[];
} | null> {
  const cacheKey = cacheKeys.userPermissions(userId);

  return getOrSet<{
    user: User;
    roles: Role[];
    permissions: string[];
  } | null>(
    permissionCache,
    cacheKey,
    async () => {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          userRoles: {
            include: {
              role: {
                include: {
                  permissions: true,
                },
              },
            },
          },
        },
      });

      if (!user) {
        return null;
      }

      // 提取所有权限（去重）
      const permissions = new Set<string>();
      user.userRoles.forEach(userRole => {
        userRole.role.permissions.forEach(permission => {
          permissions.add(permission.name);
        });
      });

      return {
        user,
        roles: user.userRoles.map(ur => ur.role),
        permissions: Array.from(permissions),
      };
    },
    5 * 60 * 1000 // 5 minutes TTL
  );
}

// 重新导出权限检查函数（供服务端 API 使用）
// 客户端组件应使用 @/lib/permissions 以避免服务端环境变量检查
export {
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  hasRole,
  hasAnyRole,
} from '@/lib/permissions';
