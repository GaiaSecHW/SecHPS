import { TASK_TEMPLATES, applyTaskTemplate } from './templates.js';
import type { TaskDebugForm } from './types.js';

interface TaskTemplatesProps {
  form: TaskDebugForm;
  onApply: (form: TaskDebugForm) => void;
}

export function TaskTemplates({ form, onApply }: TaskTemplatesProps) {
  return (
    <section className="rounded-lg border border-gray-700 bg-dark-bg p-3">
      <h3 className="mb-3 text-sm font-semibold text-gray-100">任务模板</h3>
      <div className="grid gap-2">
        {TASK_TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => onApply(applyTaskTemplate(form, template))}
            className="rounded-lg border border-gray-700 bg-dark-surface px-3 py-2 text-left transition-colors hover:border-blue-500/60 hover:bg-blue-500/10"
          >
            <div className="text-sm font-medium text-gray-200">{template.label}</div>
            <div className="mt-1 text-xs text-gray-500">{template.description}</div>
          </button>
        ))}
      </div>
    </section>
  );
}
