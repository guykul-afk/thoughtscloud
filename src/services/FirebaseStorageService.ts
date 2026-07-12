import { collection, doc, setDoc, getDoc, getDocs, getDocsFromServer, getDocFromServer, deleteDoc, query, orderBy, where } from 'firebase/firestore';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { db, auth } from './firebase';
import type { DiaryEntry, KnowledgeGraph } from '../store';

class IndexedDBCache {
    private static dbName = 'ThoughtCloudCache';
    private static storeName = 'diary_entries';
    private static version = 1;

    static open(): Promise<IDBDatabase> {
        return new Promise<IDBDatabase>((resolve, reject) => {
            if (typeof indexedDB === 'undefined') {
                reject(new Error('IndexedDB is not supported/defined in this environment'));
                return;
            }
            const request = indexedDB.open(this.dbName, this.version);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'id' });
                }
            };
        });
    }

    static getAll(): Promise<DiaryEntry[]> {
        return this.open().then((db) => {
            return new Promise<DiaryEntry[]>((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readonly');
                const store = tx.objectStore(this.storeName);
                const request = store.getAll();
                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve(request.result);
            });
        }).catch((err) => {
            console.warn("[IndexedDBCache] getAll failed:", err);
            return [] as DiaryEntry[];
        });
    }

    static putAll(entries: DiaryEntry[]): Promise<void> {
        return this.open().then((db) => {
            return new Promise<void>((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readwrite');
                const store = tx.objectStore(this.storeName);
                entries.forEach(entry => store.put(entry));
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        }).catch((err) => {
            console.warn("[IndexedDBCache] putAll failed:", err);
            return Promise.resolve();
        });
    }

    static put(entry: DiaryEntry): Promise<void> {
        return this.open().then((db) => {
            return new Promise<void>((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readwrite');
                const store = tx.objectStore(this.storeName);
                store.put(entry);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        }).catch((err) => {
            console.warn("[IndexedDBCache] put failed:", err);
            return Promise.resolve();
        });
    }

    static delete(id: string): Promise<void> {
        return this.open().then((db) => {
            return new Promise<void>((resolve, reject) => {
                const tx = db.transaction(this.storeName, 'readwrite');
                const store = tx.objectStore(this.storeName);
                store.delete(id);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        }).catch((err) => {
            console.warn("[IndexedDBCache] delete failed:", err);
            return Promise.resolve();
        });
    }
}

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
                        resolve(user.uid);
                    } else {
                        signInAnonymously(auth)
                            .then((userCredential) => {
                                this.uid = userCredential.user.uid;
                                localStorage.setItem('firebase_sync_uid', userCredential.user.uid);
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

        // Save to IndexedDB cache
        try {
            await IndexedDBCache.put(entry);
            console.log(`[FirebaseStorageService] Saved entry ${entry.id} to IndexedDB cache`);
        } catch (err) {
            console.warn("[FirebaseStorageService] Failed to save entry to IndexedDB:", err);
        }
    }

    static async deleteEntry(id: string, timestamp: number): Promise<void> {
        const uid = await this.getUid();
        const date = new Date(timestamp).toISOString().split('T')[0];
        const docId = `${date}_${id}`;
        const docRef = doc(db, `users/${uid}/entries`, docId);
        
        await deleteDoc(docRef);

        // Delete from IndexedDB cache
        try {
            await IndexedDBCache.delete(id);
            console.log(`[FirebaseStorageService] Deleted entry ${id} from IndexedDB cache`);
        } catch (err) {
            console.warn("[FirebaseStorageService] Failed to delete entry from IndexedDB:", err);
        }
    }

    static async saveKnowledgeGraph(graph: KnowledgeGraph): Promise<void> {
        const uid = await this.getUid();
        
        // Save each node as a document
        for (const node of graph.nodes) {
            const safeDocId = node.id.replace(/\//g, '%2F');
            const docRef = doc(db, `users/${uid}/entities`, safeDocId);
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
        
        // 1. Try to load cached entries from IndexedDB
        let cachedEntries: DiaryEntry[] = [];
        try {
            cachedEntries = await IndexedDBCache.getAll();
            console.log(`[FirebaseStorageService] Loaded ${cachedEntries.length} entries from IndexedDB cache`);
        } catch (err) {
            console.warn("[FirebaseStorageService] Failed to load entries from IndexedDB cache:", err);
        }

        // 2. Find the latest timestamp from cached entries to use for delta sync
        let lastTimestamp = 0;
        if (cachedEntries.length > 0) {
            // Sort to find the latest
            cachedEntries.sort((a, b) => b.timestamp - a.timestamp);
            lastTimestamp = cachedEntries[0].timestamp;
        }

        const entriesRef = collection(db, `users/${uid}/entries`);
        let q;
        if (lastTimestamp > 0) {
            q = query(entriesRef, where('timestamp', '>', lastTimestamp), orderBy('timestamp', 'desc'));
            console.log(`[FirebaseStorageService] Fetching delta updates since ${new Date(lastTimestamp).toISOString()}`);
        } else {
            q = query(entriesRef, orderBy('timestamp', 'desc'));
            console.log("[FirebaseStorageService] No cache found. Fetching all entries from server");
        }
        
        let querySnapshot;
        try {
            querySnapshot = await getDocsFromServer(q);
            console.log(`[FirebaseStorageService] Fetched ${querySnapshot.size} delta entries from server`);
        } catch (err) {
            console.warn("[FirebaseStorageService] Failed to load entries from server, falling back to cache query:", err);
            querySnapshot = await getDocs(q);
        }
        
        const newEntries: DiaryEntry[] = [];
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
                data.embedding = Array.isArray(data.embedding) ? data.embedding : data.embedding.toArray ? data.embedding.toArray() : null;
            }
            newEntries.push(data as DiaryEntry);
        });

        // 3. Save new entries to IndexedDB and merge with cache
        if (newEntries.length > 0) {
            try {
                await IndexedDBCache.putAll(newEntries);
                console.log(`[FirebaseStorageService] Cached ${newEntries.length} new entries to IndexedDB`);
            } catch (err) {
                console.warn("[FirebaseStorageService] Failed to save new entries to IndexedDB cache:", err);
            }

            const mergedMap = new Map<string, DiaryEntry>();
            cachedEntries.forEach(e => mergedMap.set(e.id, e));
            newEntries.forEach(e => mergedMap.set(e.id, e));
            
            const mergedList = Array.from(mergedMap.values());
            mergedList.sort((a, b) => b.timestamp - a.timestamp);
            return mergedList;
        }
        
        return cachedEntries;
    }

    static async getSimilarEntries(queryText: string, apiKey: string, limitCount = 3, existingEntries?: DiaryEntry[]): Promise<DiaryEntry[]> {
        let queryEmbedding: number[];
        try {
            const { generateTextEmbedding } = await import('./ai');
            queryEmbedding = await generateTextEmbedding(queryText, apiKey);
        } catch (e) {
            console.error("Failed to generate embedding for query:", e);
            return [];
        }
        
        // Use in-memory entries if provided, otherwise fallback to loading from cache/server
        const allEntries = existingEntries || await this.loadAllEntries();
        
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
        const nodesRef = collection(db, `users/${uid}/entities`);
        
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

    static async saveEpisodicSummary(period: string, summary: any): Promise<void> {
        const uid = await this.getUid();
        const docRef = doc(db, `users/${uid}/episodic`, period);
        await setDoc(docRef, summary);
    }

    static async loadEpisodicSummary(period: string): Promise<any | null> {
        const uid = await this.getUid();
        const docRef = doc(db, `users/${uid}/episodic`, period);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) return docSnap.data();
        return null;
    }

    static async saveIdentityPersona(persona: any): Promise<void> {
        const uid = await this.getUid();
        const docRef = doc(db, `users/${uid}/identity`, 'persona');
        await setDoc(docRef, persona);
    }

    static async loadIdentityPersona(): Promise<any | null> {
        const uid = await this.getUid();
        const docRef = doc(db, `users/${uid}/identity`, 'persona');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) return docSnap.data();
        return null;
    }
}
