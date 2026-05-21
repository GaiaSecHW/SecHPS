# 响应式布局系统使用指南

## 核心原则

### 禁止的做法

```tsx
// ❌ 不要使用固定 px
<div style={{ width: '1200px' }}>

// ❌ 不要写死高度
<div className="h-[500px]">

// ❌ 不要使用 transform scale
<div style={{ transform: 'scale(0.8)' }}>

// ❌ 不要整页 body 滚动
<body className="overflow-y-auto">

// ❌ 不要使用 magic number
<div className="w-[320px]">

// ❌ 不要写死 grid 列数
<div className="grid-cols-4">
```

### 推荐的做法

```tsx
// ✅ 使用 Flex 和 Grid
<div className="flex flex-1 min-w-0">
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">

// ✅ 使用 minmax 和 auto-fit
<div className="grid-cols-[repeat(auto-fit,minmax(280px,1fr))]">

// ✅ 使用 clamp 和 max-width
<div className="max-w-screen-2xl mx-auto">

// ✅ 局部滚动
<main className="overflow-y-auto overflow-x-hidden">

// ✅ 自适应卡片
<div className="min-h-[200px]">

// ✅ 响应式 Typography
<h1 className="text-xl md:text-2xl lg:text-3xl">
```

## 布局组件

### AppLayout - 应用根布局

```tsx
import { AppLayout } from '@/components/layout';

export default function App() {
  return (
    <AppLayout
      sidebar={<CustomSidebar />}
      headerContent={<BroadcastMarquee />}
    >
      <YourContent />
    </AppLayout>
  );
}
```

### Container - 内容容器

```tsx
import { Container, PageContainer, ContentContainer } from '@/components/layout';

// 页面级容器
<PageContainer 
  title="页面标题"
  description="页面描述"
  actions={<Button>操作</Button>}
>
  {children}
</PageContainer>

// 内容级容器
<Container size="2xl">
  {children}
</Container>

// Markdown 阅读区域
<ContentContainer maxWidth="prose">
  <MarkdownContent>{content}</MarkdownContent>
</ContentContainer>
```

### ResponsiveGrid - 响应式网格

```tsx
import { ResponsiveGrid, FixedGrid, BentoGrid, BentoItem } from '@/components/layout';

// 自动适配网格
<ResponsiveGrid minItemWidth={280} gap="md">
  {items.map(item => <Card key={item.id}>{item}</Card>)}
</ResponsiveGrid>

// 固定列数网格
<FixedGrid cols={{ base: 1, md: 2, lg: 3, xl: 4 }} gap="lg">
  {cards}
</FixedGrid>

// Bento 网格 (12列)
<BentoGrid>
  <BentoItem colSpan={{ base: 12, md: 6, lg: 4 }}>
    <Card>...</Card>
  </BentoItem>
  <BentoItem colSpan={{ base: 12, lg: 8 }} rowSpan={2}>
    <Card>...</Card>
  </BentoItem>
</BentoGrid>
```

### Card - 卡片系统

```tsx
import { Card, CardHeader, CardContent, CardFooter, MetricCard } from '@/components/layout';

// 标准卡片
<Card variant="default" padding="md" hover>
  <CardHeader 
    title="卡片标题"
    description="卡片描述"
    icon={<Icon />}
    actions={<Button>操作</Button>}
    border
  />
  <CardContent scroll>
    {content}
  </CardContent>
  <CardFooter border>
    {footer}
  </CardFooter>
</Card>

// 指标卡片
<MetricCard
  label="总任务"
  value={100}
  icon={<Activity />}
  color="cyan"
  trend="up"
  trendValue="+12%"
/>
```

### Typography - 文字排版

```tsx
import { PageTitle, SectionTitle, Description, Label, Text, Badge } from '@/components/layout';

<PageTitle>页面标题</PageTitle>
<SectionTitle>区域标题</SectionTitle>
<Description>描述文字</Description>
<Label muted>标签</Label>
<Text size="base" color="secondary">正文</Text>
<Badge color="cyan">标签</Badge>
```

### ResponsiveTable - 表格

```tsx
import { DataTable, ResponsiveTable, TableHeader, TableBody, TableRow, TableCell, TableHeaderCell } from '@/components/layout';

// 简化 DataTable
<DataTable
  columns={[
    { key: 'name', header: '名称', width: 200 },
    { key: 'status', header: '状态', render: row => <Badge>{row.status}</Badge> },
    { key: 'createdAt', header: '创建时间', align: 'right' },
  ]}
  data={data}
  onRowClick={row => console.log(row)}
/>

// 自定义表格
<ResponsiveTable minWidth={800}>
  <TableHeader>
    <TableRow>
      <TableHeaderCell>名称</TableHeaderCell>
      <TableHeaderCell align="right">状态</TableHeaderCell>
    </TableRow>
  </TableHeader>
  <TableBody>
    {data.map(row => (
      <TableRow key={row.id} onClick={() => handleRowClick(row)}>
        <TableCell truncate>{row.name}</TableCell>
        <TableCell align="right">{row.status}</TableCell>
      </TableRow>
    ))}
  </TableBody>
</ResponsiveTable>
```

