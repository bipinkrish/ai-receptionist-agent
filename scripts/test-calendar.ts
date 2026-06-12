import dotenv from "dotenv";
import { checkAvailability } from "../src/tools/calendar.js";

dotenv.config();

async function main() {
  console.log("Checking 6pm Reformer on Thursday...\n");
  const result = await checkAvailability("Reformer", "Thursday", "6pm");
  console.log(JSON.stringify(result, null, 2));

  console.log("\nChecking 7pm Reformer on Thursday...\n");
  const open = await checkAvailability("Reformer", "Thursday", "7pm");
  console.log(JSON.stringify(open, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
