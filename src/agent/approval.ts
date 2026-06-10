import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function requestApproval(reason: string): Promise<boolean> {
  const rl = readline.createInterface({ input, output });

  try {
    const answer = await rl.question(`Approval required: ${reason}\nContinue? (y/N): `);
    return ["y", "yes"].includes(answer.trim().toLowerCase());
  } finally {
    rl.close();
  }
}
