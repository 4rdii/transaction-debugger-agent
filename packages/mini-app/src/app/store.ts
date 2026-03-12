import { createContext, useContext } from 'react';
import type { AnalysisResult, Chain } from './api';

export interface HistoryEntry {
  txHash: string;
  chain: Chain;
  status: 'Success' | 'Failed' | 'Pending';
  timestamp: string;
  result?: AnalysisResult;
}

export interface AppState {
  history: HistoryEntry[];
  currentResult: AnalysisResult | null;
  selectedChain: Chain;
}

export const initialState: AppState = {
  history: [],
  currentResult: null,
  selectedChain: 'TON',
};

export type AppAction =
  | { type: 'SET_CHAIN'; chain: Chain }
  | { type: 'SET_RESULT'; result: AnalysisResult }
  | { type: 'CLEAR_RESULT' }
  | { type: 'ADD_HISTORY'; entry: HistoryEntry }
  | { type: 'LOAD_HISTORY'; entries: HistoryEntry[] };

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_CHAIN':
      return { ...state, selectedChain: action.chain };
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
