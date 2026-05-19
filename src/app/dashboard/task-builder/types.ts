export interface TaskParameter {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'url' | 'file';
  required: boolean;
  placeholder?: string;
  description?: string;
  options?: string[];
  defaultValue?: string;
}

export interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  color: string;
  parameters: TaskParameter[];
  tags: string[];
}