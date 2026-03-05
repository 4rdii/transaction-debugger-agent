#!/usr/bin/env node

/**
 * MCP server for the AI Transaction Debugger.
 * Exposes the debugging pipeline as tools callable by Claude CLI.
 * Transport: stdio
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env from backend/.env then monorepo root (same as backend config.ts)
dotenv.config({ path: resolve(__dirname, '../../backend/.env') });
dotenv.config({ path: resolve(__dirname, '../../../.env') });

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.js';

const server = new McpServer({
  name: 'tx-debugger',
  version: '0.1.0',
});

registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
