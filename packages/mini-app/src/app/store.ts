import { createContext, useContext } from 'react';
import type { AnalysisResult } from './api';

export interface HistoryEntry {
  txHash: string;
  networkId: string;
  status: 'Success' | 'Failed' | 'Pending';
  timestamp: string;
  result?: AnalysisResult;
}

export interface AppState {
  history: HistoryEntry[];
  currentResult: AnalysisResult | null;
}

export const initialState: AppState = {
  history: [],
  currentResult: null,
};

export type AppAction =
  | { type: 'SET_RESULT'; result: AnalysisResult }
  | { type: 'CLEAR_RESULT' }
  | { type: 'ADD_HISTORY'; entry: HistoryEntry }
  | { type: 'LOAD_HISTORY'; entries: HistoryEntry[] };

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_RESULT':
      return { ...state, currentResult: action.result };
    case 'CLEAR_RESULT':
      return { ...state, currentResult: null };
    case 'ADD_HISTORY':
      return { ...state, history: [action.entry, ...state.history].slice(0, 50) };
    case 'LOAD_HISTORY':
      return { ...state, history: action.entries };
    default:
      return state;
  }
}

export const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}>({ state: initialState, dispatch: () => {} });

export function useApp() {
  return useContext(AppContext);
}
