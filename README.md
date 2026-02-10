# tool-scripting

Plug-n-play "code mode" tool call scripting for Vercel AI SDK

[![npm version](https://badge.fury.io/js/code-mode.svg)](https://badge.fury.io/js/tool-scripting)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Inspired by [Cloudflare's Code Mode](https://blog.cloudflare.com/code-mode/)** - LLMs are better at writing JavaScript than using synthetic tool calling syntax.

## Installation

```bash
npm install tool-scripting ai@5 zod@4
```

**Note:** Requires Zod v4

## Usage

```javascript
import { z } from 'zod';
import { generateText, tool, stepCountIs } from 'ai';
import { openai } = from '@ai-sdk/openai';
import { toolScripting } from 'tool-scripting';

const tools = {
  getUserLocation: tool({
    description: 'Get user current location',
    inputSchema: z.object({}),
    outputSchema: z.string(), // optional outputSchema to help the LLM compose tool calls
    execute: async () => 'San Francisco, CA',
  }),
  getWeather: tool({
    description: 'Get weather for a location',
    inputSchema: z.object({
      location: z.string(),
    }),
    outputSchema: z.object({ // optional outputSchema to help the LLM compose tool calls
      temperature: z.number(),
      condition: z.string(),
    }),
    execute: async ({ location }) => {
      return { location, temperature: 65, condition: 'foggy' };
    },
  }),
};

// Just wrap your existing streamText (or generateText)
const betterGenerateText = toolScripting(streamText, {
  // Optional: customize the sandbox
  timeout: 30000, // Script execution timeout (default: 30000ms)
  sandbox: {
    allowConsole: true, // Allow console.log in scripts (default: true)
    maxMemory: 128 * 1024 * 1024 // Memory limit (default: 128MB)
  }
});

// Same familiar AI SDK usage
const result = await betterStreamText({
  model: openai('gpt-5'),
  tools,
  system: 'You are a helpful weather assistant.', // Your custom system prompt
  messages: [
    { role: 'assistant', content: 'How can I help?' },
    { role: 'user', content: 'Check the weather near me' },
  ],
  stopWhen: stepCountIs(5),
});
```

## How it works

1. **Converts** your tool definitions to a tool call SDK
2. **LLM Generates** JavaScript code instead of tool calls
3. **Executes** code in secure sandbox (v8 isolate) with tool bindings
4. **Returns** whatever the generated code returns

## Why Code Mode?

**Tool Scripting > Tool Calls**

- 🧠 **Better** - LLMs excel at JavaScript vs synthetic tool syntax
- 🔧 **Composable** - Logic and conditionals between tool calls
- 🔒 **Secure** - Sandboxed execution with controlled bindings
- 🎯 **Simple** - Just wrap your existing Vercel AI SDK calls
- 📦 **Efficient** - Extract only the data you need from large responses

## Configuration

### CodeModeOptions

Options passed to `toolScripting()` when creating the wrapper:

```typescript
const wrappedFunction = toolScripting(generateText, {
  // Sandbox configuration
  timeout: 30000, // Script execution timeout in ms (default: 30000)
  sandbox: {
    allowConsole: true, // Allow console.log in scripts (default: true)
    maxMemory: 128 * 1024 * 1024 // Memory limit in bytes (default: 128MB)
  },

  // Debug options
  logEnhancedSystemPrompt: false, // Log the full system prompt to console (default: false)

  // Append extra instructions to the default prompt:
  customToolSdkPrompt: (tools, defaultPrompt) =>
    `${defaultPrompt}\n\nAlways return dates in ISO format.`,

  // Or replace the default prompt entirely:
  // customToolSdkPrompt: (toolDescriptions) => `My custom prompt\n\n${toolDescriptions}`,

  // Callbacks
  onCodeGenerated: (code) => console.log('Generated:', code),
  onCodeExecuted: (result) => console.log('Result:', result),
  onError: (error) => console.error('Error:', error)
});
```

### ToolScriptingConfig

Options passed to the wrapped function when calling it:

```typescript
const result = await wrappedFunction({
  model: openai('gpt-4'),
  tools: yourTools,
  system: 'Your custom system prompt', // Combined with Tool SDK prompt

  // Optional callbacks for script execution
  scriptMetadataCallback: ({ description, script }) => {
    console.log('Executing:', description);
  },
  scriptResultCallback: (result) => {
    console.log('Script result:', result);
  },

  // All other AI SDK options...
  messages: [...],
});
```

### includeExecutionTrace

The `runToolScript` tool accepts an optional `includeExecutionTrace` parameter:

```yaml
toolName: runToolScript
args:
  description: Get weather data
  script: |
    const location = await getUserLocation();
    const weather = await getWeather({ location });
    return weather.temperature;
  includeExecutionTrace: true  # Only set when debugging
```

**When false (default):**
- LLM receives only: `Final result: 65`
- Efficient - doesn't include large intermediate results
- Best for extracting small data from large responses

**When true (debugging):**
- LLM receives full trace:
  ```
  Execution trace:
    getUserLocation([]) → "San Francisco, CA"
    getWeather([{"location":"San Francisco, CA"}]) → {"location":"San Francisco, CA","temperature":65,"condition":"foggy"}

  Final result: 65
  ```
- Useful for debugging script issues
- Increases token usage

**Note:** Execution traces are always logged to console for developer debugging, regardless of this setting.

## Example

Here's what a traditional series of tool calls looks like (without Tool Scripting):

```
role: user
text: Check the weather near me
--
role: assistant
type: tool-call
toolName: getUserLocation
--
role: tool
type: tool-result
output: San Francisco, CA
--
role: assistant
type: tool-call
toolName: getWeather
input:
  location: San Francisco, CA
--
role: tool
type: tool-result
output:
  temperature: 65
  condition: foggy
--
role: assistant
text: The weather in San Francisco, CA today is foggy with a temperature of 65°F.
```

Now, here's the same process with Tool Scripting:

```
role: user
text: Check the weather near me
--
role: assistant
type: tool-call
toolName: runToolScript
input:
  script: const location = await getUserLocation();\nconst weather = await getWeather({ location });\nreturn { location, weather };
--
role: tool
type: tool-result
output:
  location: San Francisco, CA
  weather:
    temperature: 65
    condition: foggy
--
role: assistant
text: The weather in San Francisco, CA today is foggy with a temperature of 65°F.
```

💥 In a single LLM step, we composed two tools to get the user's location and then the weather for that location.

## TypeScript Tool Definitions

Tool descriptions are automatically converted to TypeScript type declarations that the LLM can read:

```typescript
// Tool with no parameters
// Get user current location
getUserLocation: () => Promise<string>;

// Tool with parameters and object return type
type GetWeatherResult = {
  /** The location of the weather report */
  location: string;
  /** The current temperature in Fahrenheit */
  temperature: number;
  /** The current weather conditions */
  condition: string;
};

// Get weather for a location
getWeather: ({
  // Location to get weather for
  location: string
}) => Promise<GetWeatherResult>;
```

**Features:**
- Multiline descriptions are preserved with `//` comments
- Parameter descriptions appear as inline comments
- Object return types get named type definitions
- Optional parameters are marked with `?`
- Tools without `outputSchema` return `Promise<unknown>`

## Requirements

- Node.js 18+
- Vercel AI SDK (`ai` package) v5+
- Zod v4+ (for built-in JSON Schema conversion)
- Tools using `tool()` helper with `execute` functions

Works with both TypeScript and JavaScript.

## License

MIT