const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CAMPAIGNS_FILE = path.join(DATA_DIR, 'campaigns.json');
const SCANS_FILE = path.join(DATA_DIR, 'scans.json');

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CAMPAIGNS_FILE)) fs.writeFileSync(CAMPAIGNS_FILE, '[]');
  if (!fs.existsSync(SCANS_FILE)) fs.writeFileSync(SCANS_FILE, '[]');
}

function readJson(file) {
  ensureDataFiles();
  const raw = fs.readFileSync(file, 'utf8').trim();
  return raw ? JSON.parse(raw) : [];
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function listCampaigns() {
  return readJson(CAMPAIGNS_FILE);
}

function getCampaign(id) {
  return listCampaigns().find((c) => c.id === id) || null;
}

function createCampaign(campaign) {
  const campaigns = listCampaigns();
  campaigns.push(campaign);
  writeJson(CAMPAIGNS_FILE, campaigns);
  return campaign;
}

function listScans() {
  return readJson(SCANS_FILE).sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt));
}

function getScan(id) {
  return readJson(SCANS_FILE).find((s) => s.id === id) || null;
}

function createScan(scan) {
  const scans = readJson(SCANS_FILE);
  scans.push(scan);
  writeJson(SCANS_FILE, scans);
  return scan;
}

function updateScan(id, patch) {
  const scans = readJson(SCANS_FILE);
  const idx = scans.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  scans[idx] = { ...scans[idx], ...patch };
  writeJson(SCANS_FILE, scans);
  return scans[idx];
}

module.exports = {
  listCampaigns,
  getCampaign,
  createCampaign,
  listScans,
  getScan,
  createScan,
  updateScan,
};
