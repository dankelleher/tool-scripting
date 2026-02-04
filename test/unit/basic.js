const { toolScripting } = require('../../dist/index.js');
const { streamText, generateText, tool } = require('ai');
const { MockLanguageModelV3, simulateReadableStream } = require('ai/test');
const { z } = require('zod');

// Tools defined like in README using ai.tool() and zod
const tools = {
  getUserLocation: tool({
    description: 'Get user current location',
    inputSchema: z.object({}),
    outputSchema: z.string().describe('The current location of the user'),
    execute: async () => 'San Francisco, CA',
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
    execute: async ({ location }) => ({
      location,
      temperature: 65,
      condition: 'foggy',
    }),
  }),
};

async function test() {
  console.log('🧪 Testing tool-script...\n');

  try {
    let callCount = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        callCount++;
        if (callCount === 1) {
          // First call: return tool script
          return {
            finishReason: 'stop',
            usage: { inputTokens: 10, outputTokens: 20 },
            content: [
              {
                type: 'tool-call',
                toolCallType: 'function',
                toolCallId: 'call_1',
                toolName: 'runToolScript',
                args: {
                  script: `const location = await getUserLocation();\nconst weather = await getWeather({ location });\nreturn { location, weather };`,
                  description: 'Get weather for user location'
                }
              }
            ],
            warnings: [],
          };
        } else {
          // Second call: return final text
          return {
            finishReason: 'stop',
            usage: { inputTokens: 10, outputTokens: 20 },
            content: [{ type: 'text', text: 'Done.' }],
            warnings: [],
          };
        }
      },
    });

    const result = await toolScripting(generateText)({
      model,
      tools,
      system: 'You are a helpful assistant.',
      messages: [
        { role: 'user', content: 'What is the weather near me?' }
      ],
      maxSteps: 5,
      onFinish: ({ text, toolCalls, responseMessages }) => {
        console.log('🧾 onFinish text:', text);
      }
    });

    // If streaming, accumulate text for visibility
    if (result && result.textStream && result.textStream[Symbol.asyncIterator]) {
      let accumulated = '';
      for await (const delta of result.textStream) {
        accumulated += typeof delta === 'string' ? delta : (delta.textDelta || '');
      }
      console.log('\n🧵 Streamed text:', accumulated);
    }
    console.log('\n🎉 Final result:', result.text);

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

test();
