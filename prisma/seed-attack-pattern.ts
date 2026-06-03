import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface TreeNode {
  name: string;
  level: number;
  children?: TreeNode[];
}

const treeData: TreeNode[] = [
  {
    name: 'OWASP Top 10',
    level: 0,
    children: [
      {
        name: '注入',
        level: 1,
        children: [
          { name: 'SQL注入', level: 2, children: [
            { name: 'CWE-89 SQL注入', level: 3, children: [
              { name: 'Union注入', level: 4 },
              { name: '盲注', level: 4 },
              { name: '堆叠注入', level: 4 },
            ]},
          ]},
          { name: '命令注入', level: 2, children: [
            { name: 'CWE-78 OS命令注入', level: 3, children: [
              { name: '管道符注入', level: 4 },
              { name: '换行符注入', level: 4 },
            ]},
          ]},
          { name: 'LDAP注入', level: 2, children: [
            { name: 'CWE-90 LDAP注入', level: 3 },
          ]},
          { name: 'XML注入', level: 2, children: [
            { name: 'CWE-91 XML注入', level: 3 },
          ]},
          { name: 'SSRF', level: 2, children: [
            { name: 'CWE-918 SSRF', level: 3, children: [
              { name: '内网SSRF', level: 4 },
              { name: '协议绕过SSRF', level: 4 },
            ]},
          ]},
          { name: 'XEE注入', level: 2, children: [
            { name: 'CWE-611 XXE', level: 3 },
          ]},
        ],
      },
      {
        name: '认证与授权',
        level: 1,
        children: [
          { name: '认证绕过', level: 2, children: [
            { name: 'CWE-287 认证绕过', level: 3, children: [
              { name: 'JWT伪造', level: 4 },
              { name: 'Session固定', level: 4 },
            ]},
          ]},
          { name: '越权访问', level: 2, children: [
            { name: 'CWE-862 水平越权', level: 3, children: [
              { name: 'IDOR', level: 4 },
            ]},
            { name: 'CWE-269 垂直越权', level: 3 },
          ]},
          { name: '弱密码', level: 2, children: [
            { name: 'CWE-521 弱密码策略', level: 3 },
            { name: 'CWE-256 硬编码密码', level: 3 },
          ]},
          { name: '会话管理', level: 2, children: [
            { name: 'CWE-384 会话固定', level: 3 },
            { name: 'CWE-613 会话过期', level: 3 },
          ]},
        ],
      },
      {
        name: 'XSS',
        level: 1,
        children: [
          { name: '反射型XSS', level: 2, children: [
            { name: 'CWE-79 XSS反射型', level: 3, children: [
              { name: 'URL参数XSS', level: 4 },
              { name: 'DOM XSS', level: 4 },
            ]},
          ]},
          { name: '存储型XSS', level: 2, children: [
            { name: 'CWE-80 XSS存储型', level: 3 },
          ]},
          { name: '基于DOM的XSS', level: 2, children: [
            { name: 'CWE-84 DOM XSS', level: 3 },
          ]},
        ],
      },
      {
        name: '密码学',
        level: 1,
        children: [
          { name: '加密算法不当', level: 2, children: [
            { name: 'CWE-327 弱加密算法', level: 3, children: [
              { name: 'MD5哈希', level: 4 },
              { name: 'DES加密', level: 4 },
            ]},
          ]},
          { name: '密钥管理', level: 2, children: [
            { name: 'CWE-321 硬编码密钥', level: 3 },
            { name: 'CWE-338 随机数缺陷', level: 3 },
          ]},
          { name: 'TLS配置', level: 2, children: [
            { name: 'CWE-295 证书验证不当', level: 3 },
            { name: 'CWE-326 过于宽松的加密', level: 3 },
          ]},
        ],
      },
      {
        name: '配置安全',
        level: 1,
        children: [
          { name: '不安全配置', level: 2, children: [
            { name: 'CWE-16 配置缺陷', level: 3 },
            { name: 'CWE-538 内部信息暴露', level: 3 },
          ]},
          { name: '调试模式', level: 2, children: [
            { name: 'CWE-11 调试模式未关闭', level: 3 },
          ]},
          { name: 'CORS配置', level: 2, children: [
            { name: 'CWE-942 CORS过于宽松', level: 3 },
          ]},
        ],
      },
      {
        name: '数据泄露',
        level: 1,
        children: [
          { name: '敏感数据泄露', level: 2, children: [
            { name: 'CWE-200 信息泄露', level: 3, children: [
              { name: '错误信息泄露', level: 4 },
              { name: '源码泄露', level: 4 },
            ]},
          ]},
          { name: '目录遍历', level: 2, children: [
            { name: 'CWE-22 路径遍历', level: 3, children: [
              { name: '绝对路径遍历', level: 4 },
              { name: '相对路径遍历', level: 4 },
            ]},
          ]},
          { name: '文件上传', level: 2, children: [
            { name: 'CWE-434 不受限制的文件上传', level: 3 },
          ]},
        ],
      },
      {
        name: '竞态条件',
        level: 1,
        children: [
          { name: 'TOCTOU', level: 2, children: [
            { name: 'CWE-367 TOCTOU竞态', level: 3 },
          ]},
          { name: '并发缺陷', level: 2, children: [
            { name: 'CWE-362 竞态条件', level: 3 },
          ]},
        ],
      },
      {
        name: '反序列化',
        level: 1,
        children: [
          { name: '不安全反序列化', level: 2, children: [
            { name: 'CWE-502 不安全反序列化', level: 3, children: [
              { name: 'Java反序列化', level: 4 },
              { name: 'Python pickle', level: 4 },
              { name: 'PHP unserialize', level: 4 },
            ]},
          ]},
        ],
      },
    ],
  },
  {
    name: 'CWE弱点枚举',
    level: 0,
    children: [
      {
        name: '内存安全',
        level: 1,
        children: [
          { name: '缓冲区溢出', level: 2, children: [
            { name: 'CWE-119 堆缓冲区溢出', level: 3 },
            { name: 'CWE-120 栈缓冲区溢出', level: 3 },
          ]},
          { name: 'UAF', level: 2, children: [
            { name: 'CWE-416 释放后使用', level: 3 },
          ]},
          { name: '双重释放', level: 2, children: [
            { name: 'CWE-415 双重释放', level: 3 },
          ]},
          { name: '空指针', level: 2, children: [
            { name: 'CWE-476 空指针解引用', level: 3 },
          ]},
          { name: '整数溢出', level: 2, children: [
            { name: 'CWE-190 整数溢出', level: 3 },
          ]},
        ],
      },
      {
        name: '代码质量',
        level: 1,
        children: [
          { name: '硬编码', level: 2, children: [
            { name: 'CWE-798 硬编码凭证', level: 3 },
          ]},
          { name: '死代码', level: 2, children: [
            { name: 'CWE-83 死代码', level: 3 },
          ]},
          { name: '类型混淆', level: 2, children: [
            { name: 'CWE-843 类型混淆', level: 3 },
          ]},
        ],
      },
    ],
  },
  {
    name: '业务逻辑漏洞',
    level: 0,
    children: [
      {
        name: '支付逻辑',
        level: 1,
        children: [
          { name: '价格篡改', level: 2, children: [
            { name: '修改商品价格', level: 3 },
            { name: '负数金额支付', level: 3 },
          ]},
          { name: '订单绕过', level: 2, children: [
            { name: '跳过支付步骤', level: 3 },
            { name: '重复下单', level: 3 },
          ]},
        ],
      },
      {
        name: '验证逻辑',
        level: 1,
        children: [
          { name: '验证码绕过', level: 2, children: [
            { name: '短信验证码拦截', level: 3 },
            { name: '图形验证码OCR', level: 3 },
          ]},
          { name: '密码重置', level: 2, children: [
            { name: '重置链接未过期', level: 3 },
            { name: '用户名枚举', level: 3 },
          ]},
        ],
      },
    ],
  },
];

