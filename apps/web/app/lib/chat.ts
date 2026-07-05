export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  timestamp?: string;
  toolsUsed?: string[];
};

export const MAX_MODEL_MESSAGES = 20;
export const MAX_SAVED_CHAT_MESSAGES = 100;

export function normalizeChatMessages(messages: unknown): ChatMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter(
      (
        message
      ): message is {
        role: ChatRole;
        content: string;
        timestamp?: string;
        toolsUsed?: string[];
      } =>
        !!message &&
        typeof message === "object" &&
        ((message as { role?: unknown }).role === "user" ||
          (message as { role?: unknown }).role === "assistant") &&
        typeof (message as { content?: unknown }).content === "string"
    )
    .map((message) => ({
      role: message.role,
      content: message.content,
      timestamp:
        typeof message.timestamp === "string" ? message.timestamp : undefined,
      toolsUsed: Array.isArray(message.toolsUsed)
        ? message.toolsUsed.filter((tool): tool is string => typeof tool === "string")
        : undefined,
    }));
}

export function trimChatMessages(messages: ChatMessage[], max: number) {
  return messages.slice(-max);
}

export function toModelMessages(messages: ChatMessage[]) {
  return trimChatMessages(messages, MAX_MODEL_MESSAGES).map((message) => ({
    role: message.role,
    content: message.content,
  }));
}
