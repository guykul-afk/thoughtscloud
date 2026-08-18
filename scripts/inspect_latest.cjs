const puppeteer = require('puppeteer');

async function run() {
  const browser = await puppeteer.launch({ 
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  await page.goto('https://mindcloud-8ccc6.web.app/', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 4000));
  
  const data = await page.evaluate(async () => {
     await window.useAppStore.getState().loadInitialState(true);
     const state = window.useAppStore.getState();
     const entries = state.entries || [];
     const latestEntries = entries.slice(0, 3);
     return {
       count: entries.length,
       latest: latestEntries
     };
  });
  
  console.log("=== LATEST ENTRIES ===");
  console.log(JSON.stringify(data, null, 2));
  
  await browser.close();
  process.exit(0);
}

run().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
