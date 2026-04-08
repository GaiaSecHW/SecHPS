'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // 检查是否已登录
    const token = localStorage.getItem('token');
    console.log('Home page - checking token:', token ? 'exists' : 'not found');

    if (token) {
      // 已登录，跳转到 Dashboard
      console.log('Redirecting to dashboard...');
      router.push('/dashboard');
    } else {
      // 未登录，跳转到登录页
      console.log('Redirecting to login...');
      router.push('/login');
    }
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-blue-500 mx-auto"></div>
        <p className="mt-4 text-gray-600">加载中...</p>
      </div>
    </div>
  );
}
