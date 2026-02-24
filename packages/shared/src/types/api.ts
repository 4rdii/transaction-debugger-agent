// HTTP request/response DTOs

import type { AnalysisResult } from './analysis.js';

export interface DebugRequest {
  txHash: string;
  networkId: string;
}

export interface DebugResponse {
  result: AnalysisResult;
}

export interface QARequest {
  question: string;
  context: AnalysisResult;
}

export interface QAResponse {
  answer: string;
}

export interface ErrorResponse {
  error: string;
  details?: string;
}
