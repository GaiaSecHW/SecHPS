# Skill 三维分类体系 — 数据库变更记录

## 概述

将 Skill 从扁平的二维分类（TechStackOption + VulnerabilityPattern）迁移到三维分类体系：

| 维度 | 模型 | 说明 |
|------|------|------|
| 维度一：SKILL类型 | `SkillCategory` | 功能分类（漏洞挖掘、代码审计等） |
| 维度二：攻击模式 | `VulnerabilityTree` | 语言 → 漏洞模式树（仅漏洞挖掘类生效） |
| 维度三：适用产品 | `ProductTag` + `SkillProductTag` | 多对多产品标签（不选 = 通用） |

---

## 一、删除的字段

### Skill 模型移除

| 字段 | 原关联表 | 说明 |
|------|---------|------|
| `techStackId` | `TechStackOption` | 编程语言/技术栈关联 |
| `vulnerabilityPatternId` | `VulnerabilityPattern` | 漏洞模式关联 |

`TechStackOption` 和 `VulnerabilityPattern` 表仍保留在 schema 中（有其他用途），但不再与 Skill 建立外键关系。

---

## 二、新增的模型

### 1. SkillCategory（维度一：SKILL类型）

```sql
CREATE TABLE SkillCategory (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,   -- 英文标识，如 vulnerability-mining
  displayName TEXT NOT NULL,          -- 中文显示名，如 漏洞挖掘
  description TEXT,
  icon        TEXT,                   -- lucide-react 图标名
  sortOrder   INTEGER DEFAULT 0,
  isActive    BOOLEAN DEFAULT true,
  hasSubDimension BOOLEAN DEFAULT false,  -- 是否启用维度二
  createdAt   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt   DATETIME NOT NULL
);
CREATE INDEX SkillCategory_isActive_idx ON SkillCategory(isActive);
CREATE INDEX SkillCategory_sortOrder_idx ON SkillCategory(sortOrder);
```

**`hasSubDimension`** 标记该分类是否需要子维度（漏洞模式）。目前仅 `漏洞挖掘` 为 `true`。

### 2. VulnerabilityTree（维度二：攻击模式）

```sql
CREATE TABLE VulnerabilityTree (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,          -- 英文标识
  displayName TEXT NOT NULL,          -- 中文显示名
  type        TEXT NOT NULL,          -- 'language' | 'pattern'
  parentId    TEXT,                   -- 自引用，language 节点为 NULL，pattern 节点指向 language
  description TEXT,
  sortOrder   INTEGER DEFAULT 0,
  isActive    BOOLEAN DEFAULT true,
  createdAt   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt   DATETIME NOT NULL,
  FOREIGN KEY (parentId) REFERENCES VulnerabilityTree(id)
);
CREATE INDEX VulnerabilityTree_type_idx ON VulnerabilityTree(type);
CREATE INDEX VulnerabilityTree_parentId_idx ON VulnerabilityTree(parentId);
CREATE INDEX VulnerabilityTree_isActive_idx ON VulnerabilityTree(isActive);
CREATE INDEX VulnerabilityTree_name_idx ON VulnerabilityTree(name);
```

树结构设计：
- `type = 'language'` 且 `parentId = NULL` → 语言节点（C/C++、Java、Python 等）
- `type = 'pattern'` 且 `parentId = 语言节点id` → 该语言下的漏洞模式
- 特殊语言节点 `通用`：不属于特定语言的漏洞模式挂在此节点下

### 3. ProductTag（维度三：适用产品）

```sql
CREATE TABLE ProductTag (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,   -- 英文标识
  displayName TEXT NOT NULL,          -- 中文显示名
  description TEXT,
  isActive    BOOLEAN DEFAULT true,
  createdAt   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt   DATETIME NOT NULL
);
CREATE INDEX ProductTag_isActive_idx ON ProductTag(isActive);
CREATE INDEX ProductTag_name_idx ON ProductTag(name);
```

