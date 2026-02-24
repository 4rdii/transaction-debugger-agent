import { lookupSelector } from '../registry/selectors.js';

export interface ProtocolInfo {
  protocol: string;
  action: string;
}

export function identifyProtocol(functionSelector?: string): ProtocolInfo | undefined {
  if (!functionSelector) return undefined;
  const info = lookupSelector(functionSelector);
  if (!info) return undefined;
  return { protocol: info.protocol, action: info.action };
}
