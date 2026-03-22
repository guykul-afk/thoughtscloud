import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProcessedSession } from './services/ai';

export interface AppTask {
    text: string;
    isImportant: boolean;
}

export interface DiaryEntry extends Omit<ProcessedSession, 'tasks'> {
    id: string;
    timestamp: number;
    tasks: AppTask[];
}

export interface ChatMessage {
    role: 'user' | 'ai';
    content: string;
    timestamp: number;
}

interface AppState {
    apiKey: string;
    entries: DiaryEntry[];
    chatMessages: ChatMessage[];
    weeklyInsight: string;
    categoricalInsights: { work: string; family: string; personal: string } | null;
    lifeThemes: {
        weekly?: string;
        monthly?: string;
        lastWeeklyDate?: string;
        lastMonthlyDate?: string;
    } | null;
    shadowWork: {
        insight?: string;
        lastDate?: string;
    } | null;
    dailyGtd: {
        insight?: string;
        lastDate?: string;
    } | null;
    operatingManual: {
        insight?: string;
        lastDate?: string;
    } | null;
    korczakAnalysis: {
        insight?: string;
        lastDate?: string;
    } | null;
    isGdriveConnected: boolean;
    setApiKey: (key: string) => void;
    addEntry: (entry: ProcessedSession) => void;
    clearEntries: () => void;
    removeTask: (entryId: string, taskText: string) => void;
    toggleTaskImportance: (entryId: string, taskText: string) => void;
    setEntries: (entries: DiaryEntry[]) => void;
    addChatMessage: (role: 'user' | 'ai', content: string) => void;
    setChatMessages: (messages: ChatMessage[]) => void;
    setWeeklyInsight: (insight: string) => void;
    setCategoricalInsights: (insights: { work: string; family: string; personal: string }) => void;
    setLifeThemes: (themes: AppState['lifeThemes']) => void;
    setShadowWork: (shadow: AppState['shadowWork']) => void;
    setDailyGtd: (gtd: AppState['dailyGtd']) => void;
    setOperatingManual: (manual: AppState['operatingManual']) => void;
    setKorczakAnalysis: (analysis: AppState['korczakAnalysis']) => void;
    setGdriveConnected: (connected: boolean) => void;
}


export const useAppStore = create<AppState>()(
    persist(
        (set) => ({
            apiKey: '',
            entries: [],
            chatMessages: [],
            weeklyInsight: '',
            categoricalInsights: null,
            lifeThemes: null,
            shadowWork: null,
            dailyGtd: null,
            operatingManual: null,
            korczakAnalysis: null,
            isGdriveConnected: false,
            setApiKey: (apiKey) => set({ apiKey }),
            setGdriveConnected: (isGdriveConnected) => set({ isGdriveConnected }),
            addEntry: (entry) => set((state) => ({
                entries: [{ 
                    id: Math.random().toString(36).slice(2, 9), 
                    timestamp: Date.now(), 
                    ...entry,
                    tasks: entry.tasks.map(t => ({ text: t, isImportant: false }))
                }, ...state.entries]
            })),
            clearEntries: () => set({ entries: [] }),
            removeTask: (entryId, taskText) => set((state) => ({
                entries: state.entries.map(entry =>
                    entry.id === entryId
                        ? { ...entry, tasks: entry.tasks.filter(t => (typeof t === 'string' ? t : t.text) !== taskText) }
                        : entry
                )
            })),
            toggleTaskImportance: (entryId, taskText) => set((state) => ({
                entries: state.entries.map(entry =>
                    entry.id === entryId
                        ? { 
                            ...entry, 
                            tasks: entry.tasks.map(t => {
                                const tText = typeof t === 'string' ? t : t.text;
                                const tImportant = typeof t === 'string' ? false : t.isImportant;
                                return tText === taskText ? { text: tText, isImportant: !tImportant } : (typeof t === 'string' ? { text: t, isImportant: false } : t);
                            }) 
                        }
                        : entry
                )
            })),
            setEntries: (entries) => set({ entries }),
            addChatMessage: (role, content) => set((state) => ({
                chatMessages: [...state.chatMessages, { role, content, timestamp: Date.now() }]
            })),
            setChatMessages: (chatMessages) => set({ chatMessages }),
            setWeeklyInsight: (weeklyInsight) => set({ weeklyInsight }),
            setCategoricalInsights: (categoricalInsights) => set({ categoricalInsights }),
            setLifeThemes: (lifeThemes) => set({ lifeThemes }),
            setShadowWork: (shadowWork) => set({ shadowWork }),
            setDailyGtd: (dailyGtd) => set({ dailyGtd }),
            setOperatingManual: (operatingManual) => set({ operatingManual }),
            setKorczakAnalysis: (korczakAnalysis) => set({ korczakAnalysis }),
        }),

        {
            name: 'ai-diary-storage',
        }
    )
);
