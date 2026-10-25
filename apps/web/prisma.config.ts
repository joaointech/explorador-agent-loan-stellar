import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Prisma 7 doesn't load env files itself; the app keeps its env in .env.local.
config({ path: ".env.local", quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // Fallback = docker compose Postgres, so `prisma generate` works without env.
    url: process.env.DATABASE_URL ?? "postgresql://advance:advance@localhost:5433/advance",
  },
});
