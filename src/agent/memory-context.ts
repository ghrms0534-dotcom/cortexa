import { listConversationSummaries, listMemos, listTodos } from "../shared/memory-store.js";

export async function buildMemoryContext(): Promise<string> {
  const [summaries, memos, todos] = await Promise.all([
    listConversationSummaries(),
    listMemos(5),
    listTodos("open")
  ]);

  const summaryText =
    summaries.length === 0
      ? "No prior conversation summaries."
      : summaries
          .slice(-5)
          .map((item) => `- ${item.timestamp}: user="${item.user}" assistant="${item.assistant}"`)
          .join("\n");

  const memoText =
    memos.length === 0
      ? "No saved memos."
      : memos.map((item) => `- ${item.id}: ${item.content}`).join("\n");

  const todoText =
    todos.length === 0
      ? "No open todos."
      : todos.map((item) => `- ${item.id}: ${item.title}${item.dueDate ? ` (due ${item.dueDate})` : ""}`).join("\n");

  return `Conversation summaries:\n${summaryText}\n\nSaved memos:\n${memoText}\n\nOpen todos:\n${todoText}`;
}
