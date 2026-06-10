import path from "node:path";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import type { ConversationSummary, MemoItem, TodoItem } from "./types.js";
import { getAgentRoot } from "./workspace.js";

const memoryRoot = path.join(getAgentRoot(), "memory");

const files = {
  summaries: path.join(memoryRoot, "conversation-summaries.json"),
  memos: path.join(memoryRoot, "memos.json"),
  todos: path.join(memoryRoot, "todos.json")
};

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function appendConversationSummary(user: string, assistant: string): Promise<void> {
  const summaries = await readJsonFile<ConversationSummary[]>(files.summaries, []);
  summaries.push({
    timestamp: new Date().toISOString(),
    user,
    assistant
  });
  await writeJsonFile(files.summaries, summaries.slice(-50));
}

export async function listConversationSummaries(): Promise<ConversationSummary[]> {
  return readJsonFile<ConversationSummary[]>(files.summaries, []);
}

export async function saveMemo(content: string, tags: string[] = []): Promise<MemoItem> {
  const memos = await readJsonFile<MemoItem[]>(files.memos, []);
  const item: MemoItem = {
    id: createId("memo"),
    createdAt: new Date().toISOString(),
    content,
    tags
  };
  memos.push(item);
  await writeJsonFile(files.memos, memos);
  return item;
}

export async function listMemos(limit = 20): Promise<MemoItem[]> {
  const memos = await readJsonFile<MemoItem[]>(files.memos, []);
  return memos.slice(-limit).reverse();
}

export async function searchMemos(query: string): Promise<MemoItem[]> {
  const memos = await readJsonFile<MemoItem[]>(files.memos, []);
  const needle = query.toLowerCase();
  return memos.filter((memo) => {
    return memo.content.toLowerCase().includes(needle) || memo.tags.some((tag) => tag.toLowerCase().includes(needle));
  });
}

export async function addTodo(title: string, dueDate?: string, notes?: string): Promise<TodoItem> {
  const todos = await readJsonFile<TodoItem[]>(files.todos, []);
  const item: TodoItem = {
    id: createId("todo"),
    createdAt: new Date().toISOString(),
    title,
    dueDate,
    notes,
    done: false
  };
  todos.push(item);
  await writeJsonFile(files.todos, todos);
  return item;
}

export async function listTodos(filter: "all" | "today" | "open" = "all"): Promise<TodoItem[]> {
  const todos = await readJsonFile<TodoItem[]>(files.todos, []);
  const today = new Date().toISOString().slice(0, 10);

  if (filter === "today") {
    return todos.filter((todo) => !todo.done && todo.dueDate === today);
  }

  if (filter === "open") {
    return todos.filter((todo) => !todo.done);
  }

  return todos;
}

export async function completeTodo(id: string): Promise<TodoItem | null> {
  const todos = await readJsonFile<TodoItem[]>(files.todos, []);
  const item = todos.find((todo) => todo.id === id);

  if (!item) {
    return null;
  }

  item.done = true;
  await writeJsonFile(files.todos, todos);
  return item;
}
