export interface CodeModeOptions {
  timeout?: number;
  sandbox?: {
    allowConsole?: boolean;
    maxMemory?: number;
  };
  logEnhancedSystemPrompt?: boolean;
  customToolSdkPrompt?: (toolDescriptions: string) => string;
  onCodeGenerated?: (code: string) => void;
  onCodeExecuted?: (result: any) => void;
  onError?: (error: Error) => void;
}

type ToolResult = {
    isError: boolean;
    content?: any[];
    structuredContent?: Record<string, any>;
}

export interface ToolDefinition {
  description?: string;
  inputSchema: any;
  outputSchema?: any;
  execute?: (...args: any[]) => Promise<ToolResult> | ToolResult;
}

export interface Tools {
  [key: string]: ToolDefinition;
}

export interface ToolScriptingConfig {
  tools?: Tools;
  system?: string;
  scriptMetadataCallback?: (metadata: { description: string; script: string }) => void;
  scriptResultCallback?: (result: any) => void;
  [key: string]: any; // Allow other properties to pass through to the AI function
}
