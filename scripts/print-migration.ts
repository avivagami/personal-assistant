import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const dir = join(process.cwd(), "supabase", "migrations");
for (const f of readdirSync(dir).sort()) {
  console.log(`-- ${f}`);
  console.log(readFileSync(join(dir, f), "utf8"));
}
