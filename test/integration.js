require('dotenv').config();

const { toolScripting } = require('../dist/index.js');
const { generateText, tool, stepCountIs } = require('ai');
const { z } = require('zod');
const {anthropic} = require("@ai-sdk/anthropic");

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Missing ANTHROPIC_API_KEY in environment. Skipping integration test.');
    process.exit(1);
  }

  const tools = {
    getUserLocation: tool({
      description: 'Get user current location',
      inputSchema: z.object({}),
      outputSchema: z.string(),
      execute: async () => 'San Francisco, CA',
    }),
    getWeather: tool({
      description: 'Get weather for a location',
      inputSchema: z.object({
        location: z.string(),
      }),
      outputSchema: z.object({
        location: z.string(),
        temperature: z.number(),
        condition: z.string()
      }),
      execute: async ({ location }) => ({
        location,
        temperature: 65,
        condition: 'foggy',
      }),
    }),
  };

  console.log('🔌 Running integration test...');

    const codeModeOptions = {
        logEnhancedSystemPrompt: true
    };
    const result = await toolScripting(generateText, codeModeOptions)({
    model: anthropic('claude-sonnet-4-5-20250929'),
    tools,
    system: 'You are a helpful assistant.',
    messages: [
      { role: 'user', content: 'What is the weather like today?' },
    ],
    stopWhen: stepCountIs(5)
  });

  console.log('Response:', JSON.stringify(result.response, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Integration test failed:', err?.message || err);
    process.exit(1);
  });
}
