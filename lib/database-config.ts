export function databaseConfig() {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
  if (!url) throw new Error("Set TURSO_DATABASE_URL in .env.");
  if (!url.startsWith("file:") && !authToken) throw new Error("Set TURSO_AUTH_TOKEN in .env.");
  return { url, authToken };
}
