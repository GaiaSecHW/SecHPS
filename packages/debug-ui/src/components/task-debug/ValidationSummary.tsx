import type { ValidationIssue } from './types.js';

interface ValidationSummaryProps {
  issues: ValidationIssue[];
}

const rowClassName = {
  error: 'border-red-500/30 bg-red-500/10 text-red-300',
  warning: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300',
} satisfies Record<ValidationIssue['severity'], string>;

export function ValidationSummary({ issues }: ValidationSummaryProps) {
  if (issues.length === 0) {
    return (
      <section className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm font-medium text-green-300">
        校验通过
      </section>
    );
  }

  return (
    <section className="space-y-2">
      {issues.map((issue) => (
        <div key={issue.id} className={`rounded-lg border px-3 py-2 text-sm ${rowClassName[issue.severity]}`}>
          {issue.message}
        </div>
      ))}
    </section>
  );
}
