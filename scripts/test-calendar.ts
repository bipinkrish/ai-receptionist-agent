import dotenv from "dotenv";
import { listAvailableSlots, checkSlot, getStudioBusinessHours } from "../src/tools/calendar.js";

dotenv.config();

async function main() {
  console.log("Business hours:\n", JSON.stringify(await getStudioBusinessHours(), null, 2));

  console.log("\nOpen slots on Thursday:\n");
  console.log(JSON.stringify(await listAvailableSlots("Thursday"), null, 2));

  console.log("\nCheck 6pm Thursday:\n");
  console.log(JSON.stringify(await checkSlot("Thursday", "6pm"), null, 2));

  console.log("\nCheck 7pm Thursday:\n");
  console.log(JSON.stringify(await checkSlot("Thursday", "7pm"), null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
