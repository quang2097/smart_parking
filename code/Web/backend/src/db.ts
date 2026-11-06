import "dotenv/config";
import pg from "pg";
if (!process.env.DATABASE_URL)
  throw new Error("Set DATABASE_URL in backend/.env");
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
});
pool.on("error", (error) => console.error("PostgreSQL error:", error.message));
