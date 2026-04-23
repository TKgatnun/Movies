const express = require('express');
const puppeteer = require('puppeteer');

const router = express.Router();

router.get('/', async (req, res) => {
    const { url, title } = req.query;
    
    if (!url) {
        return res.status(400).json({ error: 'Source URL is required.' });
    }

    let browser;

    try {
        // Launch Puppeteer purely to sniff the network traffic (lightweight)
        browser = await puppeteer.launch({ 
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        });
        
        const page = await browser.newPage();
        
        // Spoof a regular browser User-Agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36');
        
        let streamUrl = null;

        // Intercept network requests looking for the video manifest
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const reqUrl = request.url();
            const resourceType = request.resourceType();
            
            if (reqUrl.includes('.m3u8') || reqUrl.includes('.mp4')) {
                streamUrl = reqUrl;
            }
            
            // Block heavy/unnecessary resources to prevent timeouts
            if (['image', 'stylesheet', 'font'].includes(resourceType)) {
                request.abort();
            } else {
                request.continue();
            }
        });

        // Load the iframe embed URL
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await browser.close();

        if (!streamUrl) {
            return res.status(404).json({ error: 'Could not detect a downloadable video stream on the source page.' });
        }

        // Return the raw URL back to the frontend to handle using local resources
        res.json({
            streamUrl: streamUrl,
            isHls: streamUrl.includes('.m3u8')
        });

    } catch (error) {
        if (browser) await browser.close();
        console.error('Download Extraction Error:', error);
        res.status(500).json({ error: 'Failed to extract download link: ' + error.message });
    }
});

module.exports = router;