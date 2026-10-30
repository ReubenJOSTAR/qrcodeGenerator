const express = require('express');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const store = require('./lib/store');
const { lookupIpLocation } = require('./lib/geoip');

const app = express();
app.set('trust proxy', true); // so req.ip reflects the real visitor behind a host's proxy (Render, Railway, etc.)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
// Render sets RENDER_EXTERNAL_URL automatically on web services, so QR codes
// pick up the right public URL there without any manual config.
const BASE_URL = (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const REDIRECT_TARGET = 'https://pacifyco.in';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || null;

function requireDashboardAuth(req, res, next) {
  if (!DASHBOARD_PASSWORD) return next(); // no password configured -> open (fine for local use only)
  const auth = req.headers.authorization;
  if (auth) {
    const [, b64] = auth.split(' ');
    const [, pass] = Buffer.from(b64 || '', 'base64').toString().split(':');
    if (pass === DASHBOARD_PASSWORD) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="dashboard"');
  return res.status(401).send('Authentication required');
}

function slugify(text) {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'campaign'
  );
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function pageLayout(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 880px; margin: 40px auto; padding: 0 20px; line-height: 1.5; }
  h1 { font-size: 1.5rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.9rem; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #8884; vertical-align: top; }
  th { font-weight: 600; }
  input, button { font-size: 1rem; padding: 8px 10px; }
  input[type="text"] { width: 260px; }
  .campaign-card { border: 1px solid #8884; border-radius: 10px; padding: 16px; margin-bottom: 14px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
  .campaign-card img { width: 120px; height: 120px; }
  code { background: #8882; padding: 2px 6px; border-radius: 4px; }
  .muted { opacity: 0.7; font-size: 0.85rem; }
  a.button { display: inline-block; background: #2563eb; color: white; padding: 8px 14px; border-radius: 6px; text-decoration: none; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

// Home: create and list QR campaigns
app.get('/', (req, res) => {
  const campaigns = store.listCampaigns().reverse();
  const cards = campaigns
    .map((c) => {
      const scanUrl = `${BASE_URL}/r/${c.id}`;
      const qrUrl = `/qr/${c.id}.png`;
      return `<div class="campaign-card">
        <img src="${qrUrl}" alt="QR code for ${escapeHtml(c.label)}" />
        <div>
          <strong>${escapeHtml(c.label)}</strong><br/>
          <span class="muted">${escapeHtml(scanUrl)}</span><br/>
          <span class="muted">Created ${new Date(c.createdAt).toLocaleString()}</span>
        </div>
      </div>`;
    })
    .join('\n') || '<p class="muted">No QR codes yet. Create one below.</p>';

  res.send(
    pageLayout(
      'QR Location Tracker',
      `<h1>QR Location Tracker</h1>
      <p>Every QR code below redirects whoever scans it to <code>${REDIRECT_TARGET}</code>, and logs the scanner's location first (GPS if they allow it, approximate IP-based location always).</p>
      <form method="POST" action="/campaigns">
        <input type="text" name="label" placeholder="Label, e.g. Store entrance poster" required />
        <button type="submit">Create QR code</button>
      </form>
      <h2>Your QR codes</h2>
      ${cards}
      <p><a class="button" href="/dashboard">View scan dashboard &rarr;</a></p>`
    )
  );
});

app.post('/campaigns', (req, res) => {
  const label = (req.body.label || '').trim();
  if (!label) return res.redirect('/');
  let id = slugify(label);
  if (store.getCampaign(id)) id = `${id}-${Math.random().toString(36).slice(2, 6)}`;
  store.createCampaign({ id, label, createdAt: new Date().toISOString() });
  res.redirect('/');
});

// QR code image for a campaign
app.get('/qr/:id.png', async (req, res) => {
  const campaign = store.getCampaign(req.params.id);
  if (!campaign) return res.status(404).send('Not found');
  const scanUrl = `${BASE_URL}/r/${campaign.id}`;
  try {
    const png = await QRCode.toBuffer(scanUrl, { width: 300, margin: 2 });
    res.set('Content-Type', 'image/png');
    res.send(png);
  } catch (err) {
    res.status(500).send('Failed to generate QR code');
  }
});

// Scan entry point: log what we can immediately, then ask the browser for
// precise GPS before forwarding to pacifyco.in.
app.get('/r/:id', async (req, res) => {
  const campaign = store.getCampaign(req.params.id);
  if (!campaign) return res.status(404).send('Unknown QR code');

  const scanId = uuidv4();
  const ip = req.ip;
  const userAgent = req.get('user-agent') || null;

  store.createScan({
    id: scanId,
    campaignId: campaign.id,
    campaignLabel: campaign.label,
    scannedAt: new Date().toISOString(),
    ip,
    userAgent,
    ipLocation: null,
    gps: null,
  });

  // Don't block the redirect on this - fill it in best-effort.
  lookupIpLocation(ip).then((loc) => {
    if (loc) store.updateScan(scanId, { ipLocation: loc });
  });

  res.send(
    pageLayout(
      'Redirecting…',
      `<p>Redirecting you to pacifyco.in…</p>
      <script>
        const scanId = ${JSON.stringify(scanId)};
        function go() { window.location.replace(${JSON.stringify(REDIRECT_TARGET)}); }
        function sendGps(pos) {
          fetch('/api/scans/' + scanId + '/gps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              lat: pos.coords.latitude,
              lon: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            }),
            keepalive: true,
          }).finally(go);
        }
        if (navigator.geolocation) {
          const timer = setTimeout(go, 4000); // never make the visitor wait long
          navigator.geolocation.getCurrentPosition(
            (pos) => { clearTimeout(timer); sendGps(pos); },
            () => { clearTimeout(timer); go(); },
            { enableHighAccuracy: true, timeout: 3500 }
          );
        } else {
          go();
        }
      </script>`
    )
  );
});

app.post('/api/scans/:id/gps', (req, res) => {
  const { lat, lon, accuracy } = req.body || {};
  if (typeof lat !== 'number' || typeof lon !== 'number') return res.status(400).json({ ok: false });
  const updated = store.updateScan(req.params.id, { gps: { lat, lon, accuracy: accuracy ?? null } });
  res.json({ ok: !!updated });
});

app.get('/dashboard', requireDashboardAuth, (req, res) => {
  const scans = store.listScans();
  const rows = scans
    .map((s) => {
      const gps = s.gps ? `<a href="https://maps.google.com/?q=${s.gps.lat},${s.gps.lon}" target="_blank">${s.gps.lat.toFixed(5)}, ${s.gps.lon.toFixed(5)}</a> <span class="muted">(&plusmn;${Math.round(s.gps.accuracy || 0)}m)</span>` : '<span class="muted">not granted</span>';
      const ipLoc = s.ipLocation
        ? `${escapeHtml([s.ipLocation.city, s.ipLocation.region, s.ipLocation.country].filter(Boolean).join(', '))}${s.ipLocation.lat != null ? ` <a href="https://maps.google.com/?q=${s.ipLocation.lat},${s.ipLocation.lon}" target="_blank">(map)</a>` : ''}`
        : '<span class="muted">unknown</span>';
      return `<tr>
        <td>${new Date(s.scannedAt).toLocaleString()}</td>
        <td>${escapeHtml(s.campaignLabel)}</td>
        <td>${gps}</td>
        <td>${ipLoc}</td>
        <td>${escapeHtml(s.ip)}</td>
        <td class="muted">${escapeHtml(s.userAgent || '')}</td>
      </tr>`;
    })
    .join('\n');

  res.send(
    pageLayout(
      'Scan Dashboard',
      `<h1>Scan Dashboard</h1>
      <p class="muted">${scans.length} scan(s) recorded. Newest first.</p>
      <table>
        <thead><tr><th>Scanned at</th><th>Campaign</th><th>GPS location</th><th>IP location (approx)</th><th>IP</th><th>Device</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="muted">No scans yet.</td></tr>'}</tbody>
      </table>
      <p><a href="/">&larr; Back</a></p>`
    )
  );
});

app.listen(PORT, () => {
  console.log(`QR location tracker running at ${BASE_URL} (listening on port ${PORT})`);
  if (BASE_URL.includes('localhost')) {
    console.log('NOTE: QR codes encode this BASE_URL. A QR scanned from a phone needs a public BASE_URL (set the BASE_URL env var) to work outside this machine.');
  }
});
