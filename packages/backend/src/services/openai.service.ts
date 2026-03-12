import OpenAI from 'openai';
import { config } from '../config.js';

let client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: config.openrouter.apiKey,
      baseURL: config.openrouter.baseURL,
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/explorai',
        'X-Title': 'Explorai',
      },
    });
  }
  return client;
}
