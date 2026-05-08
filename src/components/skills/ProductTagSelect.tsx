'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

interface ProductTagItem {
  id: string;
  name: string;
  displayName: string;
}

interface Props {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function ProductTagSelect({ selectedIds, onChange }: Props) {
  const [tags, setTags] = useState<ProductTagItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchTags = async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/skills/product-tags', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setTags(data.productTags || []);
        }
      } catch (e) {
        console.error('加载产品标签失败:', e);
      } finally {
        setLoading(false);
      }
    };
    fetchTags();
  }, []);

  if (loading) {
    return <p className="text-sm text-gray-500">加载中...</p>;
  }

  if (tags.length === 0) {
    return (
      <div className="flex items-center gap-2">
        <span className="px-2 py-1 text-sm bg-green-100 text-green-400 rounded">所有产品（暂无产品标签）</span>
      </div>
    );
  }

  const toggleTag = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter(t => t !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const selectedTags = tags.filter(t => selectedIds.includes(t.id));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {tags.map(tag => (
          <button
            key={tag.id}
            type="button"
            onClick={() => toggleTag(tag.id)}
            className={`px-3 py-1 text-sm rounded-full border transition-colors ${
              selectedIds.includes(tag.id)
                ? 'bg-green-100 text-green-400 border-green-300'
                : 'bg-dark-surface text-gray-400 border-gray-600 hover:border-gray-400'
            }`}
          >
            {tag.displayName}
          </button>
        ))}
      </div>
      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-1 items-center">
          <span className="text-xs text-gray-500">已选：</span>
          {selectedTags.map(tag => (
            <span key={tag.id} className="inline-flex items-center px-2 py-0.5 text-xs bg-green-100 text-green-400 rounded">
              {tag.displayName}
              <button
                type="button"
                onClick={() => toggleTag(tag.id)}
                className="ml-1 text-green-500 hover:text-green-400"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {selectedIds.length === 0 && (
        <p className="text-xs text-gray-400">不选择则默认适用于所有产品</p>
      )}
    </div>
  );
}
