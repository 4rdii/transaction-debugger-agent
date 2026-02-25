import { createContext, useContext, useReducer, type Dispatch } from 'react';
import type { AnalysisResult } from '@debugger/shared';

export interface ProgressEntry {
  type: 'step' | 'tool_call' | 'tool_result';
  message: string;
  toolName?: string;
  turn?: number;
}

export interface AnalysisState {
  loading: boolean;
  error: string | null;
  result: AnalysisResult | null;
  progressLog: ProgressEntry[];
  qaLoading: boolean;
  qaHistory: Array<{ question: string; answer: string }>;
}

export type AnalysisAction =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; payload: AnalysisResult }
  | { type: 'FETCH_ERROR'; payload: string }
  | { type: 'PROGRESS_ADD'; payload: ProgressEntry }
  | { type: 'QA_START' }
  | { type: 'QA_SUCCESS'; payload: { question: string; answer: string } }
  | { type: 'QA_ERROR'; payload: string }
  | { type: 'RESET' };

const initialState: AnalysisState = {
  loading: false,
  error: null,
  result: null,
  progressLog: [],
  qaLoading: false,
  qaHistory: [],
};

function reducer(state: AnalysisState, action: AnalysisAction): AnalysisState {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, loading: true, error: null, result: null, progressLog: [], qaHistory: [] };
    case 'PROGRESS_ADD':
      return { ...state, progressLog: [...state.progressLog, action.payload] };
    case 'FETCH_SUCCESS':
      return { ...state, loading: false, result: action.payload };
    case 'FETCH_ERROR':
      return { ...state, loading: false, error: action.payload };
    case 'QA_START':
      return { ...state, qaLoading: true };
    case 'QA_SUCCESS':
      return {
        ...state,
        qaLoading: false,
        qaHistory: [...state.qaHistory, action.payload],
      };
    case 'QA_ERROR':
      return { ...state, qaLoading: false, error: action.payload };
    case 'RESET':
      return initialState;
    default:
      return state;
  }
}

export const AnalysisContext = createContext<{
  state: AnalysisState;
  dispatch: Dispatch<AnalysisAction>;
} | null>(null);

export function useAnalysis() {
  const ctx = useContext(AnalysisContext);
  if (!ctx) throw new Error('useAnalysis must be used within AnalysisProvider');
  return ctx;
}

export function useAnalysisReducer() {
  return useReducer(reducer, initialState);
}
