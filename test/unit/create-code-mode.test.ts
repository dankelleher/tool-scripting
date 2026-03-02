import { describe, test } from 'node:test';
import assert from 'node:assert';
import { createCodeMode } from '../../dist/index.js';
import type { OnToolResultCallback } from '../../src/types';
import { tool } from 'ai';
import { z } from 'zod';

/**
 * Helper: create a simple tool set for testing.
 */
function createTestTools() {
  return {
    lookupForecast: tool({
      description: 'Look up forecast for a location',
      inputSchema: z.object({
        location: z.string().describe('Location to get forecast for'),
      }),
      outputSchema: z.object({
        temperature: z.number().describe('The current temperature in Fahrenheit'),
        condition: z.string().describe('The current weather conditions'),
      }),
      execute: async ({ location }: { location: string }) => ({
        temperature: 72,
        condition: 'sunny',
      }),
    }),
    lookupTime: tool({
      description: 'Look up current time for a location',
      inputSchema: z.object({
        location: z.string().describe('Location to get time for'),
      }),
      execute: async () => '3:45 PM',
    }),
  };
}

describe('createCodeMode factory', () => {
  test('returns an object with createTool and generateSystemPrompt', () => {
    const codeMode = createCodeMode();
    assert.strictEqual(typeof codeMode.createTool, 'function');
    assert.strictEqual(typeof codeMode.generateSystemPrompt, 'function');
  });

  test('createTool returns a tool set with runToolScript', () => {
    const codeMode = createCodeMode();
    const tools = codeMode.createTool(createTestTools());

    assert.ok('runToolScript' in tools, 'Should contain runToolScript');
    assert.strictEqual(Object.keys(tools).length, 1, 'Should only contain runToolScript');
    assert.strictEqual(typeof tools.runToolScript.execute, 'function');
    assert.ok(tools.runToolScript.description, 'runToolScript should have a description');
  });

  test('generateSystemPrompt returns TypeScript API descriptions', () => {
    const codeMode = createCodeMode();
    const prompt = codeMode.generateSystemPrompt(createTestTools());

    assert.ok(prompt.length > 0, 'Prompt should not be empty');
    assert.ok(prompt.includes('lookupForecast'), 'Prompt should mention getWeather');
    assert.ok(prompt.includes('lookupTime'), 'Prompt should mention getTime');
    assert.ok(prompt.includes('location'), 'Prompt should mention parameters');
  });

  test('generateSystemPrompt returns empty string for empty tools', () => {
    const codeMode = createCodeMode();
    const prompt = codeMode.generateSystemPrompt({});

    assert.strictEqual(prompt, '', 'Should return empty string for no tools');
  });

  test('runToolScript executes a script with tool bindings', async () => {
    const codeMode = createCodeMode();
    const tools = codeMode.createTool(createTestTools());

    const result = await tools.runToolScript.execute({
      description: 'Get weather in NYC',
      script: 'const w = await lookupForecast({ location: "NYC" }); return w;',
    });

    assert.ok(result, 'Should return a result');
    assert.ok(result.includes('72'), 'Result should contain temperature');
    assert.ok(result.includes('sunny'), 'Result should contain condition');
  });

  test('each createTool call produces independent bindings', async () => {
    const codeMode = createCodeMode();

    let callCount = 0;
    const toolsV1 = {
      counter: tool({
        description: 'Returns a counter value',
        inputSchema: z.object({}),
        execute: async () => {
          callCount++;
          return `v1-${callCount}`;
        },
      }),
    };

    const toolsV2 = {
      counter: tool({
        description: 'Returns a counter value',
        inputSchema: z.object({}),
        execute: async () => {
          callCount++;
          return `v2-${callCount}`;
        },
      }),
    };

    const runV1 = codeMode.createTool(toolsV1);
    const runV2 = codeMode.createTool(toolsV2);

    const result1 = await runV1.runToolScript.execute({
      description: 'Call counter',
      script: 'return await counter();',
    });
    assert.ok(result1.includes('v1-'), `v1 tool should be called, got: ${result1}`);

    const result2 = await runV2.runToolScript.execute({
      description: 'Call counter',
      script: 'return await counter();',
    });
    assert.ok(result2.includes('v2-'), `v2 tool should be called, got: ${result2}`);
  });

  test('createTool invokes scriptMetadataCallback', async () => {
    const codeMode = createCodeMode();
    let captured: { description: string; script: string } | undefined;

    const tools = codeMode.createTool(createTestTools(), {
      scriptMetadataCallback: (meta) => { captured = meta; },
    });

    await tools.runToolScript.execute({
      description: 'Test metadata',
      script: 'return "hello";',
    });

    assert.ok(captured, 'scriptMetadataCallback should have been called');
    assert.strictEqual(captured!.description, 'Test metadata');
    assert.strictEqual(captured!.script, 'return "hello";');
  });

  test('createTool invokes scriptResultCallback', async () => {
    const codeMode = createCodeMode();
    let capturedResult: unknown;

    const tools = codeMode.createTool(createTestTools(), {
      scriptResultCallback: (r) => { capturedResult = r; },
    });

    await tools.runToolScript.execute({
      description: 'Test result callback',
      script: 'return "hello world";',
    });

    assert.ok(capturedResult, 'scriptResultCallback should have been called');
    assert.ok(String(capturedResult).includes('hello world'), `Result should contain "hello world", got: ${capturedResult}`);
  });

  test('onToolResult circuit breaker works in factory mode', async () => {
    const onToolResult: OnToolResultCallback = (toolName, result) => {
      if (toolName === 'dangerousTool') {
        return { signal: 'abort', result: 'Operation blocked by circuit breaker' };
      }
      return { signal: 'continue', result };
    };

    const codeMode = createCodeMode({ onToolResult });

    const testTools = {
      dangerousTool: tool({
        description: 'A dangerous tool',
        inputSchema: z.object({}),
        execute: async () => 'dangerous result',
      }),
    };

    const tools = codeMode.createTool(testTools);

    const result = await tools.runToolScript.execute({
      description: 'Call dangerous tool',
      script: 'return await dangerousTool();',
    });

    assert.ok(result.includes('Operation blocked by circuit breaker'),
      `Circuit breaker should abort, got: ${result}`);
  });

  test('generateSystemPrompt reflects different tool sets', () => {
    const codeMode = createCodeMode();

    const prompt1 = codeMode.generateSystemPrompt(createTestTools());
    assert.ok(prompt1.includes('lookupForecast'));
    assert.ok(prompt1.includes('lookupTime'));

    const differentTools = {
      sendEmail: tool({
        description: 'Send an email',
        inputSchema: z.object({
          to: z.string().describe('Recipient email address'),
          subject: z.string().describe('Email subject'),
          body: z.string().describe('Email body'),
        }),
        execute: async () => 'sent',
      }),
    };

    const prompt2 = codeMode.generateSystemPrompt(differentTools);
    assert.ok(prompt2.includes('sendEmail'), 'Second prompt should mention sendEmail');
    assert.ok(!prompt2.includes('lookupForecast'), 'Second prompt should not mention lookupForecast');
  });

  test('sandbox options are respected', async () => {
    const codeMode = createCodeMode({
      sandbox: { allowConsole: false },
    });

    const tools = codeMode.createTool({
      noop: tool({
        description: 'No-op tool',
        inputSchema: z.object({}),
        execute: async () => 'ok',
      }),
    });

    // Script that uses console — should not throw even with console disabled
    // (console is replaced with no-ops)
    const result = await tools.runToolScript.execute({
      description: 'Console test',
      script: 'console.log("test"); return "done";',
    });

    assert.ok(result.includes('done'), `Should succeed with console disabled, got: ${result}`);
  });

  test('customToolSdkPrompt is respected in factory mode', () => {
    const codeMode = createCodeMode({
      customToolSdkPrompt: (toolDescriptions, defaultPrompt) =>
        `CUSTOM PREFIX\n\n${toolDescriptions}\n\nCUSTOM SUFFIX`,
    });

    const prompt = codeMode.generateSystemPrompt(createTestTools());
    assert.ok(prompt.includes('CUSTOM PREFIX'), 'Should include custom prefix');
    assert.ok(prompt.includes('CUSTOM SUFFIX'), 'Should include custom suffix');
    assert.ok(prompt.includes('lookupForecast'), 'Should still include tool descriptions');
  });
});

