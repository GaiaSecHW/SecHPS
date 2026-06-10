import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface ApiParam {
  name: string;
  type: string;
  required?: boolean;
  desc: string;
}

export interface ApiEndpoint {
  method: string;
  path: string;
  desc: string;
  requestParams?: ApiParam[];
  requestBody?: ApiParam[];
  response?: ApiParam[];
}

export function ApiDocCard({ endpoint }: { endpoint: ApiEndpoint }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center space-x-3 p-4 bg-dark-bg hover:bg-dark-surface-hover transition-colors"
      >
        <span className={`px-2 py-0.5 text-xs font-medium rounded ${
          endpoint.method === 'GET' ? 'bg-green-500/15 text-green-400' :
          endpoint.method === 'POST' ? 'bg-blue-500/15 text-blue-400' :
          endpoint.method === 'PATCH' ? 'bg-yellow-500/15 text-yellow-400' :
          'bg-red-500/15 text-red-400'
        }`}>
          {endpoint.method}
        </span>
        <code className="text-sm text-gray-200 font-mono flex-1 text-left">{endpoint.path}</code>
        <span className="text-sm text-gray-500">{endpoint.desc}</span>
        {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>

      {expanded && (
        <div className="p-4 space-y-4 border-t">
          {endpoint.requestParams && endpoint.requestParams.length > 0 && (
            <div>
              <h5 className="text-xs font-medium text-gray-500 uppercase mb-2">URL 参数</h5>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-gray-400"><th className="pb-1">参数</th><th className="pb-1">类型</th><th className="pb-1">必填</th><th className="pb-1">说明</th></tr></thead>
                <tbody className="text-gray-300">
                  {endpoint.requestParams.map((p) => (
                    <tr key={p.name} className="border-t">
                      <td className="py-2 font-mono text-blue-400">{p.name}</td>
                      <td className="py-2 text-gray-500">{p.type}</td>
                      <td className="py-2">{p.required ? <span className="text-red-500">是</span> : <span className="text-gray-400">否</span>}</td>
                      <td className="py-2">{p.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {endpoint.requestBody && endpoint.requestBody.length > 0 && (
            <div>
              <h5 className="text-xs font-medium text-gray-500 uppercase mb-2">请求体 (JSON)</h5>
              <pre className="bg-gray-900 text-cyan-400 p-3 rounded text-xs overflow-x-auto border border-gray-700">
{JSON.stringify(endpoint.requestBody.reduce((acc, p) => ({ ...acc, [p.name]: p.type }), {}), null, 2)}
              </pre>
              <table className="w-full text-sm mt-2">
                <thead><tr className="text-left text-gray-400"><th className="pb-1">字段</th><th className="pb-1">类型</th><th className="pb-1">必填</th><th className="pb-1">说明</th></tr></thead>
                <tbody className="text-gray-300">
                  {endpoint.requestBody.map((p) => (
                    <tr key={p.name} className="border-t">
                      <td className="py-2 font-mono text-blue-400">{p.name}</td>
                      <td className="py-2 text-gray-500">{p.type}</td>
                      <td className="py-2">{p.required ? <span className="text-red-500">是</span> : <span className="text-gray-400">否</span>}</td>
                      <td className="py-2">{p.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {endpoint.response && endpoint.response.length > 0 && (
            <div>
              <h5 className="text-xs font-medium text-gray-500 uppercase mb-2">响应示例</h5>
              <pre className="bg-gray-900 text-cyan-400 p-3 rounded text-xs overflow-x-auto border border-gray-700">
{JSON.stringify(endpoint.response.reduce((acc, p) => ({ ...acc, [p.name]: p.type }), {}), null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
