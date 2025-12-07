export interface CodeModeOptions {
  timeout?: number;
  sandbox?: {
    allowConsole?: boolean;
    maxMemory?: number;
  };
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
