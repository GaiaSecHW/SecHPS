'use client';

import MarkdownRenderer from './markdown/MarkdownRenderer';

interface LegacyMarkdownRendererProps {
  content: string;
  onCopy?: () => void;
}

export default function LegacyMarkdownRenderer({ content }: LegacyMarkdownRendererProps) {
  return <MarkdownRenderer content={content} />;
}