import { loadDatabaseUrl } from "../src/config.js";
import { openDatabase } from "../src/db/client.js";

const database = await openDatabase(loadDatabaseUrl(process.env));
await database.close();
console.log("migrations applied");
