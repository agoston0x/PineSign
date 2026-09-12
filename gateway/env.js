/**
 * Loads .env before anything else reads process.env.
 *
 * Import statements are hoisted and evaluated in order, so this has to be its
 * own module imported first — calling loadEnvFile() inside server.js would run
 * after every other module had already captured its configuration.
 */

try {
  process.loadEnvFile()
} catch {
  // No .env is fine — the gateway runs unconfigured until setup.
}
