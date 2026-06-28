import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, orderBy } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

const firebaseConfig = {
  projectId: "mindcloud-8ccc6",
  appId: "1:961085343809:web:a7c8c68360c3d820f21ec0",
  storageBucket: "mindcloud-8ccc6.firebasestorage.app",
  apiKey: "AIzaSyDAPtxu-nJO7VDdI7OwJY7e7QFl6hrzLY0",
  authDomain: "mindcloud-8ccc6.firebaseapp.com",
  messagingSenderId: "961085343809",
  measurementId: "G-J766284FQK"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Keep track of the active user session or sign in anonymously if none exists
export function getFirebaseUid() {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      if (user) {
        resolve(user.uid);
      } else {
        signInAnonymously(auth)
          .then((userCredential) => {
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

export { db, auth };

// Helper to fetch entries from Firebase Firestore
export async function fetchFirebaseEntries(uid) {
  if (!uid) throw new Error("Missing User ID (UID)");
  const entriesRef = collection(db, `users/${uid}/entries`);
  const q = query(entriesRef, orderBy('timestamp', 'desc'));
  const querySnapshot = await getDocs(q);
  
  const entries = [];
  querySnapshot.forEach((doc) => {
    const data = doc.data();
    // Convert to a format matching the local file structure so the frontend code works seamlessly
    entries.push({
      id: data.id || doc.id,
      frontmatter: {
        date: data.timestamp ? new Date(data.timestamp).toISOString().split('T')[0] : 'תאריך לא ידוע',
        topics: data.topics || [],
        open_threads: (data.openThreads || data.open_threads || []).map(t => typeof t === 'string' ? t : t.text || '')
      },
      content: data.transcript || data.content || ''
    });
  });
  return entries;
}

// Helper to fetch knowledge graph nodes & links from Firebase Firestore
export async function fetchFirebaseGraph(uid) {
  if (!uid) throw new Error("Missing User ID (UID)");
  const nodesRef = collection(db, `users/${uid}/knowledge_graph_nodes`);
  const querySnapshot = await getDocs(nodesRef);
  
  const nodes = [];
  const links = [];
  const edgeIds = new Set();
  const nodeIds = new Set();

  querySnapshot.forEach((doc) => {
    const data = doc.data();
    const nodeId = data.id || doc.id;
    
    nodes.push({
      id: nodeId,
      name: data.label || nodeId,
      type: data.type || 'Concept',
      weight: data.val || 1,
      content: data.content || ''
    });
    nodeIds.add(nodeId.toLowerCase());

    if (data.relatedEdges) {
      data.relatedEdges.forEach((edge) => {
        const edgeId = `${edge.source}-${edge.target}-${edge.relation}`;
        if (!edgeIds.has(edgeId)) {
          edgeIds.add(edgeId);
          links.push({
            source: edge.source,
            target: edge.target,
            label: edge.relation || 'relates'
          });
        }
      });
    }
  });

  // Ensure all link targets/sources exist in nodes list
  links.forEach(link => {
    const targetLower = typeof link.target === 'string' ? link.target.toLowerCase() : link.target.id.toLowerCase();
    const sourceLower = typeof link.source === 'string' ? link.source.toLowerCase() : link.source.id.toLowerCase();

    if (!nodeIds.has(targetLower)) {
      const targetName = typeof link.target === 'string' ? link.target : link.target.id;
      nodes.push({
        id: targetName,
        name: targetName,
        type: 'Concept',
        weight: 1,
        content: ''
      });
      nodeIds.add(targetLower);
    }
    if (!nodeIds.has(sourceLower)) {
      const sourceName = typeof link.source === 'string' ? link.source : link.source.id;
      nodes.push({
        id: sourceName,
        name: sourceName,
        type: 'Concept',
        weight: 1,
        content: ''
      });
      nodeIds.add(sourceLower);
    }
  });

  return { nodes, links };
}
