import type { TenderlySimulateResponse } from '@debugger/shared';
import { config } from '../config.js';
import type { RawTxParams } from './ethers.service.js';

const BASE_URL = 'https://api.tenderly.co/api/v1';

async function callSimulate(
  body: Record<string, unknown>
): Promise<TenderlySimulateResponse> {
  const { accountSlug, projectSlug, accessKey } = config.tenderly;
  const url = `${BASE_URL}/account/${accountSlug}/project/${projectSlug}/simulate`;

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

export async function simulateTransaction(
  params: RawTxParams,
  networkId: string
): Promise<TenderlySimulateResponse> {
  return callSimulate({
    network_id: networkId,
    block_number: params.blockNumber - 1,
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
  });
}

/** Re-simulate with Tenderly state_objects overrides (storage slots, ETH balances). */
export async function simulateWithOverrides(
  params: RawTxParams,
  networkId: string,
  gasOverride: number | null,
  stateObjects: Record<string, unknown>
): Promise<TenderlySimulateResponse> {
  return callSimulate({
    network_id: networkId,
    block_number: params.blockNumber - 1,
    from: params.from,
    to: params.to,
    input: params.input,
    gas: gasOverride ?? params.gas,
    gas_price: params.gasPrice,
    value: params.value,
    save: false,
    save_if_fails: false,
    simulation_type: 'full',
    generate_access_list: false,
    ...(Object.keys(stateObjects).length > 0 ? { state_objects: stateObjects } : {}),
  });
}
