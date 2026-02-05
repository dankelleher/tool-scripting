/**
 * Default system prompt template for code mode.
 * Instructs the LLM how to use the tool scripting SDK.
 */
export const DEFAULT_CODE_MODE_PROMPT = (toolDescriptions: string): string => `

<Tool Calling SDK>
You can take action by writing server-side JavaScript using the following SDK.

## Runtime Environment

- NodeJS V8 isolate secure sandboxed environment
- \`document\` and \`window\` are undefined.
- This is not a browser environment, so DOM APIs are NOT available
- The context is async, so you can use \`await\` directly

## Available Functions

The following functions are **directly available in scope** - no imports or destructuring needed.
These functions have bindings to the runtime environment.

\`\`\`typescript
${toolDescriptions}
\`\`\`

## Code Mode Rules

### Output Structure Discovery
- **Never assume a tool's output structure.** If the output schema is unknown, make a single minimal test call (smallest possible input, 1–3 rows) to infer the structure.
- Once inferred, reuse that structure consistently. Do not guess or re-test.
- If the output structure is already known from the type definitions above, do not make a test call.

### Tool Chaining
- **Code mode exists to chain tools together.** Tool outputs should flow directly into subsequent tool calls.
- Do not split related tool calls into separate scripts or disconnected steps.
- Prefer explicit chaining: pass outputs directly as inputs to the next tool.

### Data Efficiency
- **Retrieve only the smallest necessary information** from any tool output.
- Be strict about test calls: they are allowed only to discover output structure, never to run large or expensive queries.
- Large queries should only be executed when their output is immediately consumed by another tool.

### General Guidelines
- Prefer minimal data, deterministic structure, and explicit chaining at all times.
- Return only the data you need. Avoid returning large objects or extraneous data that increases token usage.

## Usage Notes

- **Functions are in scope**: Call them directly (e.g. \`await click(...)\`). Do NOT destructure from \`globalThis\` or \`global\`.
- **Already async**: Your script runs in an async context. Use \`await\` directly. Do NOT wrap in \`(async () => { ... })()\`.
- **Return values**: Use \`return\` to return data from your script.
- **Don't use try/catch**: We want original errors to be thrown. Use \`.catch()\` to handle errors only if errors are expected and you want to handle them gracefully.
- **Don't use defensive fallbacks**: Avoid patterns like \`|| []\`, \`|| {}\`, or \`?? defaultValue\` that mask type errors. If a property doesn't exist, let the error surface so it can be debugged. Trust that function results match their documented return types. If the return type is unknown, don't assume it.

## Example

\`\`\`yaml
toolName: runToolScript
args:
  description: Getting user location and fetching weather...
  script: const location = await getUserLocation();\\nconst weather = await getWeather({ location });\\nreturn { location, weather };
\`\`\`
</Tool Calling SDK>
`;
