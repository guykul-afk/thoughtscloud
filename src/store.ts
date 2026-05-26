import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProcessedSession } from './services/ai';

export interface OpenThread {
    text: string;
    isResolved: boolean;
}

export interface DiaryEntry extends Omit<ProcessedSession, 'openThreads'> {
    id: string;
    timestamp: number;
    openThreads: OpenThread[];
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

export interface AdviceItem {
    timestamp: number;
    work: string;
    family: string;
    mental: string;
}

export interface AdvicesState {
    history: AdviceItem[];
    lastEntryCount: number;
}

export interface ShadowQuickAdvicesState {
    advices: string[];
    lastEntryCount: number;
    oldestIndex?: number;
    lastUpdateDate?: string;
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

    majorInsights: string[];
    lastMajorInsightsCount: number;
    knowledgeGraph: KnowledgeGraph;
    graphInsights: {
        insight?: string;
        lastDate?: string;
    } | null;
    advices: AdvicesState | null;
    shadowQuickAdvices: ShadowQuickAdvicesState | null;
    isGdriveConnected: boolean;
    preferredModel?: string | null;
    preferredApiVersion?: string | null;
    setApiKey: (key: string) => void;
    addEntry: (entry: ProcessedSession) => void;
    removeEntry: (id: string) => void;
    updateEntry: (id: string, transcript: string, topics?: string[]) => void;
    removeThread: (entryId: string, threadText: string) => void;
    toggleThreadResolution: (entryId: string, threadText: string) => void;
    setEntries: (entries: DiaryEntry[]) => void;
    addChatMessage: (role: 'user' | 'ai', content: string) => void;
    setChatMessages: (messages: ChatMessage[]) => void;
    setWeeklyInsight: (insight: string) => void;
    setCategoricalInsights: (insights: { work: string; family: string; personal: string }) => void;
    setLifeThemes: (themes: AppState['lifeThemes']) => void;
    setShadowWork: (shadow: AppState['shadowWork']) => void;
    setDailyGtd: (gtd: AppState['dailyGtd']) => void;
    setOperatingManual: (manual: AppState['operatingManual']) => void;

    setMajorInsights: (insights: string[]) => void;
    setLastMajorInsightsCount: (count: number) => void;
    addTriples: (triples: Triple[], timestamp: number) => void;
    setKnowledgeGraph: (graph: KnowledgeGraph) => void;
    setGraphInsights: (insights: AppState['graphInsights']) => void;
    setAdvices: (advices: AdvicesState) => void;
    setShadowQuickAdvices: (advices: ShadowQuickAdvicesState) => void;
    setGdriveConnected: (connected: boolean) => void;
    setPreferredModel: (modelName: string, apiVersion: string) => void;
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

            majorInsights: [],
            lastMajorInsightsCount: 0,
            knowledgeGraph: { nodes: [], edges: [] },
            graphInsights: null,
            advices: null,
            shadowQuickAdvices: null,
            isGdriveConnected: false,
            preferredModel: null,
            preferredApiVersion: null,
            setApiKey: (apiKey) => set({ apiKey }),
            setGdriveConnected: (isGdriveConnected) => set({ isGdriveConnected }),
            setAdvices: (advices) => set({ advices }),
            setShadowQuickAdvices: (shadowQuickAdvices) => set({ shadowQuickAdvices }),
            setLastMajorInsightsCount: (lastMajorInsightsCount) => set({ lastMajorInsightsCount }),
            setPreferredModel: (preferredModel, preferredApiVersion) => set({ preferredModel, preferredApiVersion }),
            addEntry: (entry) => set((state) => {
                let updatedEntries = [...state.entries];

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
                    openThreads: (entry.openThreads || []).map(t => ({ text: t, isResolved: false }))
                };

                const finalEntries = [newEntry, ...updatedEntries];


                return { 
                    entries: finalEntries,
                    knowledgeGraph: { nodes: newNodes, edges: newEdges }
                };
            }),

            removeEntry: (id) => set((state) => ({
                entries: state.entries.filter(e => e.id !== id)
            })),
            updateEntry: (id, transcript, topics) => set((state) => ({
                entries: state.entries.map(e => {
                    if (e.id === id) {
                        let finalTopics = topics ?? e.topics ?? [];
                        
                        // Extract hashtags from transcript and automatically add them
                        const hashtagRegex = /#([^\s.,!?;:"'()]+)/g;
                        const matches = [...transcript.matchAll(hashtagRegex)];
                        const extracted = matches.map(m => m[1].trim()).filter(Boolean);
                        
                        if (extracted.length > 0) {
                            const merged = [...finalTopics];
                            extracted.forEach(tag => {
                                if (!merged.some(t => t.toLowerCase() === tag.toLowerCase())) {
                                    merged.push(tag);
                                }
                            });
                            finalTopics = merged;
                        }
                        
                        return { ...e, transcript, topics: finalTopics };
                    }
                    return e;
                })
            })),
            removeThread: (entryId, threadText) => set((state) => ({
                entries: state.entries.map(entry =>
                    entry.id === entryId
                        ? { ...entry, openThreads: (entry.openThreads || []).filter(t => t.text !== threadText) }
                        : entry
                )
            })),
            toggleThreadResolution: (entryId, threadText) => set((state) => ({
                entries: state.entries.map(entry =>
                    entry.id === entryId
                        ? { 
                            ...entry, 
                            openThreads: (entry.openThreads || []).map(t => 
                                t.text === threadText ? { ...t, isResolved: !t.isResolved } : t
                            ) 
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
