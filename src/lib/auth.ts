import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import type { User, Role, Permission } from '@prisma/client';
import { permissionCache, cacheKeys, getOrSet, invalidateUserCaches } from '@/lib/cache';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
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
    return null;
  }
}

// 获取用户完整信息（包含角色和权限）- 使用缓存
export async function getUserWithPermissions(userId: string) {
  const cacheKey = cacheKeys.userPermissions(userId);

  return getOrSet(
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

// 检查用户是否拥有指定权限
export function hasPermission(userPermissions: string[], requiredPermission: string): boolean {
  return userPermissions.includes(requiredPermission);
}

// 检查用户是否拥有任意一个权限
export function hasAnyPermission(userPermissions: string[], requiredPermissions: string[]): boolean {
  return requiredPermissions.some(perm => userPermissions.includes(perm));
}

// 检查用户是否拥有所有权限
export function hasAllPermissions(userPermissions: string[], requiredPermissions: string[]): boolean {
  return requiredPermissions.every(perm => userPermissions.includes(perm));
}

// 检查用户是否拥有指定角色
export function hasRole(userRoles: string[], requiredRole: string): boolean {
  return userRoles.includes(requiredRole);
}

// 检查用户是否拥有任意一个角色
export function hasAnyRole(userRoles: string[], requiredRoles: string[]): boolean {
  return requiredRoles.some(role => userRoles.includes(role));
}
