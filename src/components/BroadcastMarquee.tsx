'use client';

import { useEffect, useState } from 'react';
import { Megaphone } from 'lucide-react';

interface BroadcastConfig {
  content: string;
  enabled: boolean;
  color: string;
}

const COLOR_MAP: Record<string, { bg: string; gradient: string }> = {
  blue: {
    bg: 'bg-blue-500',
    gradient: 'bg-gradient-to-r from-blue-600 via-blue-500 to-blue-600',
  },
  yellow: {
    bg: 'bg-yellow-500',
    gradient: 'bg-gradient-to-r from-yellow-600 via-yellow-500 to-yellow-600',
  },
  red: {
    bg: 'bg-red-500',
    gradient: 'bg-gradient-to-r from-red-600 via-red-500 to-red-600',
  },
  green: {
    bg: 'bg-green-500',
    gradient: 'bg-gradient-to-r from-green-600 via-green-500 to-green-600',
  },
};

export function BroadcastMarquee() {
  const [config, setConfig] = useState<BroadcastConfig | null>(null);
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);
  const [messages, setMessages] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/broadcast')
      .then((res) => res.json())
      .then((data) => {
        setConfig(data.config);
        // 支持多条消息，用 || 分隔
        const msgList = data.config.content
          .split('||')
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 0);
        setMessages(msgList);
      })
      .catch(() => {
        // 使用默认配置
        setConfig({
          content: '欢迎使用 AI4WEB 测试平台',
          enabled: true,
          color: 'blue',
        });
        setMessages(['欢迎使用 AI4WEB 测试平台']);
      });
  }, []);

  // 多条消息轮播
  useEffect(() => {
    if (messages.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentMessageIndex((prev) => (prev + 1) % messages.length);
    }, 20000);
    return () => clearInterval(interval);
  }, [messages.length]);

  if (!config || !config.enabled) {
    return null;
  }

  const colorStyle = COLOR_MAP[config.color] || COLOR_MAP.blue;
  const currentMessage = messages[currentMessageIndex] || config.content;

  return (
    <div className={`flex-1 overflow-hidden ${colorStyle.gradient} rounded-md shadow-sm h-10`}>
      <div className="flex items-center h-full px-4">
        <Megaphone className="w-5 h-5 text-white mr-3 flex-shrink-0" />
        <div className="overflow-hidden whitespace-nowrap flex-1 relative">
          <span
            className="inline-block animate-marquee text-white font-medium text-base pl-[100%]"
            style={{
              animationDuration: '20s',
            }}
          >
            {currentMessage}
          </span>
        </div>
      </div>
    </div>
  );
}