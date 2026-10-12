import { defineConfig } from "drizzle-kit";
import path from "node:path";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: path.resolve(process.cwd(), "data", "xgolda.db"),
  },
});
