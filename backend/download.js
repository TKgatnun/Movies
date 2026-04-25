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
        
        // Automatically close any popup tabs opened by invisible ad overlays to keep focus on the player
        browser.on('targetcreated', async (target) => {
            if (target.type() === 'page') {
                const newPage = await target.page();
                if (newPage && newPage !== page) {
                    await newPage.close().catch(() => {});
                }
            }
        });

        // Spoof a regular browser User-Agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        
        // Set a Referer. Most streaming sites block direct access without a referer header to prevent hotlinking.
        await page.setExtraHTTPHeaders({
            'Referer': req.get('referer') || 'https://google.com/'
        });

        let streamUrl = null;
        let streamHeaders = {};

        // Bypass basic headless detection
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            window.chrome = { runtime: {} };
        });

        // Intercept network requests looking for the video manifest
        await page.setRequestInterception(true);
        
        const streamPromise = new Promise(resolve => {
            page.on('request', (request) => {
                const reqUrl = request.url();
                const resourceType = request.resourceType();
                
                if (reqUrl.includes('.m3u8') || reqUrl.includes('.mp4') || reqUrl.includes('/playlist.m3u8')) {
                    streamUrl = reqUrl;
                    streamHeaders = request.headers();
                    resolve();
                }
                
                // Let all resources load. Many anti-bot systems check if CSS/Images loaded to detect scrapers.
                request.continue();
            });

            // Also listen to responses to catch obfuscated URLs by their MIME type
            page.on('response', (response) => {
                const resUrl = response.url();
                const contentType = (response.headers()['content-type'] || '').toLowerCase();
                
                if (
                    contentType.includes('mpegurl') || 
                    contentType.includes('video/mp4') ||
                    contentType.includes('video/webm') ||
                    contentType.includes('application/dash+xml')
                ) {
                    streamUrl = resUrl;
                streamHeaders = response.request().headers();
                    resolve();
                }
            });
        });

        // Load the iframe embed URL, resolving early if the stream is found
        await Promise.race([
            streamPromise,
            // Use networkidle2 so Puppeteer waits for nested iframes (like VidSrc's player) to finish loading
            page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})
        ]);

        if (!streamUrl) {
            // Many streaming sites require a user click to initialize the video player
            try {
                // Give the player 2 extra seconds to fully mount its UI components after the network settles
                await new Promise(r => setTimeout(r, 2000));

                const { width, height } = page.viewport();
                // Move the mouse to the center first to trigger any hover-state UI
                await page.mouse.move(width / 2, height / 2);
                await new Promise(r => setTimeout(r, 500));

                // Multiple clicks to bypass invisible ad overlays / popunders
                for (let i = 0; i < 3; i++) {
                    await page.mouse.click(width / 2, height / 2);
                    await new Promise(r => setTimeout(r, 800));
                    // Click slightly offset in case the play button isn't perfectly centered
                    await page.mouse.click(width / 2, (height / 2) + 40);
                }
                // Also try keyboard interaction if an iframe got focused
                await page.keyboard.press('Space');
            } catch (e) {
                console.log('Click simulation failed:', e.message);
            }

            // Wait up to 15 additional seconds for the video request to be made after interaction
            let timeoutId;
            await Promise.race([
                streamPromise,
                new Promise(resolve => { timeoutId = setTimeout(resolve, 15000); })
            ]);
            clearTimeout(timeoutId);
        }
        
        await browser.close();

        if (!streamUrl) {
            return res.status(404).json({ error: 'Could not detect a downloadable video stream on the source page.' });
        }

        // Extract the exact headers demanded by the streaming server
        const referer = streamHeaders['referer'] || url;
        const origin = streamHeaders['origin'] || (url.startsWith('http') ? new URL(url).origin : '');
        const userAgent = streamHeaders['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

        // Generate commands for tools that allow HTTP header spoofing
        const ffmpegCmd = `ffmpeg -headers "Referer: ${referer}\r\nOrigin: ${origin}\r\n" -user_agent "${userAgent}" -i "${streamUrl}" -c copy "output.mp4"`;
        const ytdlpCmd = `yt-dlp --referer "${referer}" --add-header "Origin: ${origin}" --user-agent "${userAgent}" "${streamUrl}" -o "output.mp4"`;

        // Return the raw URL and spoofing data back to the frontend
        res.json({
            streamUrl: streamUrl,
            isHls: streamUrl.includes('.m3u8'),
            headers: {
                referer: referer,
                origin: origin,
                userAgent: userAgent
            },
            commands: {
                ffmpeg: ffmpegCmd,
                ytdlp: ytdlpCmd
            }
        });

    } catch (error) {
        if (browser) await browser.close();
        console.error('Download Extraction Error:', error);
        res.status(500).json({ error: 'Failed to extract download link: ' + error.message });
    }
});

module.exports = router;