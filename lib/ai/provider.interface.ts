export interface AIFileProposal {
  filename: string;
  code: string;
}

export interface AIPromptContext {
  projectTitle: string;
  projectDescription: string;
  pageContext: string;
  currentFiles: { [filename: string]: string };
  systemInstruction: string;
  chatHistoryText: string;
  attachmentsText: string;
  designSystemText?: string;
  apiKey?: string;
}

// --- TOOL DEFINITIONS (sent TO the AI provider) ---

export interface ToolParameterProperty {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  enum?: string[];
  items?: { type: string };
  properties?: Record<string, ToolParameterProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, ToolParameterProperty>;
    required: string[];
  };
}

// --- TOOL CALL (returned FROM the AI provider) ---

export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // JSON-encoded arguments string
}

export interface AIProviderResponse {
  updatedFiles: AIFileProposal[];
  explanation: string;
  interactiveCard?: {
    type: 'design-system' | 'file-action' | 'survey' | 'promotion';
    title: string;
    description: string;
    actions: {
      label: string;
      value: string;
      primary?: boolean;
    }[];
  };
  toolCalls?: ToolCall[];
  finishReason?: 'stop' | 'tool_calls' | 'length';
}

export interface AIProvider {
  generateCompletion(
    userPrompt: string,
    context: AIPromptContext
  ): Promise<AIProviderResponse>;
}

/** Extended interface for providers that support native function-calling / tool-use */
export interface ToolEnabledAIProvider extends AIProvider {
  generateCompletionWithTools(
    userPrompt: string,
    context: AIPromptContext,
    tools: ToolDefinition[],
    onToolCallStatus?: (status: string) => void
  ): Promise<AIProviderResponse>;
}
