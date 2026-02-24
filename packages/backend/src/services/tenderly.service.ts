import type { TenderlySimulateResponse } from '@debugger/shared';
import { config } from '../config.js';
import type { RawTxParams } from './ethers.service.js';

const BASE_URL = 'https://api.tenderly.co/api/v1';

export async function simulateTransaction(
  params: RawTxParams,
  networkId: string
): Promise<TenderlySimulateResponse> {
  const { accountSlug, projectSlug, accessKey } = config.tenderly;
  const url = `${BASE_URL}/account/${accountSlug}/project/${projectSlug}/simulate`;

  const body = {
    network_id: networkId,
    block_number: params.blockNumber - 1, // simulate at the block before inclusion
    from: params.from,
    to: params.to,
    input: params.input,
    gas: params.gas,
    gas_price: params.gasPrice,
    value: params.value,
    save: true,
    save_if_fails: true,
    simulation_type: 'full',
    generate_access_list: false,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Access-Key': accessKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Tenderly API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as TenderlySimulateResponse;

  if (data.error) {
    throw new Error(`Tenderly error: ${data.error.message} (${data.error.slug})`);
  }

  return data;
}
