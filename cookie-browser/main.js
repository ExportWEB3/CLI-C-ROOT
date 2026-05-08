const { app, BrowserWindow, session } = require('electron');
const http = require('http');
const url = require('url');

// ── Config ──────────────────────────────────────────────────────────────
const PORT = 23456; // Local HTTP server port for bridge communication
let mainWindow = null;

// ── HTTP Server: receives cookie sessions from bridge ───────────────────
const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end('Method not allowed');
    return;
  }

  let body = '';
  req.on('data', chunk => (body += chunk));
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      openSession(data.url, data.cookies || []);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: err.message }));
    }
  });
});

// ── Open a new window with cookies injected ────────────────────────────
function openSession(targetUrl, cookies) {
  console.log(`[SESSION] openSession called: url=${targetUrl} cookies=${cookies.length}`);

  if (!targetUrl) {
    console.error('[SESSION] No targetUrl — aborting');
    return;
  }

  // Parse the target URL to get the domain for cookie scope
  const parsed = url.parse(targetUrl);
  const domain = parsed.hostname; // e.g., "facebook.com"

  // Create a unique isolated session for this window so cookies don't bleed across windows
  const partition = `persist:cookie-session-${Date.now()}`;
  const cookieSession = session.fromPartition(partition);

  // The BrowserWindow MUST use the same partition so the injected cookies are visible
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false, // hidden until page is fully loaded
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition, // ← ties the window to the session we're about to populate
    },
  });

  // Show + maximize only once the page has actually rendered
  win.webContents.once('did-finish-load', () => {
    console.log(`[SESSION] Page loaded: ${targetUrl}`);
    win.show();
    win.focus();
    win.maximize();
  });

  // Log any navigation failures
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`[SESSION] Load failed: ${errorDescription} (${errorCode}) url=${validatedURL}`);
    // Show anyway so user can see what's happening
    win.show();
    win.focus();
  });

  let cookieIndex = 0;
  function setNextCookie() {
    if (cookieIndex >= cookies.length) {
      // All cookies set — now navigate
      console.log(`[SESSION] All cookies set (${cookies.length}), navigating to ${targetUrl}`);
      win.loadURL(targetUrl).catch(err => {
        console.error('[SESSION] loadURL error:', err.message);
        win.show();
        win.focus();
      });
      return;
    }

    const c = cookies[cookieIndex];
    cookieIndex++;

    // Normalise domain — Electron rejects domains with leading dots in some versions
    let cookieDomain = (c.domain || c.host || domain || '').toLowerCase().replace(/^\.+/, '');
    if (!cookieDomain) cookieDomain = domain;

    const cookieDetails = {
      url: targetUrl,
      name: c.name,
      value: String(c.value || ''),
      domain: cookieDomain,
      path: c.path || '/',
      secure: !!c.secure,
      httpOnly: !!c.http_only,
    };

    if (c.expires && Number.isFinite(Number(c.expires)) && Number(c.expires) > 0) {
      cookieDetails.expirationDate = Number(c.expires);
    }

    cookieSession.cookies.set(cookieDetails)
      .then(() => setNextCookie())
      .catch(err => {
        console.error(`[SESSION] Failed to set cookie ${c.name}@${cookieDomain}: ${err.message}`);
        setNextCookie(); // continue anyway
      });
  }

  setNextCookie();
}

// ── App lifecycle ───────────────────────────────────────────────────────
app.whenReady().then(() => {
  server.listen(PORT, () => {
    console.log(`[CookieBrowser] Listening on http://localhost:${PORT}`);
  });

  // Create a hidden tray window so the app stays alive
  mainWindow = new BrowserWindow({
    width: 0,
    height: 0,
    show: false,
    webPreferences: { nodeIntegration: false },
  });
  mainWindow.loadURL('about:blank');
});

app.on('window-all-closed', () => {
  // Don't quit — keep listening for new sessions
});

app.on('before-quit', () => {
  server.close();
});
