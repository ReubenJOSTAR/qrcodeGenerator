// Storage backend for serverless hosts (Vercel) where the filesystem isn't
// persisted between requests. Talks directly to Upstash's free Redis REST API
// (no Vercel Marketplace/billing involved), keeping the same simple
// "whole list" read-modify-write model as store.file.js.
const { Redis } = require('@upstash/redis');

const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const CAMPAIGNS_KEY = 'qr-tracker:campaigns';
const SCANS_KEY = 'qr-tracker:scans';

async function listCampaigns() {
  return (await kv.get(CAMPAIGNS_KEY)) || [];
}

async function getCampaign(id) {
  const campaigns = await listCampaigns();
  return campaigns.find((c) => c.id === id) || null;
}

async function createCampaign(campaign) {
  const campaigns = await listCampaigns();
  campaigns.push(campaign);
  await kv.set(CAMPAIGNS_KEY, campaigns);
  return campaign;
}

async function listScans() {
  const scans = (await kv.get(SCANS_KEY)) || [];
  return scans.sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt));
}

async function getScan(id) {
  const scans = (await kv.get(SCANS_KEY)) || [];
  return scans.find((s) => s.id === id) || null;
}

async function createScan(scan) {
  const scans = (await kv.get(SCANS_KEY)) || [];
  scans.push(scan);
  await kv.set(SCANS_KEY, scans);
  return scan;
}

async function updateScan(id, patch) {
  const scans = (await kv.get(SCANS_KEY)) || [];
  const idx = scans.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  scans[idx] = { ...scans[idx], ...patch };
  await kv.set(SCANS_KEY, scans);
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
