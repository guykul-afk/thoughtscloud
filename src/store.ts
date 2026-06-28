import { create } from 'zustand';
import type { ProcessedSession, OKFTriple } from './services/ai';
import { FirebaseStorageService } from './services/FirebaseStorageService';
import { runMigrationToFirebase } from './services/migrateToFirebase';

export interface OpenThread {
    text: string;
    isResolved: boolean;
}

export interface DiaryEntry extends Omit<ProcessedSession, 'openThreads'> {
    id: string;
    timestamp: number;
    openThreads: OpenThread[];
    embedding?: number[];
}

export interface ChatMessage {
    role: 'user' | 'ai';
    content: string;
    timestamp: number;
}

export type Triple = OKFTriple; // Backwards compatible alias

export interface GraphNode {
    id: string;
    label: string;
    cluster?: string;
    val?: number; // importance weight
    type?: string; // Person, Project, Concept, Emotion, Other
}

export interface GraphEdge {
    source: string;
    target: string;
    relation: string;
    timestamp: number;
    domain?: string;
    temporalContext?: string;
    confidence?: string;
    sentiment?: number;
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

export interface QuoteInsightsState {
    insights: string[];
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

    globalThreads: { text: string; isResolved: boolean; id: string; createdAt: number }[];
    lastThreadsScanDate: number;
    majorInsights: string[];
    lastMajorInsightsCount: number;
    knowledgeGraph: KnowledgeGraph;
    graphInsights: {
        insight?: string;
        lastDate?: string;
    } | null;
    advices: AdvicesState | null;
    quoteInsights: QuoteInsightsState | null;
    isGdriveConnected: boolean;
    preferredModel?: string | null;
    preferredApiVersion?: string | null;
    syncStatus: 'synced' | 'saving' | 'error';
    
