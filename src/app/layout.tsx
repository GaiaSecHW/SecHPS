import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '',
  description: '基于角色权限控制的 AI 编程助手平台',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className="h-full overflow-hidden">
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}