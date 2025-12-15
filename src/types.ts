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

export interface ToolDefinition {
  description: string;
  inputSchema: any;
  parameters?: any;
  outputSchema?: any;
  execute: (...args: any[]) => Promise<any> | any;
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
