// Picks a storage backend: Vercel KV when deployed there (filesystem writes
// don't persist on serverless), otherwise a local JSON file for normal hosts
// and local dev. Both backends expose the same async API.
module.exports = process.env.KV_REST_API_URL ? require('./store.kv') : require('./store.file');
