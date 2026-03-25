export interface PolicyDiff {
  key: string;
  label: string;
  category: string;
  oldValue: unknown;
  newValue: unknown;
  isHighRisk: boolean;
}

export interface ValidationError {
  key: string;
  label: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ImpactItem {
  category: string;
  description: string;
}

export interface ImpactPreview {
  changes: PolicyDiff[];
  impacts: ImpactItem[];
}
