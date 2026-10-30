// Best-effort IP -> approximate location lookup using a free public API.
// Used as a fallback/supplement when precise GPS isn't available or hasn't
// arrived yet. Never throws - returns null on any failure so a scan is never
// blocked on this.
async function lookupIpLocation(ip) {
  if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return null; // local/private IPs can't be geolocated
  }
  try {
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error) return null;
    return {
      city: data.city || null,
      region: data.region || null,
      country: data.country_name || null,
      lat: data.latitude ?? null,
      lon: data.longitude ?? null,
    };
  } catch {
    return null;
  }
}

module.exports = { lookupIpLocation };
