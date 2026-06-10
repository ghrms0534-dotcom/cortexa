import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { addTodo, completeTodo, listTodos } from "../shared/memory-store.js";

const server = new McpServer({
  name: "todo-server",
  version: "1.0.0"
});

server.registerTool(
  "add_todo",
  {
    description: "Add a todo item for the user.",
    inputSchema: {
      title: z.string().min(1),
      dueDate: z.string().optional(),
      notes: z.string().optional()
    }
  },
  async ({ title, dueDate, notes }) => {
    const item = await addTodo(title, dueDate, notes);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: true,
            message: `Added todo ${item.id}.`,
            data: item
          })
        }
      ]
    };
  }
);

server.registerTool(
  "list_todos",
  {
    description: "List todo items. Use filter=today for today's tasks.",
    inputSchema: {
      filter: z.enum(["all", "today", "open"]).optional()
    }
  },
  async ({ filter }) => {
    const items = await listTodos(filter ?? "all");
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: true,
            message: `Found ${items.length} todos.`,
            data: items
          })
        }
      ]
    };
  }
);

server.registerTool(
  "complete_todo",
  {
    description: "Mark a todo item as completed by id.",
    inputSchema: {
      id: z.string().min(1)
    }
  },
  async ({ id }) => {
    const item = await completeTodo(id);
    if (!item) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: false,
              message: `Todo not found: ${id}`
            })
          }
        ]
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: true,
            message: `Completed todo ${id}.`,
            data: item
          })
        }
      ]
    };
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("todo server failed:", error);
  process.exit(1);
});
