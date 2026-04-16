'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  AlertTriangle,
  Loader2,
  Users,
} from 'lucide-react';
import { hasPermission } from '@/lib/permissions';
import { PERMISSIONS } from '@/types/permissions';
import { VisualTeamEditor } from '@/components/agent-team/VisualTeamEditor';
import type { RalphLoopConfig } from '@/types/ralph-loop-config';
import { DEFAULT_RALPH_LOOP_CONFIG } from '@/types/ralph-loop-config';

// ============ Types ============

interface AgentDefinition {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  model: string;
  allowedTools: string[];
  skills: string[];
  mcpServers: any[];
  isBuiltin: boolean;
  isActive: boolean;
}

interface TeamMember {
  id: string;
  agentId: string;
  agent?: AgentDefinition;
  role: 'lead' | 'teammate';
  overrideModel: string | null;
  overrideTools: string[] | null;
}

interface AgentTeam {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  leadAgentId: string;
  leadAgentName: string | null;
  taskStrategy: string;
  maxTeammates: number;
  status: 'idle' | 'running';
  createdAt: string;
  updatedAt: string;
  members: TeamMember[];
}

// ============ Loading Component ============

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-blue-500"></div>
    </div>
  );
}

// ============ Main Page ============

export default function VisualTeamEditorPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <VisualTeamEditorPageContent />
    </Suspense>
  );
}

function VisualTeamEditorPageContent() {
  const router = useRouter();
  const params = useParams();
  const teamId = params.id as string;

  // State
  const [team, setTeam] = useState<AgentTeam | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Permissions
  const [canSave, setCanSave] = useState(false);
  const [canExecute, setCanExecute] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Initialize permissions
  useEffect(() => {
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');

    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const permissions = payload.permissions || [];
        setCanSave(hasPermission(permissions, PERMISSIONS.AGENT_TEAM_UPDATE));
        setCanExecute(hasPermission(permissions, PERMISSIONS.AGENT_TEAM_EXECUTE));
        setIsAdmin(Array.isArray(payload.roles) && payload.roles.includes('admin'));
        setCurrentUserId(payload.userId);
      } catch {
        // Token parsing failed
      }
    }

    if (userData) {
      try {
        const user = JSON.parse(userData);
        setIsAdmin(user?.roles?.includes('admin'));
      } catch {
        // User data parsing failed
      }
    }
  }, []);

  // Fetch team data
  useEffect(() => {
    if (teamId) {
      fetchTeam();
    } else {
      setLoading(false);
    }
  }, [teamId]);

  const fetchTeam = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');

      const response = await fetch(`/api/agent-teams/${teamId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '获取团队数据失败');
      }

      const data = await response.json();
      setTeam(data.team);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  // Handle save
  const handleSave = async (data: {
    name: string;
    description: string;
    leadAgentId: string;
    taskStrategy: string;
    maxTeammates: number;
    members: any[];
    dependencies: { from: string; to: string }[];
    ralphConfig: RalphLoopConfig | null;
  }) => {
    const token = localStorage.getItem('token');

    const url = teamId ? `/api/agent-teams/${teamId}` : '/api/agent-teams';
    const method = teamId ? 'PATCH' : 'POST';

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: data.name,
        description: data.description || null,
        leadAgentId: data.leadAgentId,
        taskStrategy: data.taskStrategy,
        maxTeammates: data.maxTeammates,
        members: data.members.map((m) => ({
          agentId: m.agentId,
          role: m.role,
          overrideModel: m.overrideModel,
          overrideTools: m.overrideTools,
        })),
        dependencies: data.dependencies,
        ralphConfig: data.ralphConfig,
      }),
    });

    if (!response.ok) {
      const responseData = await response.json();
      throw new Error(responseData.error || '保存失败');
    }

    const responseData = await response.json();

    // If creating new team, redirect to edit page
    if (!teamId && responseData.team?.id) {
      router.push(`/dashboard/agent-teams/${responseData.team.id}/visual`);
    }
  };

  // Handle execute
  const handleExecute = async () => {
    if (!teamId) {
      toast.error('请先保存团队');
      return;
    }

    try {
      const token = localStorage.getItem('token');

      const response = await fetch(`/api/agent-teams/${teamId}/execute`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '执行失败');
      }

      const data = await response.json();
      toast.success('团队开始执行');

      // Navigate to execution monitoring page
      if (data.executionId) {
        router.push(`/dashboard/agent-teams/${teamId}/execution/${data.executionId}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '执行失败');
    }
  };

  // Permission check
  const canEdit = isAdmin || (team && team.userId === currentUserId);

  if (loading) {
    return <LoadingSpinner />;
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <AlertTriangle className="mx-auto h-12 w-12 text-red-500" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">加载失败</h3>
          <p className="mt-2 text-sm text-gray-600">{error}</p>
          <Link
            href="/dashboard/agent-teams"
            className="mt-4 inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <ArrowLeft size={16} className="mr-2" />
            返回列表
          </Link>
        </div>
      </div>
    );
  }

  // Check if user can edit this team
  if (team && !canEdit) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <AlertTriangle className="mx-auto h-12 w-12 text-red-500" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">权限不足</h3>
          <p className="mt-2 text-sm text-gray-600">您没有编辑此团队的权限</p>
          <Link
            href="/dashboard/agent-teams"
            className="mt-4 inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <ArrowLeft size={16} className="mr-2" />
            返回列表
          </Link>
        </div>
      </div>
    );
  }

  // Prepare initial data for editor
  const initialData = team
    ? {
        name: team.name,
        description: team.description || '',
        leadAgentId: team.leadAgentId,
        taskStrategy: team.taskStrategy,
        maxTeammates: team.maxTeammates,
        members: team.members.map((m) => ({
          id: m.id,
          agentId: m.agentId,
          role: m.role,
          overrideModel: m.overrideModel,
          overrideTools: m.overrideTools,
          dependsOn: [],
        })),
        ralphConfig: DEFAULT_RALPH_LOOP_CONFIG,
      }
    : undefined;

  return (
    <div className="h-screen flex flex-col">
      {/* Back Link */}
      <div className="absolute top-4 left-4 z-10">
        <Link
          href="/dashboard/agent-teams"
          className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg shadow-md border border-gray-200 hover:bg-gray-50 transition-colors"
        >
          <ArrowLeft size={16} className="text-gray-600" />
          <span className="text-sm text-gray-700">返回列表</span>
        </Link>
      </div>

      {/* Visual Editor */}
      <VisualTeamEditor
        teamId={teamId}
        initialData={initialData}
        onSave={handleSave}
        onExecute={handleExecute}
        canExecute={canExecute}
        canSave={canSave}
      />
    </div>
  );
}