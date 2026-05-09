'use client';

import { useEffect, useState } from 'react';
import { User, Lock, Save, Eye, EyeOff } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function ProfilePage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // 个人信息表单
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('');
  
  // 密码表单
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [updatingProfile, setUpdatingProfile] = useState(false);
  const [updatingPassword, setUpdatingPassword] = useState(false);

  useEffect(() => {
    fetchUser();
  }, []);

  const fetchUser = async () => {
    try {
      const token = localStorage.getItem('token');
      const userData = localStorage.getItem('user');
      
      if (!token || !userData) {
        window.location.href = '/login';
        return;
      }

      const userObj = JSON.parse(userData);
      setUser(userObj);
      setName(userObj.name || '');
      setAvatar(userObj.avatar || '');
      setLoading(false);
    } catch (err) {
      setError('获取用户信息失败');
      setLoading(false);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setUpdatingProfile(true);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name, avatar }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || '更新个人信息失败');
        setUpdatingProfile(false);
        return;
      }

      // 更新本地存储
      const updatedUser = { ...user, name, avatar };
      localStorage.setItem('user', JSON.stringify(updatedUser));
      setUser(updatedUser);
      setSuccess('个人信息更新成功');
      setUpdatingProfile(false);
      
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('网络错误，请重试');
      setUpdatingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }

    if (newPassword.length < 6) {
      setError('新密码长度至少为 6 位');
      return;
    }

    setUpdatingPassword(true);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/users/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || '修改密码失败');
        setUpdatingPassword(false);
        return;
      }

      setSuccess('密码修改成功');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setUpdatingPassword(false);
      
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('网络错误，请重试');
      setUpdatingPassword(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-bold text-gray-100">个人中心</h1>
        <p className="mt-1 text-sm text-gray-400">
          管理您的个人信息和账户设置
        </p>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-800/40 text-red-300 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-900/20 border border-green-800/40 text-green-300 px-4 py-3 rounded">
          {success}
        </div>
      )}

      {/* 用户信息卡片 */}
      <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-6">
        <div className="flex items-center space-x-4 mb-6">
          {user?.avatar ? (
            <img
              src={user.avatar}
              alt={user.name || user.username}
              className="h-16 w-16 rounded-full"
            />
          ) : (
            <div className="h-16 w-16 rounded-full bg-primary-600 flex items-center justify-center">
              <span className="text-white text-2xl font-medium">
                {(user?.name || user?.username || 'U').charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <div>
            <h2 className="text-xl font-semibold text-gray-100">
              {user?.name || user?.username}
            </h2>
            <p className="text-sm text-gray-500">@{user?.username}</p>
            <p className="text-sm text-gray-500">{user?.email}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {user?.roles?.map((role: string) => (
            <span
              key={role}
              className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-500/15 text-blue-400"
            >
              {role}
            </span>
          ))}
        </div>
      </div>

      {/* 个人信息修改 */}
      <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-6">
        <div className="flex items-center space-x-2 mb-6">
          <User size={20} className="text-gray-400" />
          <h3 className="text-lg font-semibold text-gray-100">个人信息</h3>
        </div>

        <form onSubmit={handleUpdateProfile} className="space-y-4">
          <div>
            <label
              htmlFor="username"
              className="block text-sm font-medium text-gray-300"
            >
              用户名
            </label>
            <input
              id="username"
              type="text"
              value={user?.username || ''}
              disabled
              className="mt-1 block w-full px-3 py-2 border border-gray-600 rounded-md bg-[#0F172A] text-gray-500 cursor-not-allowed"
            />
            <p className="mt-1 text-xs text-gray-500">用户名不可修改</p>
          </div>

          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-300"
            >
              邮箱
            </label>
            <input
              id="email"
              type="email"
              value={user?.email || ''}
              disabled
              className="mt-1 block w-full px-3 py-2 border border-gray-600 rounded-md bg-[#0F172A] text-gray-500 cursor-not-allowed"
            />
            <p className="mt-1 text-xs text-gray-500">邮箱不可修改</p>
          </div>

          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-gray-300"
            >
              姓名
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              placeholder="请输入您的姓名"
            />
          </div>

          <div>
            <label
              htmlFor="avatar"
              className="block text-sm font-medium text-gray-300"
            >
              头像链接
            </label>
            <input
              id="avatar"
              type="url"
              value={avatar}
              onChange={(e) => setAvatar(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              placeholder="https://example.com/avatar.png"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={updatingProfile}
              className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
            >
              <Save size={18} />
              <span>{updatingProfile ? '保存中...' : '保存修改'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* 修改密码 */}
      <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-6">
        <div className="flex items-center space-x-2 mb-6">
          <Lock size={20} className="text-gray-400" />
          <h3 className="text-lg font-semibold text-gray-100">修改密码</h3>
        </div>

        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <label
              htmlFor="currentPassword"
              className="block text-sm font-medium text-gray-300"
            >
              当前密码
            </label>
            <div className="relative mt-1">
              <input
                id="currentPassword"
                type={showCurrentPassword ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="block w-full px-3 py-2 pr-10 border border-gray-600 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                placeholder="请输入当前密码"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-400"
              >
                {showCurrentPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="newPassword"
              className="block text-sm font-medium text-gray-300"
            >
              新密码
            </label>
            <div className="relative mt-1">
              <input
                id="newPassword"
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
                className="block w-full px-3 py-2 pr-10 border border-gray-600 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                placeholder="请输入新密码（至少 6 位）"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-400"
              >
                {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-sm font-medium text-gray-300"
            >
              确认新密码
            </label>
            <div className="relative mt-1">
              <input
                id="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                className="block w-full px-3 py-2 pr-10 border border-gray-600 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                placeholder="请再次输入新密码"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-400"
              >
                {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={updatingPassword}
              className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
            >
              <Lock size={18} />
              <span>{updatingPassword ? '修改中...' : '修改密码'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
