# Development & Scraper Thought Process Log

This document tracks the evolution of the `download.js` backend scraper and `index.html` frontend, specifically focusing on bypassing anti-bot protections and extracting video streams.

---

### Phase 1: Eager Link Extraction & Short-Circuiting
**Problem:** The backend scraper was timing out and missing network requests because it waited too long or instantly closed the browser after the DOM loaded.
**Thought Process:** We don't actually care about the page fully rendering; we only care about the `.m3u8` or `.mp4` network requests. If we can grab the URL the millisecond the request is fired, we can close the browser immediately to save server RAM/CPU and return the link to the user much faster.
**Changes Made (`download.js`):**
- Wrapped request interception in a `Promise` (`streamPromise`).
- Used `Promise.race()` to short-circuit `page.goto` if the manifest URL is found early.
- Added a fallback grace period timer (10-15s) in case the video request is delayed.

### Phase 2: Headless Masking & Basic Interaction
**Problem:** Streaming sites returned "Could not detect a downloadable video stream". They were detecting Puppeteer as a bot and requiring a user to click "Play" before loading the video.
**Thought Process:** We need to make Puppeteer look less like a robot and act more like a human. Headless Chrome broadcasts a `navigator.webdriver = true` flag that sites look for. Furthermore, we need to click the center of the iframe to trigger the lazy-loaded video players.
**Changes Made (`download.js`):**
- Used `page.evaluateOnNewDocument()` to spoof/hide the `navigator.webdriver` property.
- Added a `try/catch` block to calculate the viewport center and simulate a mouse click (`page.mouse.click`).

### Phase 3: MIME-Type Sniffing & Advanced Spoofing
**Problem:** Still failing. Providers were hiding `.m3u8` from the URL string entirely (URL obfuscation) and using multiple layers of invisible pop-under ads that blocked our simulated click.
**Thought Process:** Even if a provider hides the URL, the browser *must* receive the correct `Content-Type` header (like `application/x-mpegurl`) to play HLS streams. We should sniff the response headers instead of just the request URLs. We also need to click multiple times to burn through ad layers.
**Changes Made (`download.js`):**
- Added `page.on('response')` to detect streams by their MIME type (e.g., `mpegurl`, `video/mp4`).
- Increased the interaction loop to 3 clicks with a slight delay between them.
- Added additional bot-evasion spoofs: `navigator.plugins`, `navigator.languages`, and a dummy `window.chrome` object.

### Phase 4: Client-Side VLC Spoofing (Bypassing IP/UA Locks)
**Problem:** The backend successfully returned a 400-byte `.m3u` file, but opening it in VLC resulted in a connection error. The provider (e.g., VidLink) was IP-locking the stream or blocking VLC's default user-agent.
**Thought Process:** We can't proxy 1.5GB of video through our free Render backend to bypass the IP lock. Instead, we can instruct VLC to "lie" about who it is. VLC has hidden `#EXTVLCOPT` headers that allow us to spoof the `Referer` and `User-Agent`.
**Changes Made (`index.html`):**
- Updated the Blob generation logic for `.m3u` files to inject `#EXTVLCOPT:http-referrer=...` and `#EXTVLCOPT:http-user-agent=...`.
- Added a detailed `alert()` modal to explain to users *why* the file is small, how to use VLC's Convert/Save feature, and how to switch sources if an IP-lock persists.

### Phase 5: Nested Iframes, Focus-Stealing Popups, & Network Settling
**Problem:** Servers like VidSrc and SuperEmbed were still failing to extract links.
**Thought Process:** These servers use nested iframes (iframes inside iframes) and aggressive anti-bot measures. Puppeteer was clicking before the nested video player finished downloading. When it did click, pop-under ads opened in new tabs, stealing Puppeteer's focus and causing subsequent clicks to miss. They also tracked mouse movements and verified CSS/Image loading.
**Changes Made (`download.js`):**
- Re-enabled CSS/Image loading so we don't look like a basic scraper.
- Added `browser.on('targetcreated')` to instantly intercept and close any popup tabs, keeping focus strictly on the video player.
- Changed `page.goto` to wait for `networkidle2` so nested iframes have time to mount.
- Added a `page.mouse.move()` event to simulate hovering over the player to reveal UI controls.
- Added a secondary click slightly offset (`height / 2 + 40`) to catch play buttons that aren't perfectly centered.
- Added `application/dash+xml` to the MIME-type sniffer to catch more stream formats.

---

### How to use this document
Moving forward, whenever a new feature, fix, or scraper bypass is added to the codebase, log it here using the following format:

```markdown
### Phase X: [Feature/Fix Name]
**Problem:** [What was broken or needed?]
**Thought Process:** [Why did we solve it this way?]
**Changes Made:** [Files modified and code logic added]
```