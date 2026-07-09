const puppeteer = require('puppeteer');

async function run() {
  const uid = process.env.FIREBASE_UID || 'K9j4Nx0WK7NKYJs6iDUz35LXFai1';
  const apiKey = process.env.GEMINI_API_KEY || '';

  console.log("Starting browser...");
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => {
    const txt = msg.text();
    if (txt.includes('Reprocess') || txt.includes('Firebase') || txt.includes('Error') || txt.includes('Progress')) {
      console.log('PAGE LOG:', txt);
    }
  });
  
  console.log("Navigating to app...");
  await page.goto('http://localhost:5180');
  await new Promise(r => setTimeout(r, 2000));

  console.log("Setting credentials in localStorage...");
  await page.evaluate((u, k) => {
    localStorage.setItem('firebase_sync_uid', u);
    localStorage.setItem('gemini_api_key', k);
  }, uid, apiKey);

  console.log("Reloading page to apply credentials...");
  await page.reload();
  
  console.log("Waiting for app to load with user data...");
  await new Promise(r => setTimeout(r, 8000));

  // Retrieve entries from the page store
  const allEntries = await page.evaluate(() => {
    return window.useAppStore.getState().entries.map(e => ({ id: e.id, transcript: e.transcript, topics: e.topics, mood: e.mood, quotes: e.quotes }));
  });

  // Filter entries that contain quotation marks or the word "ציטוט"
  const targetEntries = allEntries.filter(e => {
    const text = e.transcript || '';
    const hasQuoteMarks = text.includes('"') || text.includes('“') || text.includes('”') || text.includes('«') || text.includes('»') || text.includes("'");
    const hasWordQuote = text.includes('ציטוט') || (e.topics || []).some(t => t.includes('ציטוט'));
    const hasExistingQuotes = e.quotes && e.quotes.length > 0;
    return hasQuoteMarks || hasWordQuote || hasExistingQuotes;
  });

  console.log(`Found ${allEntries.length} total entries. Filtered down to ${targetEntries.length} entries that potentially contain quotes.`);
  console.log("Starting targeted quote reprocessing...");

  for (let i = 0; i < targetEntries.length; i++) {
    const entry = targetEntries[i];
    console.log(`[${i + 1}/${targetEntries.length}] Reprocessing quote-entry ${entry.id}...`);

    try {
      const updated = await page.evaluate(async (id, key) => {
        const state = window.useAppStore.getState();
        const e = state.entries.find(item => item.id === id);
        if (!e) throw new Error("Entry not found in store: " + id);

        if (!window.processTextSession) {
          throw new Error("processTextSession is not initialized on window yet");
        }
        const processed = await window.processTextSession(e.transcript, key);
        
        const updatedEntry = {
          ...e,
          triples: processed.triples || [],
          topics: processed.topics || e.topics,
          insights: processed.insights || e.insights,
          mood: processed.mood || e.mood,
          quotes: processed.quotes || []
        };

        if (!window.FirebaseStorageService) {
          throw new Error("FirebaseStorageService is not initialized on window yet");
        }
        await window.FirebaseStorageService.saveEntry(updatedEntry, key);

        // Update local store state
        const idx = state.entries.findIndex(item => item.id === id);
        if (idx !== -1) {
          state.entries[idx] = updatedEntry;
        }

        return { id: updatedEntry.id, quotesCount: updatedEntry.quotes.length, quotes: updatedEntry.quotes };
      }, entry.id, apiKey);

      console.log(`    -> Success. Extracted ${updated.quotesCount} quotes:`, JSON.stringify(updated.quotes));
    } catch (err) {
      console.error(`    -> Failed for entry ${entry.id}:`, err.message);
    }

    // Delay for API rate limits
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log("Rebuilding and saving Knowledge Graph to update quotes relation context...");
  await page.evaluate(async () => {
    const state = window.useAppStore.getState();
    const storageService = window.FirebaseStorageService;
    if (!storageService) throw new Error("FirebaseStorageService not found on window");
    
    const newNodes = [];
    const newEdges = [];

    state.entries.forEach(entry => {
      if (entry.triples && entry.triples.length > 0) {
        entry.triples.forEach(rawT => {
          const t = Array.isArray(rawT) 
            ? { subject: rawT[0], relation: rawT[1], object: rawT[2] }
            : rawT;
          
          const sLower = (t.subject || '').trim();
          const oLower = (t.object || '').trim();
          if (!sLower || !oLower) return;

          if (!newNodes.find(n => n.id === sLower)) {
            newNodes.push({ id: sLower, label: sLower, val: 1, type: t.subjectType || 'Other' });
          } else {
            const node = newNodes.find(n => n.id === sLower);
            if (node) {
              node.val = (node.val || 1) + 0.1;
              if (t.subjectType && t.subjectType !== 'Other') node.type = t.subjectType;
            }
          }

          if (!newNodes.find(n => n.id === oLower)) {
            newNodes.push({ id: oLower, label: oLower, val: 1, type: t.objectType || 'Other' });
          } else {
            const node = newNodes.find(n => n.id === oLower);
            if (node) {
              node.val = (node.val || 1) + 0.1;
              if (t.objectType && t.objectType !== 'Other') node.type = t.objectType;
            }
          }

          const edgeExists = newEdges.find(e => e.source === sLower && e.target === oLower && e.relation === t.relation);
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
    });

    const newGraph = { nodes: newNodes, edges: newEdges };
    await storageService.saveKnowledgeGraph(newGraph);
    state.setKnowledgeGraph(newGraph);
  });

  console.log("Quotes reprocessing completed successfully!");
  await browser.close();
  process.exit(0);
}

run().catch(err => {
  console.error("Fatal Error:", err);
  process.exit(1);
});
