const puppeteer = require('puppeteer');

async function run() {
  console.log("Starting browser...");
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  
  console.log("Navigating to app...");
  await page.goto('http://localhost:5180');
  
  console.log("Waiting for app to load...");
  await new Promise(r => setTimeout(r, 4000));
  
  console.log("Starting reprocess. This might take a while depending on number of entries...");
  await page.evaluate(async () => {
     return await window.useAppStore.getState().reprocessAllEntries(
       (current, total) => console.log(`Reprocess Progress: ${current}/${total}`)
     );
  });
  
  console.log("Reprocess completed successfully!");
  await browser.close();
  process.exit(0);
}

run().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
