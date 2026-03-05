import { describe, it, expect } from 'vitest';
import { mapChainToNetworkId } from '../services/rango.service.js';

describe('rango.service', () => {
  describe('mapChainToNetworkId', () => {
    it('maps ETH to chainId 1', () => {
      expect(mapChainToNetworkId('ETH')).toBe('1');
    });

    it('maps BSC to chainId 56', () => {
      expect(mapChainToNetworkId('BSC')).toBe('56');
    });

    it('maps POLYGON to chainId 137', () => {
      expect(mapChainToNetworkId('POLYGON')).toBe('137');
    });

    it('maps ARBITRUM to chainId 42161', () => {
      expect(mapChainToNetworkId('ARBITRUM')).toBe('42161');
    });

    it('maps SOLANA to solana-mainnet', () => {
      expect(mapChainToNetworkId('SOLANA')).toBe('solana-mainnet');
    });

    it('maps BASE to chainId 8453', () => {
      expect(mapChainToNetworkId('BASE')).toBe('8453');
    });

    it('maps OPTIMISM to chainId 10', () => {
      expect(mapChainToNetworkId('OPTIMISM')).toBe('10');
    });

    it('is case-insensitive', () => {
      expect(mapChainToNetworkId('eth')).toBe('1');
      expect(mapChainToNetworkId('Polygon')).toBe('137');
    });

    it('returns null for unsupported chains', () => {
      expect(mapChainToNetworkId('BTC')).toBeNull();
      expect(mapChainToNetworkId('COSMOS')).toBeNull();
      expect(mapChainToNetworkId('TRON')).toBeNull();
      expect(mapChainToNetworkId('UNKNOWN')).toBeNull();
    });

    it('maps AVAX_CCHAIN to chainId 43114', () => {
      expect(mapChainToNetworkId('AVAX_CCHAIN')).toBe('43114');
    });

    it('maps CELO to chainId 42220', () => {
      expect(mapChainToNetworkId('CELO')).toBe('42220');
    });

    it('maps ZKSYNC to chainId 324', () => {
      expect(mapChainToNetworkId('ZKSYNC')).toBe('324');
    });
  });
});
