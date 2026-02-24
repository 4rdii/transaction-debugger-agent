import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from packages/backend/ first, then fall back to monorepo root
dotenv.config({ path: resolve(__dirname, '../../.env') });
dotenv.config({ path: resolve(__dirname, '../../../.env') });

function require_env(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

export const config = {
  tenderly: {
    accessKey: require_env('TENDERLY_ACCESS_KEY'),
    accountSlug: require_env('TENDERLY_ACCOUNT_SLUG'),
    projectSlug: require_env('TENDERLY_PROJECT_SLUG'),
  },
  openrouter: {
    apiKey: require_env('OPEN_ROUTER_API_KEY'),
    baseURL: 'https://openrouter.ai/api/v1',
    model: process.env['LLM_MODEL'] ?? 'openai/gpt-4o',
  },
  port: parseInt(process.env['PORT'] ?? '3001', 10),
  rpcUrls: {
    '1':     process.env['RPC_URL_1']     ?? 'https://eth.llamarpc.com',
    '137':   process.env['RPC_URL_137']   ?? 'https://polygon.llamarpc.com',
    '42161': process.env['RPC_URL_42161'] ?? 'https://arbitrum.llamarpc.com',
    '10':    process.env['RPC_URL_10']    ?? 'https://optimism.llamarpc.com',
    '8453':  process.env['RPC_URL_8453']  ?? 'https://base.llamarpc.com',
  } as Record<string, string>,
};

export function getRpcUrl(networkId: string): string {
  const url = config.rpcUrls[networkId];
  if (!url) throw new Error(`No RPC URL configured for network ${networkId}`);
  return url;
}
