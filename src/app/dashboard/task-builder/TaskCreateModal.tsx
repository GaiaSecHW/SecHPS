'use client';

import { useState } from 'react';
import { X, CheckCircle2, ArrowRight, ArrowLeft } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import TemplateSelector from './TemplateSelector';
import ParameterForm from './ParameterForm';
import { TASK_TEMPLATES, getTemplateById } from './templates';
import { TaskFormData } from './types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (formData: TaskFormData) => void;
}

const STEPS = [
  { id: 'select', label: '选择模板' },
  { id: 'configure', label: '填写参数' },
] as const;

type StepId = typeof STEPS[number]['id'];

const initialFormData: TaskFormData = {
  templateId: '',
  template: undefined,
  parameters: {},
  notes: '',
};

export default function TaskCreateModal({ isOpen, onClose, onSubmit }: Props) {
  const [currentStep, setCurrentStep] = useState<StepId>('select');
  const [formData, setFormData] = useState<TaskFormData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentStepIndex = STEPS.findIndex(s => s.id === currentStep);

  const handleTemplateSelect = (templateId: string) => {
    const template = getTemplateById(templateId);
    if (template) {
      const defaultParams: Record<string, string> = {};
      template.parameters.forEach(p => {
        if (p.defaultValue) {
          defaultParams[p.name] = p.defaultValue;
        }
      });
      setFormData({
        templateId,
        template,
        parameters: defaultParams,
        notes: '',
      });
    }
  };

  const handleParameterChange = (name: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      parameters: { ...prev.parameters, [name]: value },
    }));
  };

  const handleNotesChange = (notes: string) => {
    setFormData(prev => ({ ...prev, notes }));
  };

  const handleNext = () => {
    if (currentStep === 'select' && formData.templateId) {
      setCurrentStep('configure');
    }
  };

  const handlePrevious = () => {
    if (currentStep === 'configure') {
      setCurrentStep('select');
    }
  };

  const handleSubmit = async () => {
    if (!formData.template) return;

    const missingParams = formData.template.parameters
      .filter(p => p.required && !formData.parameters[p.name]?.trim())
      .map(p => p.label);

    if (missingParams.length > 0) {
      throw new Error(`请填写必填参数: ${missingParams.join(', ')}`);
    }

    setIsSubmitting(true);
    try {
      await onSubmit(formData);
      resetAndClose();
    } catch {
      setIsSubmitting(false);
    }
  };

  const resetAndClose = () => {
    setCurrentStep('select');
    setFormData(initialFormData);
    setIsSubmitting(false);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      resetAndClose();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={resetAndClose}
      size="xl"
      showCloseButton={false}
    >
      <div onKeyDown={handleKeyDown} className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">创建任务实例</h2>
            <div className="flex items-center gap-2 mt-2">
              {STEPS.map((step, index) => {
                const isActive = step.id === currentStep;
                const isCompleted = index < currentStepIndex;

                return (
                  <div key={step.id} className="flex items-center">
                    <div
                      className={`flex items-center gap-1 ${
                        isActive ? 'text-blue-600' : isCompleted ? 'text-green-600' : 'text-gray-400'
                      }`}
                    >
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                          isActive
                            ? 'bg-blue-600 text-white'
                            : isCompleted
                            ? 'bg-green-600 text-white'
                            : 'bg-gray-200 text-gray-600'
                        }`}
                      >
                        {isCompleted ? <CheckCircle2 size={12} /> : index + 1}
                      </div>
                      <span className="text-sm">{step.label}</span>
                    </div>
                    {index < STEPS.length - 1 && (
                      <ArrowRight size={16} className="mx-2 text-gray-300" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <button
            onClick={resetAndClose}
            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {currentStep === 'select' && (
            <TemplateSelector
              templates={TASK_TEMPLATES}
              selectedId={formData.templateId}
              onSelect={handleTemplateSelect}
              compact
            />
          )}
          {currentStep === 'configure' && formData.template && (
            <ParameterForm
              template={formData.template}
              parameters={formData.parameters}
              notes={formData.notes || ''}
              onParameterChange={handleParameterChange}
              onNotesChange={handleNotesChange}
              compact
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={handlePrevious}
            disabled={currentStep === 'select'}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowLeft size={16} />
            上一步
          </button>

          {currentStep === 'select' ? (
            <button
              onClick={handleNext}
              disabled={!formData.templateId}
              className="flex items-center gap-1 px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              下一步
              <ArrowRight size={16} />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-4 py-1.5 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting && <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
              创建任务
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}