async function insertTree(node: TreeNode, parentId: number | null, libraryId: number): Promise<number> {
  const created = await prisma.attackPattern.create({
    data: {
      name: node.name,
      level: node.level,
      parent_id: parentId,
      library_id: libraryId,
      is_valid: 1,
      create_time: new Date(),
    },
  });

  if (node.children) {
    for (const child of node.children) {
      await insertTree(child, created.id, node.level === 0 ? created.id : libraryId);
    }
  }

  return created.id;
}

async function main() {
  console.log('播种 attack_pattern 表...');

  const count = await prisma.attackPattern.count();
  if (count > 0) {
    console.log(`attack_pattern 表已有 ${count} 条数据，跳过播种`);
    return;
  }

  for (const root of treeData) {
    const rootId = await insertTree(root, null, 0);
    await prisma.attackPattern.update({ where: { id: rootId }, data: { library_id: rootId } });
  }

  const total = await prisma.attackPattern.count();
  const stats = {
    L0: await prisma.attackPattern.count({ where: { level: 0 } }),
    L1: await prisma.attackPattern.count({ where: { level: 1 } }),
    L2: await prisma.attackPattern.count({ where: { level: 2 } }),
    L3: await prisma.attackPattern.count({ where: { level: 3 } }),
    L4: await prisma.attackPattern.count({ where: { level: 4 } }),
  };

  console.log('attack_pattern 种子数据播种完成！');
  console.log(`总计: ${total} 条, L0: ${stats.L0}, L1: ${stats.L1}, L2: ${stats.L2}, L3: ${stats.L3}, L4: ${stats.L4}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });