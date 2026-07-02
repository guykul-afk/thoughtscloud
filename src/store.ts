import { create } from 'zustand';
import type { ProcessedSession, OKFTriple } from './services/ai';
import { FirebaseStorageService } from './services/FirebaseStorageService';
import { cleanEntityName, isStopwordOrInvalid } from './utils/entityResolution';

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

export interface IdentityPersona {
    coreBeliefs: string[];
    activeGoals: string[];
    psychologicalProfile: {
        strengths: string[];
        focusAreas: string[];
        blindSpots: string[];
    };
    lastUpdated: number;
}

export interface GraphNode {
    id: string;
    label: string;
    cluster?: string;
    val?: number; // importance weight
    type?: string; // Person, Project, Concept, Emotion, Other
    occurrence_refs?: string[];
    evidence_strength?: number;
    status?: 'pending' | 'succeeded' | 'failed';
    evaluation?: string;
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
    dailyGtd: {
        insight?: string;
        lastDate?: string;
        lastEntryIds?: string[];
    } | null;

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
    syncError: string | null;
    identityPersona: IdentityPersona | null;
    
    // Actions
    loadInitialState: () => Promise<void>;
    setApiKey: (key: string) => void;
    setIdentityPersona: (persona: IdentityPersona) => void;
    updateIdentityPersonaAction: () => Promise<void>;
    addEntry: (entry: ProcessedSession) => void;
    removeEntry: (id: string) => void;
    updateEntry: (id: string, transcript: string, topics?: string[]) => void;
    setEntries: (entries: DiaryEntry[]) => void;
    addChatMessage: (role: 'user' | 'ai', content: string) => void;
    setChatMessages: (messages: ChatMessage[]) => void;
    setWeeklyInsight: (insight: string) => void;
    setCategoricalInsights: (insights: { work: string; family: string; personal: string }) => void;
    setLifeThemes: (themes: AppState['lifeThemes']) => void;
    setDailyGtd: (gtd: AppState['dailyGtd']) => void;
    setMajorInsights: (insights: string[]) => void;
    setLastMajorInsightsCount: (count: number) => void;
    addTriples: (triples: Triple[], timestamp: number) => void;
    setKnowledgeGraph: (graph: KnowledgeGraph) => void;
    setGraphInsights: (insights: AppState['graphInsights']) => void;
    setAdvices: (advices: AdvicesState) => void;
    setQuoteInsights: (advices: QuoteInsightsState) => void;
    setGdriveConnected: (connected: boolean) => void;
    setPreferredModel: (modelName: string, apiVersion: string) => void;
    reprocessAllEntries: (onProgress?: (current: number, total: number) => void) => Promise<void>;
    calibratePredictionsAction: () => Promise<void>;
}

