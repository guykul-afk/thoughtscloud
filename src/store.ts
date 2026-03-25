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

export type Triple = [string, string, string]; // [Subject, Relation, Object]

export interface GraphNode {
    id: string;
    label: string;
    cluster?: string;
    val?: number; // importance weight
}

export interface GraphEdge {
    source: string;
    target: string;
    relation: string;
    timestamp: number;
}

export interface KnowledgeGraph {
    nodes: GraphNode[];
    edges: GraphEdge[];
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
    majorInsights: string[];
    knowledgeGraph: KnowledgeGraph;
    graphInsights: {
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
    setMajorInsights: (insights: string[]) => void;
    addTriples: (triples: Triple[], timestamp: number) => void;
    setKnowledgeGraph: (graph: KnowledgeGraph) => void;
    setGraphInsights: (insights: AppState['graphInsights']) => void;
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
            majorInsights: [],
            knowledgeGraph: { nodes: [], edges: [] },
            graphInsights: null,
            isGdriveConnected: false,
            setApiKey: (apiKey) => set({ apiKey }),
            setGdriveConnected: (isGdriveConnected) => set({ isGdriveConnected }),
            addEntry: (entry) => set((state) => {
                let updatedEntries = [...state.entries];
                
                // Process task updates
                if (entry.taskUpdates && entry.taskUpdates.length > 0) {
                    entry.taskUpdates.forEach(update => {
                        updatedEntries = updatedEntries.map(e => ({
                            ...e,
                            tasks: e.tasks.map(t => 
                                t.text === update.originalText 
                                    ? { ...t, text: update.updatedText } 
                                    : t
                            )
                        }));
                    });
                }

                // Process knowledge graph triples
                const newNodes = [...state.knowledgeGraph.nodes];
                const newEdges = [...state.knowledgeGraph.edges];
                const timestamp = Date.now();

                if (entry.triples && entry.triples.length > 0) {
                    entry.triples.forEach(([s, r, o]) => {
                        const sLower = s.trim();
                        const oLower = o.trim();

                        if (!newNodes.find(n => n.id === sLower)) {
                            newNodes.push({ id: sLower, label: sLower, val: 1 });
                        } else {
                            const node = newNodes.find(n => n.id === sLower);
                            if (node) node.val = (node.val || 1) + 0.1;
                        }

                        if (!newNodes.find(n => n.id === oLower)) {
                            newNodes.push({ id: oLower, label: oLower, val: 1 });
                        } else {
                            const node = newNodes.find(n => n.id === oLower);
                            if (node) node.val = (node.val || 1) + 0.1;
                        }

                        const edgeExists = newEdges.find(e => 
                            e.source === sLower && 
                            e.target === oLower && 
                            e.relation === r
                        );
                        if (!edgeExists) {
                            newEdges.push({ source: sLower, target: oLower, relation: r, timestamp });
                        }
                    });
                }

                // Add the new entry
                const newEntry: DiaryEntry = {
                    id: Math.random().toString(36).slice(2, 9),
                    timestamp,
                    ...entry,
                    tasks: entry.tasks.map(t => ({ text: t, isImportant: false }))
                };

                const finalEntries = [newEntry, ...updatedEntries];


                return { 
                    entries: finalEntries,
                    knowledgeGraph: { nodes: newNodes, edges: newEdges }
                };
            }),
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
            setMajorInsights: (majorInsights) => set({ majorInsights }),
            addTriples: (triples, timestamp) => set((state) => {
                const newNodes = [...state.knowledgeGraph.nodes];
                const newEdges = [...state.knowledgeGraph.edges];

                triples.forEach(([s, r, o]) => {
                    // Normalize labels
                    const sLower = s.trim();
                    const oLower = o.trim();

                    if (!newNodes.find(n => n.id === sLower)) {
                        newNodes.push({ id: sLower, label: sLower, val: 1 });
                    } else {
                        const node = newNodes.find(n => n.id === sLower);
                        if (node) node.val = (node.val || 1) + 0.1;
                    }

                    if (!newNodes.find(n => n.id === oLower)) {
                        newNodes.push({ id: oLower, label: oLower, val: 1 });
                    } else {
                        const node = newNodes.find(n => n.id === oLower);
                        if (node) node.val = (node.val || 1) + 0.1;
                    }

                    // Avoid duplicate edges for the same relation on the same day (simplified)
                    const edgeExists = newEdges.find(e => 
                        e.source === sLower && 
                        e.target === oLower && 
                        e.relation === r
                    );

                    if (!edgeExists) {
                        newEdges.push({ source: sLower, target: oLower, relation: r, timestamp });
                    }
                });

                return { knowledgeGraph: { nodes: newNodes, edges: newEdges } };
            }),
            setKnowledgeGraph: (knowledgeGraph) => set({ knowledgeGraph }),
            setGraphInsights: (graphInsights) => set({ graphInsights }),
        }),

        {
            name: 'ai-diary-storage',
        }
    )
);
