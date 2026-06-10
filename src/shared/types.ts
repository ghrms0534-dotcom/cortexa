export type ConversationSummary = {
  timestamp: string;
  user: string;
  assistant: string;
};

export type MemoItem = {
  id: string;
  createdAt: string;
  content: string;
  tags: string[];
};

export type TodoItem = {
  id: string;
  createdAt: string;
  title: string;
  dueDate?: string;
  done: boolean;
  notes?: string;
};

export type ApprovalPayload = {
  approvalRequired: true;
  reason: string;
  originalArgs: Record<string, unknown>;
};

export type ToolJsonResult =
  | {
      ok: true;
      message: string;
      data?: unknown;
    }
  | {
      ok: false;
      message: string;
      data?: unknown;
      approval?: ApprovalPayload;
    };
