# SKILL 三维度分类体系重构设计

## 背景

当前 SKILL 使用 TechStackOption + VulnerabilityPattern 两个独立字段关联，无法满足未来演进需求。需要重构为三维度分类体系。

## 三维度设计

### 维度一：SKILL 分类（SkillCategory）

所有 SKILL 必须属于一个分类，分类数据独立表维护。

预设分类：
- 漏洞挖掘（hasSubDimension=true）
- 编程开发、规划设计、数据分析、代码审计、威胁建模

### 维度二：语言→模式库（VulnerabilityTree）

仅维度一为"漏洞挖掘"时生效。树形结构：

```
├── Java
│   ├── 反序列化
│   └── SQL注入(MyBatis)
├── Python
│   └── 模板注入(SSTI)
├── 通用
│   ├── 弱口令
│   └── 越权访问
```

"通用"伪语言节点存放跨语言模式，查询时用 `OR 语言='通用'` 联合查询。

### 维度三：产品标签（ProductTag）

标签模式，Skill 可打多个产品标签，不打标签 = 适用于所有产品。

## 数据模型

### SkillCategory

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | `cat-xxx` |
| name | TEXT UNIQUE | `vulnerability-mining` |
| displayName | TEXT | 漏洞挖掘 |
| description | TEXT | 分类描述 |
| icon | TEXT? | 前端图标 |
| sortOrder | INT | 排序权重 |
| isActive | BOOLEAN | 是否启用 |
| hasSubDimension | BOOLEAN | 是否需要第二维度 |

### VulnerabilityTree

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | `vt-xxx` |
| name | TEXT | `java`、`sql-injection` |
| displayName | TEXT | Java、SQL注入 |
| type | TEXT | `language` 或 `pattern` |
| parentId | TEXT? FK→自身 | null=语言，非null=模式 |
| description | TEXT? | 描述 |
| sortOrder | INT | 同级排序 |
| isActive | BOOLEAN | 是否启用 |

### ProductTag

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | `pt-xxx` |
| name | TEXT UNIQUE | `huawei-cloud-waf` |
| displayName | TEXT | 华为云WAF |
| description | TEXT? | 描述 |
| isActive | BOOLEAN | 是否启用 |

### Skill 表改动

- 删除 `techStackId`、`vulnerabilityPatternId`
- 新增 `categoryId` FK→SkillCategory
- 新增 `vulnerabilityTreeId` FK→VulnerabilityTree（nullable）

### SkillProductTag（关联表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | `spt-xxx` |
| skillId | TEXT FK | → Skill |
| productTagId | TEXT FK | → ProductTag |

## 数据迁移

1. Seed 分类基础数据和维度二语言/模式树
2. 现有 VulnerabilityPattern (41条) 按语言分配到树结构下
3. 现有 Skill (214条) 全部映射到"漏洞挖掘"分类，通过原 techStackId 和 vulnerabilityPatternId 找到对应的 VulnerabilityTree 节点
4. 产品标签暂为空（=通用）
5. TechStackOption、VulnerabilityPattern、VulnerabilityCategory 表保留但不再与 Skill 关联

## 前端交互

### SKILL 列表筛选

```
[分类▾]  [语言▾]  [模式库▾]  [产品标签▾]
```

- 选"漏洞挖掘"后语言和模式库才出现
- 语言联动模式库
- 产品标签筛选：显示有该标签的 + 未打标签的通用 Skill

### SKILL 创建/编辑

- 维度一：分类下拉（必填）
- 维度二：语言→模式库下拉（仅漏洞挖掘时显示，语言默认"通用"）
- 维度三：产品标签多选（可选，默认不选=所有产品）

### SKILL 详情标签展示

```
[漏洞挖掘]  [Java]  [SQL注入]  [适用: 所有产品]
```

## API 变更

### 修改的接口

| 接口 | 改动 |
|------|------|
| GET /api/skills | 新增 categoryId、languageId、patternId、productTagId 查询参数 |
| POST /api/skills | 新增 categoryId(必填)、vulnerabilityTreeId(条件必填)、productTagIds(可选) |
| PUT /api/skills/[id] | 同上 |
| GET /api/skills/[id] | 响应包含三个维度信息 |

### 新增的接口

| 接口 | 说明 |
|------|------|
| GET /api/skills/categories | 返回所有 SkillCategory |
| GET /api/skills/vulnerability-tree | 返回维度二完整树结构 |
| GET /api/skills/product-tags | 返回所有产品标签 |

### 校验规则

- category.hasSubDimension=true 时 vulnerabilityTreeId 必填
- vulnerabilityTreeId 必须是 type='pattern' 的叶子节点

## 管理页面

暂不实现。维度数据通过 seed 脚本维护，后续有需要时再添加管理界面。
