export interface TemplateParameter {
  name: string;
  label: string;
  type: 'text' | 'select' | 'textarea' | 'file' | 'url';
  required: boolean;
  placeholder?: string;
  options?: string[];
  defaultValue?: string;
  description?: string;
}

export interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  color: string;
  parameters: TemplateParameter[];
  tags?: string[];
}

export interface TaskFormData {
  templateId: string;
  template?: TaskTemplate;
  parameters: Record<string, string>;
  notes?: string;
}

export interface TaskInstance {
  id: string;
  name: string;
  templateId: string;
  templateName: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  parameters: Record<string, string>;
  notes?: string;
  userId?: string;
  userName?: string;
}