describe('createCodeMode simulates dynamic tool refresh', () => {
  test('new createTool call with different tools produces working tool set', async () => {
    const codeMode = createCodeMode();

    // Initial tools
    const initialTools = {
      greet: tool({
        description: 'Greet someone',
        inputSchema: z.object({ name: z.string() }),
        execute: async ({ name }: { name: string }) => `Hello, ${name}!`,
      }),
    };

    const run1 = codeMode.createTool(initialTools);
    const result1 = await run1.runToolScript.execute({
      description: 'Greet',
      script: 'return await greet({ name: "Alice" });',
    });
    assert.ok(result1.includes('Hello, Alice'), `Initial tool should work, got: ${result1}`);

    // Simulate refresh: create new tool set with an additional tool
    const refreshedTools = {
      greet: tool({
        description: 'Greet someone',
        inputSchema: z.object({ name: z.string() }),
        execute: async ({ name }: { name: string }) => `Hi, ${name}!`,
      }),
      farewell: tool({
        description: 'Say goodbye',
        inputSchema: z.object({ name: z.string() }),
        execute: async ({ name }: { name: string }) => `Goodbye, ${name}!`,
      }),
    };

    const run2 = codeMode.createTool(refreshedTools);

    // The refreshed tool set should use the new implementation
    const result2 = await run2.runToolScript.execute({
      description: 'Greet and farewell',
      script: [
        'const hi = await greet({ name: "Bob" });',
        'const bye = await farewell({ name: "Bob" });',
        'return hi + " " + bye;',
      ].join('\n'),
    });
    assert.ok(result2.includes('Hi, Bob'), `Refreshed greet should use new impl, got: ${result2}`);
    assert.ok(result2.includes('Goodbye, Bob'), `Should have access to new farewell tool, got: ${result2}`);
  });

  test('generateSystemPrompt updates after tool refresh', () => {
    const codeMode = createCodeMode();

    const initialPrompt = codeMode.generateSystemPrompt({
      toolA: tool({
        description: 'Tool A',
        inputSchema: z.object({}),
        execute: async () => 'a',
      }),
    });
    assert.ok(initialPrompt.includes('toolA'));
    assert.ok(!initialPrompt.includes('toolB'));

    const refreshedPrompt = codeMode.generateSystemPrompt({
      toolA: tool({
        description: 'Tool A',
        inputSchema: z.object({}),
        execute: async () => 'a',
      }),
      toolB: tool({
        description: 'Tool B',
        inputSchema: z.object({ x: z.number() }),
        execute: async () => 'b',
      }),
    });
    assert.ok(refreshedPrompt.includes('toolA'));
    assert.ok(refreshedPrompt.includes('toolB'));
  });
});
