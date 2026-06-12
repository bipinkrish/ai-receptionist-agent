import readline from "readline";
import dotenv from "dotenv";
import { chat, createHistory, getOpeningGreeting } from "./agent.js";

dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const history = createHistory();

console.log("Solstice Pilates Receptionist");
console.log('Type your message and press Enter. Type "exit" to quit.\n');
console.log(`Agent: ${getOpeningGreeting()}\n`);

function prompt() {
  rl.question("You: ", async (input) => {
    const trimmed = input.trim();
    if (!trimmed) {
      prompt();
      return;
    }
    if (trimmed.toLowerCase() === "exit") {
      try {
        const reply = await chat("exit", history, (status) => {
          console.log(`Agent: ${status}`);
        });
        console.log(`Agent: ${reply}\n`);
      } catch (err) {
        console.error("Error:", err instanceof Error ? err.message : err);
      }
      rl.close();
      return;
    }

    try {
      const reply = await chat(trimmed, history, (status) => {
        console.log(`Agent: ${status}`);
      });
      console.log(`Agent: ${reply}\n`);
    } catch (err) {
      console.error("Error:", err instanceof Error ? err.message : err);
    }

    prompt();
  });
}

prompt();