### Markdown 阅读区域

```tsx
import { MarkdownContent, MarkdownReader, MarkdownChat } from '@/components/markdown';

// 文档阅读
<MarkdownReader title="文档标题">
  {markdownContent}
</MarkdownReader>

// 聊天内容
<MarkdownChat>
  {chatContent}
</MarkdownChat>

// 自定义宽度
<MarkdownContent maxWidth="wide" variant="docs">
  {content}
</MarkdownContent>
```

## Tailwind 响应式类

### 布局基础

```tsx
// Flex 布局
<div className="flex flex-1 min-w-0">

// Grid 布局
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">

// 自适应网格
<div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))]">
```

### Container 系统

```tsx
// 标准 Container
<div className="w-full max-w-screen-2xl mx-auto px-4 md:px-6 lg:px-8">

// 内容最大宽度
<div className="max-w-prose mx-auto">
<div className="max-w-4xl mx-auto">
```

### 滚动区域

```tsx
// 主内容区滚动
<main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar content-scrollbar">

// Sidebar 滚动
<nav className="overflow-y-auto overflow-x-hidden custom-scrollbar sidebar-scrollbar">

// 表格滚动
<div className="overflow-x-auto overflow-y-hidden">
```

### 防止横向滚动

```tsx
// 所有 flex/grid 子元素
<div className="min-w-0">

// 文字截断
<span className="truncate">

// 代码块
<pre className="overflow-x-auto">

// 表格
<div className="overflow-x-auto">
  <table className="min-w-full">
```

### 响应式间距

```tsx
// Gap
<div className="gap-3 md:gap-4 lg:gap-6">

// Padding
<div className="px-4 md:px-6 lg:px-8">
<div className="py-4 md:py-6 lg:py-8">

// Margin
<div className="mb-4 md:mb-6 lg:mb-8">
```

### 响应式尺寸

```tsx
// Typography
<h1 className="text-xl md:text-2xl lg:text-3xl">
<p className="text-sm md:text-base lg:text-lg">

// Icons
<Icon size={16} className="md:size-[18px] lg:size-5" />

// Buttons
<button className="px-3 py-2 md:px-4 md:py-2.5">
```

## 颜色系统

```tsx
// 背景
bg-zinc-950    // 主背景
bg-zinc-900    // Surface 背景
bg-zinc-800    // Hover 背景

// 边框
border-zinc-800  // 标准边框
border-zinc-700  // 高亮边框

// 文字
text-zinc-100  // 主文字
text-zinc-300  // 次级文字
text-zinc-400  // 描述文字
text-zinc-500  // Muted 文字

// Accent
text-cyan-400  // 主 Accent
text-cyan-500  // Accent hover
```

## 实战示例

### Dashboard 页面

```tsx
export default function DashboardPage() {
  return (
    <div className="space-y-5 md:space-y-6 w-full min-w-0">
      {/* Header */}
      <header className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 md:px-5 py-3 md:py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-lg md:text-xl font-semibold truncate">标题</h1>
          </div>
          <Button className="flex-shrink-0">操作</Button>
        </div>
      </header>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-5 w-full">
        <div className="lg:col-span-8 xl:col-span-9 space-y-4 md:space-y-5 min-w-0">
          {/* Cards */}
        </div>
        <div className="lg:col-span-4 xl:col-span-3 space-y-4 md:space-y-5 min-w-0">
          {/* Sidebar cards */}
        </div>
      </div>
    </div>
  );
}
```

### 表格页面

```tsx
export default function TablePage() {
  return (
    <PageContainer title="数据列表">
      <DataTable
        columns={[
          { key: 'name', header: '名称', width: 200, truncate: true },
          { key: 'status', header: '状态', render: row => <Badge>{row.status}</Badge> },
        ]}
        data={data}
      />
    </PageContainer>
  );
}
```

### Markdown 文档页面

```tsx
export default function DocPage() {
  return (
    <article className="min-h-full py-6 md:py-8 lg:py-10">
      <MarkdownReader title={doc.title}>
        {doc.content}
      </MarkdownReader>
    </article>
  );
}
```

## 注意事项

1. **所有 flex/grid 子元素必须加 `min-w-0`**
2. **文字截断必须配合 `min-w-0` 和 `truncate`**
3. **表格必须有 `overflow-x-auto` 容器**
4. **代码块必须能横向滚动**
5. **主内容区必须是 `flex-1 min-h-0`**
6. **不要在 body 上设置 `overflow-y-auto`**
7. **页面整体高度必须是 `h-screen overflow-hidden`**