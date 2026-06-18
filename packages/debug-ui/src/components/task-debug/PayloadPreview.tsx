import type { SubmitTaskPayload } from './types.js';

interface PayloadPreviewProps {
  payload: SubmitTaskPayload;
}

export function PayloadPreview({ payload }: PayloadPreviewProps) {
  return (
    <section className="rounded-lg border border-gray-700 bg-dark-card p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-gray-100">Payload 预览</h3>
        <p className="mt-1 text-xs text-gray-500">POST /api/codeswarm/task/submit</p>
      </div>
      <pre className="max-h-96 overflow-auto rounded-lg border border-gray-700 bg-dark-bg p-3 font-mono text-xs leading-relaxed text-gray-300">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </section>
  );
}
