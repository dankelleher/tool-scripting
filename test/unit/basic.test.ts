import assert from 'node:assert';
import { describe, test } from 'node:test';
import { generateText, tool } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';
import { toolScripting } from '../../dist/index.js';

/**
 * Creates a mock model that returns a tool script on first call
 * and final text on second call.
 */
function createMockModel(script: string) {
  let callCount = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      callCount++;
      if (callCount === 1) {
        return {
          finishReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 20 },
          content: [
            {
              type: 'tool-call',
              toolCallType: 'function',
              toolCallId: 'call_1',
              toolName: 'runToolScript',
              input: JSON.stringify({ script, description: 'Test script' }),
            },
          ],
          warnings: [],
        };
      }
      return {
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 20 },
        content: [{ type: 'text', text: 'Done.' }],
        warnings: [],
      };
    },
  });
}

const tools = {
  getUserLocation: tool({
    description: 'Get user current location',
    inputSchema: z.object({}),
    outputSchema: z.object({
      location: z.string().describe('The current location of the user'),
    }),
    // Simulate MCP client response: both content and structuredContent
    execute: async () => ({
      content: [{ type: 'text', text: 'San Francisco, CA' }],
      structuredContent: { location: 'San Francisco, CA' },
    }),
  }),
  getWeather: tool({
    description: 'Get weather for a location',
    inputSchema: z.object({
      location: z.string().describe('Location to get weather for'),
    }),
    outputSchema: z.object({
      location: z.string().describe('The location of the weather report'),
      temperature: z.number().describe('The current temperature in Fahrenheit'),
      condition: z.string().describe('The current weather conditions'),
    }),
    execute: async ({ location }: { location: string }) => ({
      location,
      temperature: 65,
      condition: 'foggy',
    }),
  }),
  getLocalTime: tool({
    description: 'Get local time for a location',
    inputSchema: z.object({
      location: z.string().describe('Location to get time for'),
    }),
    outputSchema: z.object({
      time: z.string().describe('The current local time'),
      timezone: z.string().describe('The timezone'),
    }),
    // Simulate MCP content-only response (no structuredContent) with JSON in text
    execute: async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            time: '3:45 PM',
            timezone: 'America/Los_Angeles',
          }),
        },
      ],
    }),
  }),
};

describe('basic tool scripting', () => {
  test('executes a multi-tool script and captures result', async () => {
    const script = [
      'const { location } = await getUserLocation();',
      'const weather = await getWeather({ location });',
      'const localTime = await getLocalTime({ location });',
      'return { location, weather, localTime };',
    ].join('\n');

    const model = createMockModel(script);

    let scriptResult: string | undefined;
    await toolScripting(generateText)({
      model,
      tools,
      system: 'You are a helpful assistant.',
      messages: [{ role: 'user', content: 'What is the weather near me?' }],
      maxSteps: 5,
      scriptResultCallback: (r: string) => {
        scriptResult = r;
      },
    });

    assert.ok(scriptResult, 'Script should have produced a result');
    assert.ok(
      scriptResult.includes('San Francisco'),
      'Result should contain location',
    );
  });

  test('script result contains data from all tools', async () => {
    const script = [
      'const { location } = await getUserLocation();',
      'const weather = await getWeather({ location });',
      'const localTime = await getLocalTime({ location });',
      'return { location, weather, localTime };',
    ].join('\n');

    const model = createMockModel(script);

    let scriptResult: string | undefined;
    await toolScripting(generateText)({
      model,
      tools,
      system: 'You are a helpful assistant.',
      messages: [{ role: 'user', content: 'What is the weather near me?' }],
      maxSteps: 5,
      scriptResultCallback: (r: string) => {
        scriptResult = r;
      },
    });

    assert.ok(scriptResult, 'scriptResultCallback should have been called');
    assert.ok(
      scriptResult.includes('San Francisco'),
      `Expected location in result, got: ${scriptResult}`,
    );
    assert.ok(
      scriptResult.includes('65'),
      `Expected temperature in result, got: ${scriptResult}`,
    );
    assert.ok(
      scriptResult.includes('foggy'),
      `Expected condition in result, got: ${scriptResult}`,
    );
    assert.ok(
      scriptResult.includes('3:45 PM'),
      `Expected time in result, got: ${scriptResult}`,
    );
  });

  test('onFinish callback is invoked', async () => {
    const script =
      'const { location } = await getUserLocation(); return location;';
    const model = createMockModel(script);

    let finishCalled = false;
    await toolScripting(generateText)({
      model,
      tools,
      system: 'You are a helpful assistant.',
      messages: [{ role: 'user', content: 'Where am I?' }],
      maxSteps: 5,
      onFinish: () => {
        finishCalled = true;
      },
    });

    assert.ok(finishCalled, 'onFinish should have been called');
  });
});
