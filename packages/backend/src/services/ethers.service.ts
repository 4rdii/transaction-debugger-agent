import { ethers } from 'ethers';
import { getRpcUrl } from '../config.js';

export interface RawTxParams {
  from: string;
  to: string;
  input: string;
  gas: number;
  gasPrice: string;
  value: number;
  blockNumber: number;
  nonce: number;
}

export async function fetchTxParams(txHash: string, networkId: string): Promise<RawTxParams> {
  const rpcUrl = getRpcUrl(networkId);
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const tx = await provider.getTransaction(txHash);
  if (!tx) throw new Error(`Transaction ${txHash} not found on network ${networkId}`);

  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) throw new Error(`Receipt for ${txHash} not found`);

  return {
    from: tx.from,
    to: tx.to ?? ethers.ZeroAddress,
    input: tx.data,
    gas: Number(tx.gasLimit),
    gasPrice: (tx.gasPrice ?? tx.maxFeePerGas ?? 0n).toString(),
    value: Number(tx.value),
    blockNumber: receipt.blockNumber,
    nonce: tx.nonce,
  };
}
