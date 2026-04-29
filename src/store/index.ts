import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark' | 'system';
export type Provider = 'mymemory' | 'deepl' | 'openai' | 'local';
export type LocalModelQuality = 'fast' | 'high' | 'ultra';
export type ClipboardShortcut = 'ctrl_c_c' | 'ctrl_shift_c' | 'ctrl_alt_c' | 'disabled';

export interface ApiKeys {
  deepl: string;
  openai: string;
}

export interface HistoryItem {
  id: string;
  sourceText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  isFavorite: boolean;
  createdAt: string;
}

interface AppState {
  theme: Theme;
  sourceLang: string;
  targetLang: string;
  history: HistoryItem[];
  provider: Provider;
  localModelQuality: LocalModelQuality;
  localOnlyProcessing: boolean;
  clipboardShortcut: ClipboardShortcut;
  selectedModelId: string;
  apiKeys: ApiKeys;
  setTheme: (theme: Theme) => void;
  setSourceLang: (lang: string) => void;
  setTargetLang: (lang: string) => void;
  setProvider: (provider: Provider) => void;
  setLocalModelQuality: (quality: LocalModelQuality) => void;
  setLocalOnlyProcessing: (enabled: boolean) => void;
  setClipboardShortcut: (shortcut: ClipboardShortcut) => void;
  setSelectedModelId: (modelId: string) => void;
  setApiKeys: (keys: Partial<ApiKeys>) => void;
  addHistoryItem: (item: Omit<HistoryItem, 'id' | 'createdAt'>) => void;
  toggleFavorite: (id: string) => void;
  removeHistoryItem: (id: string) => void;
  clearHistory: () => void;
  resetAllData: () => void;
}

const defaultState = {
  theme: 'dark' as Theme,
  sourceLang: 'en',
  targetLang: 'tr',
  history: [] as HistoryItem[],
  provider: 'mymemory' as Provider,
  localModelQuality: 'fast' as LocalModelQuality,
  localOnlyProcessing: false,
  clipboardShortcut: 'ctrl_c_c' as ClipboardShortcut,
  selectedModelId: '',
  apiKeys: {
    deepl: '',
    openai: '',
  },
};

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      ...defaultState,
      
      setTheme: (theme) => set({ theme }),
      setSourceLang: (sourceLang) => set({ sourceLang }),
      setTargetLang: (targetLang) => set({ targetLang }),
      setProvider: (provider) => set({ provider }),
      setLocalModelQuality: (localModelQuality) => set({ localModelQuality }),
      setLocalOnlyProcessing: (localOnlyProcessing) => set({ localOnlyProcessing }),
      setClipboardShortcut: (clipboardShortcut) => set({ clipboardShortcut }),
      setSelectedModelId: (selectedModelId) => set({ selectedModelId }),
      setApiKeys: (keys) => set((state) => ({ apiKeys: { ...state.apiKeys, ...keys } })),
      
      addHistoryItem: (item) => set((state) => ({
        history: [
          {
            ...item,
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
          },
          ...state.history,
        ],
      })),
      
      toggleFavorite: (id) => set((state) => ({
        history: state.history.map((item) =>
          item.id === id ? { ...item, isFavorite: !item.isFavorite } : item
        ),
      })),
      
      removeHistoryItem: (id) => set((state) => ({
        history: state.history.filter((item) => item.id !== id),
      })),
      
      clearHistory: () => set({ history: [] }),
      resetAllData: () => set({ ...defaultState, apiKeys: { ...defaultState.apiKeys }, history: [] }),
    }),
    {
      name: 'lexicore-storage',
    }
  )
);