    // Actions
    loadInitialState: () => Promise<void>;
    setApiKey: (key: string) => void;
    addEntry: (entry: ProcessedSession) => void;
    removeEntry: (id: string) => void;
    updateEntry: (id: string, transcript: string, topics?: string[]) => void;
    removeThread: (threadId: string) => void;
    toggleThreadResolution: (threadId: string) => void;
    setGlobalThreads: (threads: { text: string; isResolved: boolean; id: string; createdAt: number }[]) => void;
    setLastThreadsScanDate: (date: number) => void;
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
    setQuoteInsights: (advices: QuoteInsightsState) => void;
    setGdriveConnected: (connected: boolean) => void;
    setPreferredModel: (modelName: string, apiVersion: string) => void;
}

async function performFirebaseWrite(set: any, writeFn: () => Promise<any>) {
    set({ syncStatus: 'saving' });
    try {
        await writeFn();
        set({ syncStatus: 'synced' });
    } catch (e) {
        console.error("Firebase write error:", e);
        set({ syncStatus: 'error' });
    }
}

export const useAppStore = create<AppState>()((set, get) => ({
    apiKey: (() => {
        const stored = localStorage.getItem('gemini_api_key');
        if (stored === 'AIzaSyDVNmJATZLv3dt9zWtwpCfE8WSXtGQqsHM') {
            localStorage.removeItem('gemini_api_key');
            return (import.meta.env.VITE_GEMINI_API_KEY as string) || '';
        }
        return stored || (import.meta.env.VITE_GEMINI_API_KEY as string) || '';
    })(),
    syncStatus: 'synced',
    entries: [],
    chatMessages: [],
    weeklyInsight: '',
    categoricalInsights: null,
    lifeThemes: null,
    shadowWork: null,
    dailyGtd: null,
    operatingManual: null,
    globalThreads: [],
    lastThreadsScanDate: 0,
    majorInsights: [],
    lastMajorInsightsCount: 0,
    knowledgeGraph: { nodes: [], edges: [] },
    graphInsights: null,
    advices: null,
    quoteInsights: null,
    isGdriveConnected: false,
    preferredModel: null,
    preferredApiVersion: null,

    loadInitialState: async () => {
        try {
            if (!localStorage.getItem('has_migrated_to_firebase')) {
                await runMigrationToFirebase();
            } else {
                await FirebaseStorageService.init();
            }
            let entries = await FirebaseStorageService.loadAllEntries();
            const graph = await FirebaseStorageService.loadKnowledgeGraph();
            const insights = await FirebaseStorageService.loadInsights();

            // One-time legacy cleanup to delete old threads inside entries
            if (!localStorage.getItem('has_cleared_old_threads_v2')) {
                console.log("Cleaning legacy openThreads from entries...");
                for (const entry of entries) {
                    if (entry.openThreads && entry.openThreads.length > 0) {
                        entry.openThreads = [];
                        await FirebaseStorageService.saveEntry(entry);
                    }
                }
                localStorage.setItem('has_cleared_old_threads_v2', 'true');
                // Reload clean entries
                entries = await FirebaseStorageService.loadAllEntries();
            }

            set({ 
                entries,
                knowledgeGraph: graph || { nodes: [], edges: [] },
                weeklyInsight: insights?.weeklyInsight || '',
                majorInsights: insights?.majorInsights || [],
                categoricalInsights: insights?.categoricalInsights || null,
                lifeThemes: insights?.lifeThemes || null,
                shadowWork: insights?.shadowWork || null,
                dailyGtd: insights?.dailyGtd || null,
                operatingManual: insights?.operatingManual || null,
                advices: insights?.advices || null,
                quoteInsights: insights?.quoteInsights || null,
                lastMajorInsightsCount: insights?.lastMajorInsightsCount || 0,
                globalThreads: insights?.globalThreads || [],
                lastThreadsScanDate: insights?.lastThreadsScanDate || 0
            });
        } catch (e) {
            console.error("Failed to load initial state from Firebase", e);
        }
    },


    setApiKey: (apiKey) => {
        localStorage.setItem('gemini_api_key', apiKey);
        set({ apiKey });
    },
    setGdriveConnected: (isGdriveConnected) => set({ isGdriveConnected }),
    setAdvices: (advices) => {
        set({ advices });
        performFirebaseWrite(set, () => FirebaseStorageService.saveInsights({ advices }));
    },
    setQuoteInsights: (quoteInsights) => {
        set({ quoteInsights });
        performFirebaseWrite(set, () => FirebaseStorageService.saveInsights({ quoteInsights }));
    },
    setLastMajorInsightsCount: (lastMajorInsightsCount) => {
        set({ lastMajorInsightsCount });
        performFirebaseWrite(set, () => FirebaseStorageService.saveInsights({ lastMajorInsightsCount }));
    },
    setPreferredModel: (preferredModel, preferredApiVersion) => set({ preferredModel, preferredApiVersion }),

    addEntry: (entry) => {
        let finalEntries: DiaryEntry[] = [];
        let newGraph: KnowledgeGraph = { nodes: [], edges: [] };
        let newEntry: DiaryEntry | null = null;

        set((state) => {
            let updatedEntries = [...state.entries];
            const newNodes = [...state.knowledgeGraph.nodes];
            const newEdges = [...state.knowledgeGraph.edges];
            const timestamp = Date.now();

            if (entry.triples && entry.triples.length > 0) {
                entry.triples.forEach((rawT) => {
                    const t = Array.isArray(rawT) 
                        ? { subject: rawT[0], relation: rawT[1], object: rawT[2] } as OKFTriple
                        : rawT as OKFTriple;
                    
                    const sLower = (t.subject || '').trim();
                    const oLower = (t.object || '').trim();
                    if (!sLower || !oLower) return;

                    if (!newNodes.find(n => n.id === sLower)) {
                        newNodes.push({ 
                            id: sLower, 
                            label: sLower, 
                            val: 1,
                            type: t.subjectType || 'Other'
                        });
                    } else {
                        const node = newNodes.find(n => n.id === sLower);
                        if (node) {
                            node.val = (node.val || 1) + 0.1;
                            if (t.subjectType && t.subjectType !== 'Other') {
                                node.type = t.subjectType;
                            }
                        }
                    }

                    if (!newNodes.find(n => n.id === oLower)) {
                        newNodes.push({ 
                            id: oLower, 
                            label: oLower, 
                            val: 1,
                            type: t.objectType || 'Other'
                        });
                    } else {
                        const node = newNodes.find(n => n.id === oLower);
                        if (node) {
                            node.val = (node.val || 1) + 0.1;
                            if (t.objectType && t.objectType !== 'Other') {
                                node.type = t.objectType;
                            }
                        }
                    }

                    const edgeExists = newEdges.find(e => 
                        e.source === sLower && 
                        e.target === oLower && 
                        e.relation === t.relation
                    );
                    if (!edgeExists) {
                        newEdges.push({ 
                            source: sLower, 
                            target: oLower, 
                            relation: t.relation, 
                            timestamp,
                            domain: t.domain,
                            temporalContext: t.temporalContext,
                            confidence: t.confidence,
                            sentiment: t.sentiment
                        });
                    }
                });
            }

            newEntry = {
                id: Math.random().toString(36).slice(2, 9),
                timestamp,
                ...entry,
                openThreads: [] // initialize empty since threads are now global
            };

            finalEntries = [newEntry, ...updatedEntries];
            newGraph = { nodes: newNodes, edges: newEdges };

            return { 
                entries: finalEntries,
                knowledgeGraph: newGraph
            };
        });

        // Async persistence
        performFirebaseWrite(set, async () => {
            if (newEntry) {
                await FirebaseStorageService.saveEntry(newEntry, get().apiKey);
            }
            await FirebaseStorageService.saveKnowledgeGraph(newGraph);
        });
    },

    removeEntry: (id) => {
        let entryToDelete: DiaryEntry | undefined;
        set((state) => {
            entryToDelete = state.entries.find(e => e.id === id);
            return {
                entries: state.entries.filter(e => e.id !== id)
            };
        });
        if (entryToDelete) {
            performFirebaseWrite(set, () => FirebaseStorageService.deleteEntry(entryToDelete!.id, entryToDelete!.timestamp));
        }
    },

    updateEntry: (id, transcript, topics) => {
        let updatedEntry: DiaryEntry | null = null;
        set((state) => {
            const entries = state.entries.map(e => {
                if (e.id === id) {
                    let finalTopics = topics ?? e.topics ?? [];
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
                    
                    updatedEntry = { ...e, transcript, topics: finalTopics };
                    return updatedEntry;
                }
                return e;
            });
            return { entries };
        });

        if (updatedEntry) {
            performFirebaseWrite(set, () => FirebaseStorageService.saveEntry(updatedEntry!, get().apiKey));
        }
    },

    removeThread: (threadId) => {
        set((state) => {
            const updatedThreads = state.globalThreads.filter(t => t.id !== threadId);
            performFirebaseWrite(set, () => FirebaseStorageService.saveInsights({ globalThreads: updatedThreads }));
            return { globalThreads: updatedThreads };
        });
    },

    toggleThreadResolution: (threadId) => {
        set((state) => {
            const updatedThreads = state.globalThreads.map(t => 
                t.id === threadId ? { ...t, isResolved: !t.isResolved } : t
            );
            performFirebaseWrite(set, () => FirebaseStorageService.saveInsights({ globalThreads: updatedThreads }));
            return { globalThreads: updatedThreads };
        });
    },

    setGlobalThreads: (globalThreads) => {
        set({ globalThreads });
        performFirebaseWrite(set, () => FirebaseStorageService.saveInsights({ globalThreads }));
    },

    setLastThreadsScanDate: (lastThreadsScanDate) => {
        set({ lastThreadsScanDate });
        performFirebaseWrite(set, () => FirebaseStorageService.saveInsights({ lastThreadsScanDate }));
    },

    setEntries: (entries) => set({ entries }),

    addChatMessage: (role, content) => set((state) => ({
        chatMessages: [...state.chatMessages, { role, content, timestamp: Date.now() }]
    })),
    setChatMessages: (chatMessages) => set({ chatMessages }),

    setWeeklyInsight: (weeklyInsight) => {
        set({ weeklyInsight });
        performFirebaseWrite(set, () => FirebaseStorageService.saveInsights({ weeklyInsight }));
    },
    setCategoricalInsights: (categoricalInsights) => {
        set({ categoricalInsights });
        performFirebaseWrite(set, () => FirebaseStorageService.saveInsights({ categoricalInsights }));
    },
    setLifeThemes: (lifeThemes) => {
        set({ lifeThemes });
        performFirebaseWrite(set, () => FirebaseStorageService.saveInsights({ lifeThemes }));
    },
    setShadowWork: (shadowWork) => {
        set({ shadowWork });
        performFirebaseWrite(set, () => FirebaseStorageService.saveInsights({ shadowWork }));
    },
    setDailyGtd: (dailyGtd) => {
        set({ dailyGtd });
        performFirebaseWrite(set, () => FirebaseStorageService.saveInsights({ dailyGtd }));
    },
    setOperatingManual: (operatingManual) => {
        set({ operatingManual });
        performFirebaseWrite(set, () => FirebaseStorageService.saveInsights({ operatingManual }));
    },

    setMajorInsights: (majorInsights) => {
        set({ majorInsights });
        performFirebaseWrite(set, () => FirebaseStorageService.saveInsights({ majorInsights }));
    },

    addTriples: (triples, timestamp) => {
        let newGraph: KnowledgeGraph | null = null;
        set((state) => {
            const newNodes = [...state.knowledgeGraph.nodes];
            const newEdges = [...state.knowledgeGraph.edges];

            triples.forEach((rawT) => {
                const t = Array.isArray(rawT)
                    ? { subject: rawT[0], relation: rawT[1], object: rawT[2] } as OKFTriple
                    : rawT as OKFTriple;

                const sLower = (t.subject || '').trim();
                const oLower = (t.object || '').trim();
                if (!sLower || !oLower) return;

                if (!newNodes.find(n => n.id === sLower)) {
                    newNodes.push({ 
                        id: sLower, 
                        label: sLower, 
                        val: 1, 
                        type: t.subjectType || 'Other' 
                    });
                } else {
                    const node = newNodes.find(n => n.id === sLower);
                    if (node) {
                        node.val = (node.val || 1) + 0.1;
                        if (t.subjectType && t.subjectType !== 'Other') {
                            node.type = t.subjectType;
                        }
                    }
                }

                if (!newNodes.find(n => n.id === oLower)) {
                    newNodes.push({ 
                        id: oLower, 
                        label: oLower, 
                        val: 1, 
                        type: t.objectType || 'Other' 
                    });
                } else {
                    const node = newNodes.find(n => n.id === oLower);
                    if (node) {
                        node.val = (node.val || 1) + 0.1;
                        if (t.objectType && t.objectType !== 'Other') {
                            node.type = t.objectType;
                        }
                    }
                }

                const edgeExists = newEdges.find(e => 
                    e.source === sLower && 
                    e.target === oLower && 
                    e.relation === t.relation
                );

                if (!edgeExists) {
                    newEdges.push({ 
                        source: sLower, 
                        target: oLower, 
                        relation: t.relation, 
                        timestamp,
                        domain: t.domain,
                        temporalContext: t.temporalContext,
                        confidence: t.confidence,
                        sentiment: t.sentiment
                    });
                }
            });

            newGraph = { nodes: newNodes, edges: newEdges };
            return { knowledgeGraph: newGraph };
        });

        if (newGraph) {
            performFirebaseWrite(set, () => FirebaseStorageService.saveKnowledgeGraph(newGraph!));
        }
    },
    
    setKnowledgeGraph: (knowledgeGraph) => {
        set({ knowledgeGraph });
        performFirebaseWrite(set, () => FirebaseStorageService.saveKnowledgeGraph(knowledgeGraph));
    },
    setGraphInsights: (graphInsights) => set({ graphInsights }),
}));

