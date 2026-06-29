import { collection, doc, setDoc, getDoc, getDocs, getDocsFromServer, getDocFromServer, deleteDoc, query, orderBy } from 'firebase/firestore';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { db, auth } from './firebase';
import type { DiaryEntry, KnowledgeGraph } from '../store';
import { triggerOkfFirebaseMigration } from './okfFirebaseMigration';

export class FirebaseStorageService {
    private static uid: string | null = null;
    private static authPromise: Promise<string>;

    static init() {
        if (!this.authPromise) {
            const localUid = localStorage.getItem('firebase_sync_uid');
            if (localUid) {
                this.uid = localUid;
                this.authPromise = Promise.resolve(localUid);
                return this.authPromise;
            }

            this.authPromise = new Promise((resolve, reject) => {
                onAuthStateChanged(auth, (user) => {
                    if (user) {
                        this.uid = user.uid;
                        localStorage.setItem('firebase_sync_uid', user.uid);
                        triggerOkfFirebaseMigration(user.uid).catch((err) => {
                            console.error("[OKF Auto Migration Error]", err);
                        });
                        resolve(user.uid);
                    } else {
                        signInAnonymously(auth)
                            .then((userCredential) => {
                                this.uid = userCredential.user.uid;
                                localStorage.setItem('firebase_sync_uid', userCredential.user.uid);
                                triggerOkfFirebaseMigration(userCredential.user.uid).catch((err) => {
                                    console.error("[OKF Auto Migration Error]", err);
                                });
                                resolve(userCredential.user.uid);
                            })
                            .catch((error) => {
                                console.error("Firebase Auth Error:", error);
                                reject(error);
                            });
                    }
                });
            });
        }
        return this.authPromise;
    }

    static setCustomUid(customUid: string) {
        const cleanUid = customUid.trim();
        if (cleanUid) {
            this.uid = cleanUid;
            localStorage.setItem('firebase_sync_uid', cleanUid);
            this.authPromise = Promise.resolve(cleanUid);
        }
    }

    private static async getUid(): Promise<string> {
        const localUid = localStorage.getItem('firebase_sync_uid');
        if (localUid) {
            this.uid = localUid;
            return localUid;
        }
        if (!this.uid) {
            await this.init();
        }
        return this.uid!;
    }

    static async saveEntry(entry: DiaryEntry, apiKey?: string): Promise<void> {
        const uid = await this.getUid();
        const date = new Date(entry.timestamp).toISOString().split('T')[0];
        const docId = `${date}_${entry.id}`;
        const docRef = doc(db, `users/${uid}/entries`, docId);
        
        let embeddingArray = entry.embedding;
        if (!embeddingArray && apiKey) {
            try {
                const { generateTextEmbedding } = await import('./ai');
                embeddingArray = await generateTextEmbedding(entry.transcript, apiKey);
            } catch (e) {
                console.error("Failed to generate embedding for entry:", e);
            }
        }
        
        // Native OKFTriple representation is already an array of flat objects, which Firestore supports!
        const firestoreEntry: any = {
            ...entry,
            triples: entry.triples ? entry.triples.map((t: any) => {
                if (Array.isArray(t)) {
                    return { 
                        subject: t[0] || '', 
                        relation: t[1] || '', 
                        object: t[2] || '',
                        domain: 'General',
                        temporalContext: 'Present',
                        confidence: 'Fact',
                        sentiment: 0,
                        subjectType: 'Other',
                        objectType: 'Other'
                    };
                }
                return {
                    subject: t.subject || t.s || '',
                    relation: t.relation || t.r || '',
                    object: t.object || t.o || '',
                    domain: t.domain || 'General',
                    temporalContext: t.temporalContext || 'Present',
                    confidence: t.confidence || 'Fact',
                    sentiment: typeof t.sentiment === 'number' ? t.sentiment : 0,
                    subjectType: t.subjectType || 'Other',
                    objectType: t.objectType || 'Other'
                };
            }) : []
        };
        
        if (embeddingArray) {
            firestoreEntry.embedding = embeddingArray;
            entry.embedding = embeddingArray; // update the local object too
        }
        
        await setDoc(docRef, firestoreEntry);
    }

    static async deleteEntry(id: string, timestamp: number): Promise<void> {
        const uid = await this.getUid();
        const date = new Date(timestamp).toISOString().split('T')[0];
        const docId = `${date}_${id}`;
        const docRef = doc(db, `users/${uid}/entries`, docId);
        
        await deleteDoc(docRef);
    }

