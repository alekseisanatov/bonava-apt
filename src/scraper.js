const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

exports.ApartmentData = {
  id: String,
  price: Number,
  sqMeters: Number,
  roomsCount: Number,
  floor: Number,
  plan: String,
  link: String,
  status: String,
  tag: String,
  projectName: String,
  imageUrl: String,
  projectLink: String
};

async function scrapeBonavaApartments() {
  console.log('Starting browser launch...');
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-zygote',
      '--single-process',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-software-rasterizer'
    ],
  });

  try {
    console.log('Browser launched successfully');
    const page = await browser.newPage();
    console.log('New page created');

    // Set viewport
    await page.setViewport({ width: 1920, height: 1080 });
    console.log('Viewport set');

    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    console.log('User agent set');

    // Navigate to the page
    console.log('Navigating to page...');
    await page.goto('https://www.bonava.lv/dzivokli', {
      waitUntil: 'networkidle0'
    });
    console.log('Page loaded');

    // Handle cookie consent
    try {
      await page.waitForSelector('#onetrust-accept-btn-handler', {
        timeout: 5000
      });
      console.log('Found cookie consent button');
      await page.click('#onetrust-accept-btn-handler');
      console.log('Accepted cookies');
      // Wait a bit for the cookie modal to disappear
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1000)));
    } catch (error) {
      console.log('No cookie consent button found or already accepted');
    }

    // Wait for the project grid to load
    await page.waitForSelector('.product-search__card-grid', {
      timeout: 10000
    });
    console.log('Found project grid');

    const apartments = [];

    // Get all project cards
    const projectCards = await page.$$('.neighbourhood-card');
    console.log(`Found ${projectCards.length} project cards`);

    for (const projectCard of projectCards) {
      try {
        // Get project name
        const projectName = await projectCard.$eval(
          '.neighbourhood-card__heading',
          el => el.textContent?.trim() || ''
        );
        console.log(`Processing project: ${projectName}`);

        // Get project link
        const projectLink = await projectCard.$eval(
          '.neighbourhood-card__info > div > div:nth-child(2) > a',
          a => a.getAttribute('href') || ''
        );
        console.log(`Project link: ${projectLink}`);

        // Click the button to show apartments
        const button = await projectCard.$(
          'div.neighbourhood-card__info > div > div:nth-child(2) > button'
        );
        if (button) {
          await button.click();
          console.log('Clicked project button');

          // Wait for modal to open
          try {
            await page.waitForSelector('.dialog__overlay', {
              timeout: 5000
            });
            console.log('Modal opened');

            // Scroll through the modal content
            await page.evaluate(async () => {
              const modalContent = document.querySelector('.dialog__content');
              if (modalContent) {
                for (let i = 0; i < modalContent.scrollHeight; i += 200) {
                  modalContent.scrollTop = i;
                  await new Promise(res => setTimeout(res, 100));
                }
                modalContent.scrollTop = modalContent.scrollHeight;
              }
            });

            // Wait for apartments to load in the modal
            await page.waitForSelector('.home-card', { timeout: 5000 });
            console.log('Found apartment cards');

            // Get all apartments in this project
            const apartmentCards = await page.$$('.home-card');
            console.log(`Found ${apartmentCards.length} apartments in project ${projectName}`);

            for (const apartmentCard of apartmentCards) {
              try {
                // Get apartment details
                const imageUrl = await apartmentCard.$eval(
                  '.home-card__image-desktop img',
                  img => img.getAttribute('src') || ''
                );
                const title = await apartmentCard.$eval(
                  '.home-card__heading',
                  el => el.textContent?.trim() || ''
                );
                const link = await apartmentCard.$eval(
                  '.home-card__call-to-action a',
                  a => a.getAttribute('href') || ''
                );

                // Get facts (room numbers, sq meters, price, floor)
                const facts = await apartmentCard.$$eval(
                  '.home-card__fact__text',
                  elements => elements.map(el => el.textContent?.trim() || '')
                );

                console.log('Apartment facts:', facts);

                // Parse the facts
                const roomsCount = parseInt(facts[0]?.replace(/[^0-9]/g, '') || '0', 10);
                const sqMeters = parseFloat(facts[1]?.replace(/[^0-9.]/g, '') || '0');
                const price = parseFloat(facts[2]?.replace(/[^0-9.]/g, '') || '0');
                let floor = parseInt(facts[3]?.replace(/[^0-9]/g, '') || '0', 10);

                // If floor number is more than 999, take only the first two numbers
                if (floor > 999) {
                  const floorStr = String(floor);
                  floor = parseInt(floorStr.substring(0, 2), 10);
                }

                const status = await apartmentCard.$eval(
                  '.sales-status__label',
                  el => el.textContent?.trim() || ''
                );

                let tags = [];
                try {
                  tags = await apartmentCard.$$eval(
                    '.offering-tag',
                    elements => {
                      console.log(`Found ${elements.length} tags for this apartment.`);
                      const extractedTags = elements
                        .map(el => el.textContent?.trim() || '')
                        .filter(text => text);
                      console.log('Extracted tags:', extractedTags);
                      return extractedTags;
                    }
                  );
                } catch (error) {
                  tags = [];
                }

                apartments.push({
                  projectName,
                  price,
                  sqMeters,
                  plan: title,
                  roomsCount,
                  imageUrl,
                  floor,
                  link: `${link}`,
                  status,
                  tag: JSON.stringify(tags),
                  projectLink
                });
              } catch (error) {
                console.error('Error processing apartment:', error);
              }
            }

            // Close the modal by clicking outside
            const modal = await page.$('.dialog__overlay');
            if (modal) {
              await modal.click({ offset: { x: 0, y: 0 } });
              await page.waitForSelector('.dialog__overlay', { hidden: true });
              console.log('Modal closed');
            }
          } catch (error) {
            console.error('Error waiting for modal or apartment cards:', error);
          }
        }
      } catch (error) {
        console.error('Error processing project:', error);
      }
    }

    console.log(`Total apartments found: ${apartments.length}`);
    return apartments;

  } catch (error) {
    console.error('Scraping error:', error);
    throw error;
  } finally {
    await browser.close();
    console.log('Browser closed');
  }
}

module.exports = { scrapeBonavaApartments }; 