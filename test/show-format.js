const {
  generateTypeDefinition,
  generateFunctionTypeDeclaration
} = require('../dist/codegen.js');

console.log('=== Example 1: getUserLocation (no params) ===\n');
console.log(generateFunctionTypeDeclaration(
  'getUserLocation',
  'Get user current location',
  [],
  'string'
));

console.log('\n=== Example 2: getWeather (with params and object return) ===\n');

const weatherResultType = generateTypeDefinition('GetWeatherResult', [
  { name: 'location', type: 'string', description: 'The location of the weather report' },
  { name: 'temperature', type: 'number', description: 'The current temperature in Fahrenheit' },
  { name: 'condition', type: 'string', description: 'The current weather conditions' }
]);

console.log(weatherResultType);
console.log();

const weatherFunction = generateFunctionTypeDeclaration(
  'getWeather',
  'Get weather for a location',
  [{ name: 'location', type: 'string', description: 'Location to get weather for', optional: false }],
  'GetWeatherResult'
);

console.log(weatherFunction);
