import { writeFileSync } from "node:fs";
import { loadDatabaseUrl } from "../src/config.js";
import { openDatabase } from "../src/db/client.js";
import { tasksToCsv } from "../src/tasks/csv.js";

const database = await openDatabase(loadDatabaseUrl(process.env));
try {
  const csv = tasksToCsv(await database.store.listTasks());
  const target = process.argv[2];
  if (target) writeFileSync(target, csv);
  else process.stdout.write(csv);
} finally {
  await database.close();
}
