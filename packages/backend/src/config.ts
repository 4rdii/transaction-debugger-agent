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

const alchemyKey = process.env['ALCHEMY_API_KEY'];

/**
 * Resolve an RPC URL for a chain.
 * Priority: RPC_URL_<chainId> env override > Alchemy (if key + subdomain) > public fallback
 */
function rpc(chainId: string, alchemySubdomain: string | null, publicFallback: string): string {
  const override = process.env[`RPC_URL_${chainId}`];
  if (override) return override;
  if (alchemyKey && alchemySubdomain) return `https://${alchemySubdomain}.g.alchemy.com/v2/${alchemyKey}`;
  return publicFallback;
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
  etherscan: {
    apiKey: process.env['ETHERSCAN_API_KEY'] ?? '',
  },
  port: parseInt(process.env['PORT'] ?? '3001', 10),
  rpcUrls: {
    // ── Alchemy-supported chains ──────────────────────────────────────────────
    '1':      rpc('1',      'eth-mainnet',      'https://eth.llamarpc.com'),
    '137':    rpc('137',    'polygon-mainnet',  'https://polygon.llamarpc.com'),
    '42161':  rpc('42161',  'arb-mainnet',      'https://arbitrum.llamarpc.com'),
    '10':     rpc('10',     'opt-mainnet',      'https://optimism.llamarpc.com'),
    '8453':   rpc('8453',   'base-mainnet',     'https://base.llamarpc.com'),
    '59144':  rpc('59144',  'linea-mainnet',    'https://rpc.linea.build'),
    '43114':  rpc('43114',  'avax-mainnet',     'https://api.avax.network/ext/bc/C/rpc'),
    '324':    rpc('324',    'zksync-mainnet',   'https://mainnet.era.zksync.io'),
    '81457':  rpc('81457',  'blast-mainnet',    'https://rpc.blast.io'),
    '534352': rpc('534352', 'scroll-mainnet',   'https://rpc.scroll.io'),
    // ── No Alchemy support — public RPCs only ────────────────────────────────
    '56':     rpc('56',     null, 'https://bsc-dataseed.binance.org'),
    '250':    rpc('250',    null, 'https://rpc.ftm.tools'),
    '100':    rpc('100',    null, 'https://rpc.gnosischain.com'),
    '80094':  rpc('80094',  null, 'https://rpc.berachain.com'),
  } as Record<string, string>,
};

export function getRpcUrl(networkId: string): string {
  const url = config.rpcUrls[networkId];
  if (!url) throw new Error(`No RPC URL configured for network ${networkId}`);
  return url;
}