### 4. SkillProductTag（维度三：多对多关联表）

```sql
CREATE TABLE SkillProductTag (
  id           TEXT PRIMARY KEY,
  skillId      TEXT NOT NULL,
  productTagId TEXT NOT NULL,
  FOREIGN KEY (skillId)      REFERENCES Skill(id)      ON DELETE CASCADE,
  FOREIGN KEY (productTagId) REFERENCES ProductTag(id) ON DELETE CASCADE,
  UNIQUE (skillId, productTagId)
);
CREATE INDEX SkillProductTag_skillId_idx ON SkillProductTag(skillId);
CREATE INDEX SkillProductTag_productTagId_idx ON SkillProductTag(productTagId);
```

---

## 三、Skill 模型变更

### 新增字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `categoryId` | TEXT | `cat-vulnerability-mining` | 关联 SkillCategory，必填 |
| `vulnerabilityTreeId` | TEXT | NULL | 关联 VulnerabilityTree（漏洞模式节点），仅漏洞挖掘类必填 |

### 新增索引

```sql
CREATE INDEX Skill_categoryId_idx ON Skill(categoryId);
CREATE INDEX Skill_vulnerabilityTreeId_idx ON Skill(vulnerabilityTreeId);
```

---

## 四、种子数据

### SkillCategory（6 条）

| id | name | displayName | icon | sortOrder | hasSubDimension |
|----|------|-------------|------|-----------|-----------------|
| `cat-vulnerability-mining` | vulnerability-mining | 漏洞挖掘 | Bug | 1 | **true** |
| `cat-code-audit` | code-audit | 代码审计 | Search | 2 | false |
| `cat-threat-modeling` | threat-modeling | 威胁建模 | Shield | 3 | false |
| `cat-coding` | coding | 编程开发 | Code | 4 | false |
| `cat-planning` | planning | 规划设计 | LayoutDashboard | 5 | false |
| `cat-data-analysis` | data-analysis | 数据分析 | TrendingUp | 6 | false |

### VulnerabilityTree 语言节点（10 条）

| id | displayName | sortOrder |
|----|-------------|-----------|
| `vt-lang-ccpp` | C/C++ | 1 |
| `vt-lang-java` | Java | 2 |
| `vt-lang-python` | Python | 3 |
| `vt-lang-php` | PHP | 4 |
| `vt-lang-javascript` | JavaScript | 5 |
| `vt-lang-go` | Go | 6 |
| `vt-lang-ruby` | Ruby | 7 |
| `vt-lang-rust` | Rust | 8 |
| `vt-lang-dotnet` | .NET | 9 |
| `vt-lang-general` | 通用 | 10 |

### VulnerabilityTree 漏洞模式节点

从原有 `VulnerabilityPattern` 表动态迁移，根据模式名称和语言字段推断所属语言，无法识别的归入 `通用`。

### Skill 数据迁移

- 全部 214 条现有 Skill 的 `categoryId` 统一设为 `cat-vulnerability-mining`
- `vulnerabilityTreeId` 根据技能名称匹配已知模式名设置，未匹配的为 NULL

### ProductTag

初始不导入种子数据，通过管理页面按需创建。

---

## 五、迁移脚本

- **Schema 变更**：`npx prisma db push --accept-data-loss`
- **种子数据**：`node scripts/seed-skill-dimensions.js`

---

## 六、关联 API

| 端点 | 说明 |
|------|------|
| `GET /api/skills/categories` | 返回分类列表（含技能数量） |
| `GET /api/skills/vulnerability-tree` | 返回语言→模式树结构 |
| `GET /api/skills/product-tags` | 返回产品标签列表 |
| `GET /api/skills?categoryId=&languageId=&patternId=&productTagId=` | 按维度筛选 |
| `POST /api/skills` | 创建时传入 categoryId、vulnerabilityTreeId、productTagIds |
