const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`[${msg.type()}] ${msg.text()}`);
    }
  });
  
  page.on('pageerror', error => {
    console.log(`[pageerror] ${error.message}`);
  });

  await page.goto('http://localhost:5176/tywrap/');
  await new Promise(r => setTimeout(r, 2000));
  await browser.close();
})();
