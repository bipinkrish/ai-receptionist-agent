import dotenv from "dotenv";
import { ensureContactsHeader, findContact, logContact } from "../src/tools/sheets.js";

dotenv.config();

async function main() {
  await ensureContactsHeader();
  console.log("Contacts header ensured.\n");

  const testPhone = "555-TEST-01";
  const logged = await logContact({
    name: "Test User",
    phone: testPhone,
    date: new Date().toISOString().slice(0, 10),
    topic: "test",
    outcome: "info provided",
    notes: "Automated test row",
  });
  console.log(logged);

  const found = await findContact(testPhone);
  console.log("\nLookup result:", found);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
