// Picks a storage backend: Upstash Redis when its env vars are set (needed on
// serverless hosts like Vercel, where filesystem writes don't persist),
// otherwise a local JSON file for normal hosts and local dev. Both backends
// expose the same async API.
module.exports = process.env.UPSTASH_REDIS_REST_URL ? require('./store.kv') : require('./store.file');