    static async saveKnowledgeGraph(graph: KnowledgeGraph): Promise<void> {
        const uid = await this.getUid();
        
        // Save each node as a document
        for (const node of graph.nodes) {
            const safeDocId = node.id.replace(/\//g, '%2F');
            const docRef = doc(db, `users/${uid}/knowledge_graph_nodes`, safeDocId);
            // Find edges related to this node
            const relatedEdges = graph.edges.filter(e => e.source === node.id || e.target === node.id);
            
            await setDoc(docRef, {
                ...node,
                relatedEdges
            });
        }
    }

    static async saveInsights(insights: any): Promise<void> {
        const uid = await this.getUid();
        const docRef = doc(db, `users/${uid}/insights`, 'current');
        
        await setDoc(docRef, insights, { merge: true });
    }

    static async loadAllEntries(): Promise<DiaryEntry[]> {
        const uid = await this.getUid();
        const entriesRef = collection(db, `users/${uid}/entries`);
        const q = query(entriesRef, orderBy('timestamp', 'desc'));
        
        let querySnapshot;
        try {
            querySnapshot = await getDocsFromServer(q);
            console.log("[FirebaseStorageService] Loaded entries from server successfully");
        } catch (err) {
            console.warn("[FirebaseStorageService] Failed to load entries from server, falling back to cache:", err);
            querySnapshot = await getDocs(q);
        }
        
        const entries: DiaryEntry[] = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            if (data.triples) {
                // Convert any legacy representations to OKFTriple format
                data.triples = data.triples.map((t: any) => {
                    if (Array.isArray(t)) {
                        return { 
                            subject: t[0] || '', 
                            relation: t[1] || '', 
                            object: t[2] || '',
                            domain: 'General',
                            temporalContext: 'Present',
                            confidence: 'Fact',
                            sentiment: 0,
                            subjectType: 'Other',
                            objectType: 'Other'
                        };
                    }
                    return {
                        subject: t.subject || t.s || '',
                        relation: t.relation || t.r || '',
                        object: t.object || t.o || '',
                        domain: t.domain || 'General',
                        temporalContext: t.temporalContext || 'Present',
                        confidence: t.confidence || 'Fact',
                        sentiment: typeof t.sentiment === 'number' ? t.sentiment : 0,
                        subjectType: t.subjectType || 'Other',
                        objectType: t.objectType || 'Other'
                    };
                });
            }
            if (data.embedding) {
                // Convert vectorValue back to array if needed, though usually it comes back as a VectorValue object
                data.embedding = Array.isArray(data.embedding) ? data.embedding : data.embedding.toArray ? data.embedding.toArray() : null;
            }
            entries.push(data as DiaryEntry);
        });
        return entries;
    }

    static async getSimilarEntries(queryText: string, apiKey: string, limitCount = 3): Promise<DiaryEntry[]> {
        let queryEmbedding: number[];
        try {
            const { generateTextEmbedding } = await import('./ai');
            queryEmbedding = await generateTextEmbedding(queryText, apiKey);
        } catch (e) {
            console.error("Failed to generate embedding for query:", e);
            return [];
        }
        
        // Load all entries since Web SDK does not support findNearest natively
        const allEntries = await this.loadAllEntries();
        
        // Helper for cosine similarity
        const cosineSimilarity = (vecA: number[], vecB: number[]) => {
            let dotProduct = 0;
            let normA = 0;
            let normB = 0;
            for (let i = 0; i < vecA.length; i++) {
                dotProduct += vecA[i] * vecB[i];
                normA += vecA[i] * vecA[i];
                normB += vecB[i] * vecB[i];
            }
            if (normA === 0 || normB === 0) return 0;
            return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
        };

        const entriesWithScores = allEntries
            .filter(e => e.embedding && Array.isArray(e.embedding) && e.embedding.length === queryEmbedding.length)
            .map(e => ({
                entry: e,
                score: cosineSimilarity(queryEmbedding, e.embedding!)
            }));
            
        entriesWithScores.sort((a, b) => b.score - a.score);
        
        return entriesWithScores.slice(0, limitCount).map(r => r.entry);
    }

    static async loadKnowledgeGraph(): Promise<KnowledgeGraph> {
        const uid = await this.getUid();
        const nodesRef = collection(db, `users/${uid}/knowledge_graph_nodes`);
        
        let querySnapshot;
        try {
            querySnapshot = await getDocsFromServer(nodesRef);
            console.log("[FirebaseStorageService] Loaded knowledge graph from server successfully");
        } catch (err) {
            console.warn("[FirebaseStorageService] Failed to load knowledge graph from server, falling back to cache:", err);
            querySnapshot = await getDocs(nodesRef);
        }
        
        const nodes: any[] = [];
        const edges: any[] = [];
        const edgeIds = new Set<string>();

        querySnapshot.forEach((doc) => {
            const data = doc.data();
            nodes.push({ id: data.id, label: data.label, val: data.val });
            
            if (data.relatedEdges) {
                data.relatedEdges.forEach((edge: any) => {
                    const edgeId = `${edge.source}-${edge.target}-${edge.relation}`;
                    if (!edgeIds.has(edgeId)) {
                        edgeIds.add(edgeId);
                        edges.push(edge);
                    }
                });
            }
        });

        return { nodes, edges };
    }

    static async loadInsights(): Promise<any> {
        const uid = await this.getUid();
        const docRef = doc(db, `users/${uid}/insights`, 'current');
        
        let docSnap;
        try {
            docSnap = await getDocFromServer(docRef);
            console.log("[FirebaseStorageService] Loaded insights from server successfully");
        } catch (err) {
            console.warn("[FirebaseStorageService] Failed to load insights from server, falling back to cache:", err);
            docSnap = await getDoc(docRef);
        }
        
        if (docSnap.exists()) {
            return docSnap.data();
        }
        return {};
    }
}
