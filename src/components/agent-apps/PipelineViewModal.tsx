'use client';

import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import { ReactFlowProvider, ReactFlow, Background, Controls, MiniMap, Node, Edge } from '@xyflow/react';
import AgentFlowNode from '@/components/agentflow-editor/AgentFlowNode';

const nodeTypes = {
  agentFlowNode: AgentFlowNode,
};

interface PipelineViewModalProps {
  appId: string | undefined;
  isOpen: boolean;
  onClose: () => void;
}

export function PipelineViewModal({ appId, isOpen, onClose }: PipelineViewModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [pipelineName, setPipelineName] = useState('');

  useEffect(() => {
    if (isOpen && appId) {
      fetchPipeline();
    }
  }, [isOpen, appId]);

  const fetchPipeline = async () => {
    try {
      setLoading(true);
      setError(null);
      const token = localStorage.getItem('token');
      
      const response = await fetch(`/api/agentflow-pipelines?agentAppId=${appId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (!response.ok) {
        throw new Error('获取 Pipeline 失败');
      }
      
      const data = await response.json();
      const pipeline = data.pipelines?.[0];
      
      if (pipeline) {
        setPipelineName(pipeline.name || '未命名 Pipeline');
        setNodes(pipeline.nodes || []);
        setEdges(pipeline.edges || []);
      } else {
        setError('未找到关联的 Pipeline');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-dark-surface rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-border">
          <h2 className="text-lg font-semibold text-white">
            Pipeline 视图: {pipelineName}
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-dark-text-muted hover:text-dark-text-secondary hover:bg-dark-surface-hover rounded-lg"
          >
            <X size={20} />
          </button>
        </div>
        
        <div className="h-[70vh] bg-dark-bg">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="animate-spin text-primary-500" size={32} />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full text-dark-text-muted">
              {error}
            </div>
          ) : (
            <ReactFlowProvider>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                fitView
                attributionPosition="bottom-left"
                minZoom={0.1}
                maxZoom={2}
                defaultViewport={{ x: 0, y: 0, zoom: 1 }}
                style={{ width: '100%', height: '100%' }}
              >
                <Background color="#aaa" gap={16} />
                <Controls showZoom={true} showFitView={true} showInteractive={false} />
                <MiniMap
                  nodeColor="#6B7280"
                  nodeStrokeWidth={3}
                  zoomable={true}
                  pannable={true}
                  className="!bg-dark-surface !border-2 !border-gray-600 !rounded-lg !shadow-lg"
                  style={{ width: 200, height: 150 }}
                  maskColor="rgba(0, 0, 0, 0.1)"
                />
              </ReactFlow>
            </ReactFlowProvider>
          )}
        </div>
      </div>
    </div>
  );
}