async function performFirebaseWrite(set: any, writeFn: () => Promise<any>) {
    set({ syncStatus: 'saving', syncError: null });
    try {
        await writeFn();
        set({ syncStatus: 'synced' });
    } catch (e: any) {
        console.error("Firebase write error:", e);
        set({ syncStatus: 'error', syncError: e.message || String(e) });
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
    syncError: null,
    entries: [],
    chatMessages: [],
    weeklyInsight: '',
    categoricalInsights: null,
    lifeThemes: null,
    dailyGtd: null,
    majorInsights: [],
    lastMajorInsightsCount: 0,
    knowledgeGraph: { nodes: [], edges: [] },
    graphInsights: null,
    advices: null,
    quoteInsights: null,
    isGdriveConnected: false,
    preferredModel: null,
    preferredApiVersion: null,
    identityPersona: null,

    loadInitialState: async () => {
        set({ syncStatus: 'saving' });
        try {
            await FirebaseStorageService.init();
            let entries = await FirebaseStorageService.loadAllEntries();
            const graph = await FirebaseStorageService.loadKnowledgeGraph();
            let insights = await FirebaseStorageService.loadInsights();
            const identityPersona = await FirebaseStorageService.loadIdentityPersona();

            // Support pre-generated insights from diary_state.json if server insights are missing
            let quoteInsights = insights?.quoteInsights || null;

            if (!quoteInsights) {
                try {
                    const res = await fetch('/diary_state.json');
                    if (res.ok) {
                        const localData = await res.json();
                        const localState = localData.state || localData;
                        
                        let localUpdated = false;
                        if (!quoteInsights && localState.quoteInsights) {
                            quoteInsights = localState.quoteInsights;
                            localUpdated = true;
                        }

                        if (localUpdated) {
                            console.log("[FirebaseStorageService] Seeding missing insights from local diary_state.json...");
                            await FirebaseStorageService.saveInsights({
                                quoteInsights
                            });
                        }
                    }
                } catch (err) {
                    console.warn("Failed to seed initial insights from diary_state.json:", err);
                }
            }

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
                dailyGtd: insights?.dailyGtd || null,
                advices: insights?.advices || null,
                quoteInsights: quoteInsights,
                lastMajorInsightsCount: insights?.lastMajorInsightsCount || 0,
                identityPersona,
                syncStatus: 'synced'
            });
        } catch (e) {
            console.error("Failed to load initial state from Firebase", e);
            set({ syncStatus: 'error' });
        }
    },


    setApiKey: (apiKey) => {
        localStorage.setItem('gemini_api_key', apiKey);
        set({ apiKey });
    },
    setIdentityPersona: (identityPersona) => {
        set({ identityPersona });
        performFirebaseWrite(set, () => FirebaseStorageService.saveIdentityPersona(identityPersona));
    },
    updateIdentityPersonaAction: async () => {
        const { entries, identityPersona, apiKey } = get();
        if (!apiKey || entries.length === 0) return;
        const { generateUpdatedPersona } = await import('./services/identity');
        const updated = await generateUpdatedPersona(identityPersona, entries, apiKey);
        set({ identityPersona: updated });
        performFirebaseWrite(set, () => FirebaseStorageService.saveIdentityPersona(updated));
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
        const entryId = Math.random().toString(36).slice(2, 9);

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
                    
                    const cleanSubject = cleanEntityName(t.subject);
                    const cleanObject = cleanEntityName(t.object);
                    if (!cleanSubject || !cleanObject) return;
                    if (isStopwordOrInvalid(cleanSubject) || isStopwordOrInvalid(cleanObject)) return;

                    // Process subject node
                    let sNode = newNodes.find(n => n.id === cleanSubject);
                    if (!sNode) {
                        sNode = { 
                            id: cleanSubject, 
                            label: cleanSubject, 
                            val: 1,
                            type: t.subjectType || 'Other',
                            occurrence_refs: [entryId],
                            evidence_strength: 1/3,
                            status: t.subjectType === 'Prediction' ? 'pending' : undefined
                        };
                        newNodes.push(sNode);
                    } else {
                        sNode.val = (sNode.val || 1) + 0.1;
                        if (t.subjectType && t.subjectType !== 'Other') {
                            sNode.type = t.subjectType;
                        }
                        if (t.subjectType === 'Prediction' && !sNode.status) {
                            sNode.status = 'pending';
                        }
                        if (!sNode.occurrence_refs) sNode.occurrence_refs = [];
                        if (!sNode.occurrence_refs.includes(entryId)) {
                            sNode.occurrence_refs.push(entryId);
                        }
                        sNode.evidence_strength = Math.min(1, sNode.occurrence_refs.length / 3);
                    }

                    // Process object node
                    let oNode = newNodes.find(n => n.id === cleanObject);
                    if (!oNode) {
                        oNode = { 
                            id: cleanObject, 
                            label: cleanObject, 
                            val: 1,
                            type: t.objectType || 'Other',
                            occurrence_refs: [entryId],
                            evidence_strength: 1/3,
                            status: t.objectType === 'Prediction' ? 'pending' : undefined
                        };
                        newNodes.push(oNode);
                    } else {
                        oNode.val = (oNode.val || 1) + 0.1;
                        if (t.objectType && t.objectType !== 'Other') {
                            oNode.type = t.objectType;
                        }
                        if (t.objectType === 'Prediction' && !oNode.status) {
                            oNode.status = 'pending';
                        }
                        if (!oNode.occurrence_refs) oNode.occurrence_refs = [];
                        if (!oNode.occurrence_refs.includes(entryId)) {
                            oNode.occurrence_refs.push(entryId);
                        }
                        oNode.evidence_strength = Math.min(1, oNode.occurrence_refs.length / 3);
                    }

                    const edgeExists = newEdges.find(e => 
                        e.source === cleanSubject && 
                        e.target === cleanObject && 
                        e.relation === t.relation
                    );
                    if (!edgeExists) {
                        newEdges.push({ 
                            source: cleanSubject, 
                            target: cleanObject, 
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
                id: entryId,
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
    setDailyGtd: (dailyGtd) => {
        set({ dailyGtd });
        performFirebaseWrite(set, () => FirebaseStorageService.saveInsights({ dailyGtd }));
    },
    setMajorInsights: (majorInsights) => {
        set({ majorInsights });
        performFirebaseWrite(set, () => FirebaseStorageService.saveInsights({ majorInsights }));
    },

    addTriples: (triples, timestamp) => {
        let newGraph: KnowledgeGraph | null = null;
        const refId = String(timestamp);
        set((state) => {
            const newNodes = [...state.knowledgeGraph.nodes];
            const newEdges = [...state.knowledgeGraph.edges];

            triples.forEach((rawT) => {
                const t = Array.isArray(rawT)
                    ? { subject: rawT[0], relation: rawT[1], object: rawT[2] } as OKFTriple
                    : rawT as OKFTriple;

                const cleanSubject = cleanEntityName(t.subject);
                const cleanObject = cleanEntityName(t.object);
                
                if (!cleanSubject || !cleanObject) return;
                if (isStopwordOrInvalid(cleanSubject) || isStopwordOrInvalid(cleanObject)) return;

                // Process subject
                let sNode = newNodes.find(n => n.id === cleanSubject);
                if (!sNode) {
                    sNode = { 
                        id: cleanSubject, 
                        label: cleanSubject, 
                        val: 1, 
                        type: t.subjectType || 'Other',
                        occurrence_refs: [refId],
                        evidence_strength: 1/3,
                        status: t.subjectType === 'Prediction' ? 'pending' : undefined
                    };
                    newNodes.push(sNode);
                } else {
                    sNode.val = (sNode.val || 1) + 0.1;
                    if (t.subjectType && t.subjectType !== 'Other') {
                        sNode.type = t.subjectType;
                    }
                    if (t.subjectType === 'Prediction' && !sNode.status) {
                        sNode.status = 'pending';
                    }
                    if (!sNode.occurrence_refs) sNode.occurrence_refs = [];
                    if (!sNode.occurrence_refs.includes(refId)) {
                        sNode.occurrence_refs.push(refId);
                    }
                    sNode.evidence_strength = Math.min(1, sNode.occurrence_refs.length / 3);
                }

                // Process object
                let oNode = newNodes.find(n => n.id === cleanObject);
                if (!oNode) {
                    oNode = { 
                        id: cleanObject, 
                        label: cleanObject, 
                        val: 1, 
                        type: t.objectType || 'Other',
                        occurrence_refs: [refId],
                        evidence_strength: 1/3,
                        status: t.objectType === 'Prediction' ? 'pending' : undefined
                    };
                    newNodes.push(oNode);
                } else {
                    oNode.val = (oNode.val || 1) + 0.1;
                    if (t.objectType && t.objectType !== 'Other') {
                        oNode.type = t.objectType;
                    }
                    if (t.objectType === 'Prediction' && !oNode.status) {
                        oNode.status = 'pending';
                    }
                    if (!oNode.occurrence_refs) oNode.occurrence_refs = [];
                    if (!oNode.occurrence_refs.includes(refId)) {
                        oNode.occurrence_refs.push(refId);
                    }
                    oNode.evidence_strength = Math.min(1, oNode.occurrence_refs.length / 3);
                }

                const edgeExists = newEdges.find(e => 
                    e.source === cleanSubject && 
                    e.target === cleanObject && 
                    e.relation === t.relation
                );

                if (!edgeExists) {
                    newEdges.push({ 
                        source: cleanSubject, 
                        target: cleanObject, 
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

    reprocessAllEntries: async (onProgress) => {
        const { entries, apiKey } = get();
        if (!apiKey) {
            throw new Error("מפתח API חסר. אנא הגדר מפתח API בהגדרות.");
        }

        const { processTextSession } = await import('./services/ai');
        const updatedEntries: DiaryEntry[] = [];
        const newNodes: GraphNode[] = [];
        const newEdges: GraphEdge[] = [];

        console.log(`[Reprocess] Starting reprocessing for ${entries.length} entries...`);

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            if (onProgress) {
                onProgress(i + 1, entries.length);
            }
            try {
                // Re-analyze the text using processTextSession
                const processed = await processTextSession(entry.transcript, apiKey);
                
                const updatedEntry: DiaryEntry = {
                    ...entry,
                    triples: processed.triples || [],
                    topics: processed.topics || entry.topics,
                    insights: processed.insights || entry.insights,
                    mood: processed.mood || entry.mood
                };
                updatedEntries.push(updatedEntry);

                // Re-extract nodes and edges
                if (updatedEntry.triples && updatedEntry.triples.length > 0) {
                    updatedEntry.triples.forEach((rawT) => {
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
                                timestamp: entry.timestamp,
                                domain: t.domain,
                                temporalContext: t.temporalContext,
                                confidence: t.confidence,
                                sentiment: t.sentiment
                            });
                        }
                    });
                }

                // Save individual entry back to Firebase
                await FirebaseStorageService.saveEntry(updatedEntry, apiKey);
            } catch (err) {
                console.error(`[Reprocess] Failed for entry ${entry.id}:`, err);
                updatedEntries.push(entry);
            }
        }

        const newGraph = { nodes: newNodes, edges: newEdges };

        // Save rebuilt knowledge graph to Firebase
        await FirebaseStorageService.saveKnowledgeGraph(newGraph);

        // Update Zustand state
        set({
            entries: updatedEntries,
            knowledgeGraph: newGraph
        });

        console.log(`[Reprocess] Completed reprocessing successfully.`);
    },
    
    setKnowledgeGraph: (knowledgeGraph) => {
        set({ knowledgeGraph });
        performFirebaseWrite(set, () => FirebaseStorageService.saveKnowledgeGraph(knowledgeGraph));
    },
    setGraphInsights: (graphInsights) => set({ graphInsights }),
    calibratePredictionsAction: async () => {
        const { entries, knowledgeGraph, apiKey } = get();
        if (!apiKey || entries.length === 0) return;
        const { calibratePredictions } = await import('./services/calibration');
        const calibrations = await calibratePredictions(entries, knowledgeGraph, apiKey);
        if (calibrations.length > 0) {
            let newGraph: KnowledgeGraph | null = null;
            set((state) => {
                const newNodes = state.knowledgeGraph.nodes.map(node => {
                    const match = calibrations.find(c => c.id === node.id);
                    if (match) {
                        return {
                            ...node,
                            status: match.status,
                            evaluation: match.evaluation
                        };
                    }
                    return node;
                });
                newGraph = { ...state.knowledgeGraph, nodes: newNodes };
                return { knowledgeGraph: newGraph };
            });
            if (newGraph) {
                performFirebaseWrite(set, () => FirebaseStorageService.saveKnowledgeGraph(newGraph!));
            }
        }
    },
}));

