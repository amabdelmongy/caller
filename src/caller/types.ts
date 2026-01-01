export interface ExtractedAnswer {
  question: string;
  fullAnswer: string;
  extractedValue: number | string | null;
  valueType: 'number' | 'string' | 'unknown';
  timestamp: Date;
}

export interface AnalysisResult {
  success: boolean;
  data: ExtractedAnswer;
  error?: string;
}
