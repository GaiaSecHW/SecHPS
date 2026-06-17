'use client';

import { useMemo } from 'react';
import Convert from 'ansi-to-html';

const converter = new Convert({
  fg: '#d4d4d4',
  bg: '#1e1e1e',
  newline: false,
  escapeXML: true,
  stream: false,
});

const stripConverter = new Convert({
  fg: '#d4d4d4',
  newline: false,
  escapeXML: true,
  stream: false,
});

function stripAnsiCodes(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/␛\[[0-9;]*[a-zA-Z]/g, '');
}

interface AnsiTextProps {
  text: string;
  className?: string;
  as?: 'pre' | 'span' | 'div';
  strip?: boolean;
}

export function AnsiText({ text, className = '', as = 'pre', strip = false }: AnsiTextProps) {
  const html = useMemo(() => {
    if (!text) return '';
    let processed = text;
    processed = processed.replace(/␛/g, '\x1b');
    if (strip) {
      return stripAnsiCodes(processed);
    }
    return converter.toHtml(processed);
  }, [text, strip]);

  if (strip) {
    const Element = as;
    return <Element className={className}>{html}</Element>;
  }

  const Element = as;
  return (
    <Element
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
