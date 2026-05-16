'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronRight, ChevronDown, Search, X } from 'lucide-react';

export interface ProductNode {
  id: string;
  label: string;
  children?: ProductNode[];
}

interface Props {
  value: string;
  onChange: (value: string) => void;
}

// Mock 数据 - 华为产品线（5 层：产品域 > 产品线 > 产品 > 子产品 > 产品版本）
const MOCK_TREE: ProductNode[] = [
  {
    id: 'operator', label: '运营商业务', children: [
      {
        id: 'cloud-core', label: '云核心网', children: [
          {
            id: '5gc', label: '5GC', children: [
              {
                id: 'amf', label: 'AMF', children: [
                  { id: 'amf-v1r1', label: 'AMF V1R1C00' },
                  { id: 'amf-v1r2', label: 'AMF V1R2C00' },
                  { id: 'amf-v2r1', label: 'AMF V2R1C00' },
                ],
              },
              {
                id: 'smf', label: 'SMF', children: [
                  { id: 'smf-v1r1', label: 'SMF V1R1C00' },
                  { id: 'smf-v1r3', label: 'SMF V1R3C00' },
                ],
              },
              {
                id: 'upf', label: 'UPF', children: [
                  { id: 'upf-v1r1', label: 'UPF V1R1C00' },
                  { id: 'upf-v2r1', label: 'UPF V2R1C00' },
                ],
              },
            ],
          },
          {
            id: 'ims', label: 'IMS', children: [
              {
                id: 'cscf', label: 'CSCF', children: [
                  { id: 'cscf-v1r1', label: 'CSCF V1R1C00' },
                  { id: 'cscf-v2r1', label: 'CSCF V2R1C00' },
                ],
              },
              {
                id: 'tas', label: 'TAS', children: [
                  { id: 'tas-v1r1', label: 'TAS V1R1C00' },
                ],
              },
            ],
          },
        ],
      },
      {
        id: 'datacom', label: '数据通信', children: [
          {
            id: 'router', label: '路由器', children: [
              {
                id: 'ne40e', label: 'NE40E', children: [
                  { id: 'ne40e-v1r1', label: 'NE40E V1R1C00' },
                  { id: 'ne40e-v1r2', label: 'NE40E V1R2C00' },
                  { id: 'ne40e-v2r1', label: 'NE40E V2R1C00' },
                ],
              },
              {
                id: 'ne8000', label: 'NE8000', children: [
                  { id: 'ne8000-v1r1', label: 'NE8000 V1R1C00' },
                  { id: 'ne8000-v1r2', label: 'NE8000 V1R2C00' },
                  { id: 'ne8000-v2r1', label: 'NE8000 V2R1C00' },
                ],
              },
            ],
          },
          {
            id: 'switch', label: '交换机', children: [
              {
                id: 'ce6800', label: 'CE6800', children: [
                  { id: 'ce6800-v1r1', label: 'CE6800 V1R1C00' },
                  { id: 'ce6800-v2r1', label: 'CE6800 V2R1C00' },
                ],
              },
              {
                id: 'ce12800', label: 'CE12800', children: [
                  { id: 'ce12800-v1r1', label: 'CE12800 V1R1C00' },
                  { id: 'ce12800-v1r3', label: 'CE12800 V1R3C00' },
                ],
              },
            ],
          },
        ],
      },
      {
        id: 'wireless', label: '无线网络', children: [
          {
            id: 'ran', label: 'RAN', children: [
              {
                id: 'gnodeb', label: 'gNodeB', children: [
                  { id: 'gnb-v1r1', label: 'gNodeB V1R1C00' },
                  { id: 'gnb-v2r1', label: 'gNodeB V2R1C00' },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'enterprise', label: '企业业务', children: [
      {
        id: 'security', label: '网络安全', children: [
          {
            id: 'firewall', label: '防火墙', children: [
              {
                id: 'usg6000e', label: 'USG6000E', children: [
                  { id: 'usg6000e-v1r1', label: 'USG6000E V1R1C00' },
                  { id: 'usg6000e-v1r2', label: 'USG6000E V1R2C00' },
                ],
              },
              {
                id: 'usg9500', label: 'USG9500', children: [
                  { id: 'usg9500-v1r1', label: 'USG9500 V1R1C00' },
                  { id: 'usg9500-v2r1', label: 'USG9500 V2R1C00' },
                ],
              },
            ],
          },
          {
            id: 'vpn', label: 'VPN网关', children: [
              {
                id: 'sgw', label: 'Secospace', children: [
                  { id: 'sgw-v1r1', label: 'Secospace V1R1C00' },
                ],
              },
            ],
          },
        ],
      },
      {
        id: 'storage', label: '存储', children: [
          {
            id: 'oceanstor', label: 'OceanStor', children: [
              {
                id: 'oceanstor-dorado', label: 'Dorado', children: [
                  { id: 'dorado-v1r1', label: 'Dorado V1R1C00' },
                  { id: 'dorado-v2r1', label: 'Dorado V2R1C00' },
                ],
              },
              {
                id: 'oceanstor-pacific', label: 'Pacific', children: [
                  { id: 'pacific-v1r1', label: 'Pacific V1R1C00' },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'cloud', label: '华为云', children: [
      {
        id: 'ecs', label: '计算', children: [
          {
            id: 'ecs-instance', label: 'ECS', children: [
              { id: 'ecs-v1r1', label: 'ECS V1R1C00' },
              { id: 'ecs-v2r1', label: 'ECS V2R1C00' },
            ],
          },
        ],
      },
      {
        id: 'vpc', label: '网络', children: [
          {
            id: 'vpc-service', label: 'VPC', children: [
              { id: 'vpc-v1r1', label: 'VPC V1R1C00' },
              { id: 'vpc-v1r2', label: 'VPC V1R2C00' },
            ],
          },
          {
            id: 'elb', label: 'ELB', children: [
              { id: 'elb-v1r1', label: 'ELB V1R1C00' },
            ],
          },
        ],
      },
    ],
  },
];

function isLeaf(node: ProductNode): boolean {
  return !node.children || node.children.length === 0;
}

function filterTree(nodes: ProductNode[], query: string): ProductNode[] {
  return nodes
    .map(node => {
      if (isLeaf(node)) {
        return node.label.toLowerCase().includes(query) ? node : null;
      }
      const filteredChildren = node.children ? filterTree(node.children, query) : [];
      if (filteredChildren.length > 0 || node.label.toLowerCase().includes(query)) {
        return { ...node, children: filteredChildren.length > 0 ? filteredChildren : node.children };
      }
      return null;
    })
    .filter(Boolean) as ProductNode[];
}

function TreeNode({
  node,
  depth,
  selectedValue,
  onSelect,
}: {
  node: ProductNode;
  depth: number;
  selectedValue: string;
  onSelect: (node: ProductNode) => void;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const leaf = isLeaf(node);

  return (
    <div>
      <button
        type="button"
        className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-sm rounded hover:bg-blue-900/30 transition-colors text-left ${
          selectedValue === node.label ? 'bg-blue-900/40 text-blue-300' : 'text-gray-200'
        }`}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        onClick={() => {
          if (leaf) {
            onSelect(node);
          } else {
            setExpanded(!expanded);
          }
        }}
      >
        {!leaf && (
          expanded
            ? <ChevronDown size={14} className="shrink-0 text-gray-400" />
            : <ChevronRight size={14} className="shrink-0 text-gray-400" />
        )}
        <span className={leaf ? 'truncate' : 'font-medium truncate'}>{node.label}</span>
      </button>
      {!leaf && expanded && node.children?.map(child => (
        <TreeNode
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedValue={selectedValue}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export default function ProductTreeSelect({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filteredTree = search.trim()
    ? filterTree(MOCK_TREE, search.trim().toLowerCase())
    : MOCK_TREE;

  const handleSelect = (node: ProductNode) => {
    onChange(node.label);
    setOpen(false);
    setSearch('');
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`w-full px-3 py-2 border rounded-md text-left flex items-center justify-between transition-colors ${
          open ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-600'
        } ${value ? 'text-gray-200' : 'text-gray-500'}`}
      >
        <span className="truncate">{value || '请选择产品名称'}</span>
        <div className="flex items-center gap-1">
          {value && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onChange(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onChange(''); } }}
              className="p-0.5 hover:text-red-400 text-gray-400"
            >
              <X size={14} />
            </span>
          )}
          <ChevronDown size={16} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-[#0F172A] border border-gray-600 rounded-md shadow-xl max-h-80 flex flex-col">
          {/* 搜索框 */}
          <div className="p-2 border-b border-gray-700/50">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索产品..."
                className="w-full pl-8 pr-3 py-1.5 text-sm bg-dark-bg border border-gray-700 rounded focus:outline-none focus:border-blue-500 text-gray-200 placeholder-gray-500"
                autoFocus
              />
            </div>
          </div>
          {/* 树 */}
          <div className="overflow-y-auto flex-1 p-1">
            {filteredTree.length === 0 ? (
              <div className="text-center py-6 text-sm text-gray-500">无匹配结果</div>
            ) : (
              filteredTree.map(node => (
                <TreeNode
                  key={node.id}
                  node={node}
                  depth={0}
                  selectedValue={value}
                  onSelect={handleSelect}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
