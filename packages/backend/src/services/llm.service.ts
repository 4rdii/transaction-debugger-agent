import { writeFile, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { AnalysisResult } from '@debugger/shared';
import { config } from '../config.js';
import { getOpenAI } from './openai.service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = resolve(__dirname, '../../../logs');

export async function answerQuestion(
  result: AnalysisResult | null | undefined,
  question: string
): Promise<string> {
  const openai = getOpenAI();

  const context = result
    ? `Transaction context:
- Hash: ${result.txHash}
- Status: ${result.success ? 'success' : 'failed'}
- Actions: ${result.semanticActions.map(a => a.description).join('; ')}
- Token flows: ${result.tokenFlows.map(f => `${f.formattedAmount} ${f.tokenSymbol} from ${f.from} to ${f.to}`).join('; ')}
- Risks: ${result.riskFlags.map(r => r.description).join('; ') || 'none'}
- Gas used: ${result.gasUsed}
- Block: ${result.blockNumber}
${result.failureReason ? `- Failure reason: ${result.failureReason.reason}` : ''}

Previous explanation:
${result.llmExplanation}`
    : 'No transaction context available.';

  const systemPrompt = result
    ? 'You are a DeFi transaction analyst. Answer questions about the transaction using only the provided context. Be concise and precise.'
    : 'You are a blockchain and DeFi expert. Answer questions about blockchain transactions, TON, Solana, EVM chains, DeFi protocols, and smart contracts. Be concise and precise.';
  const userPrompt = `${context}\n\nQuestion: ${question}`;

  const response = await openai.chat.completions.create({
    model: config.openrouter.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.2,
    max_tokens: 1024,
  });

  const answer = response.choices[0]?.message?.content ?? 'Unable to answer question.';

  // Log QA call
  try {
    await mkdir(LOGS_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const short = result?.txHash?.slice(0, 10) ?? 'no-tx';
    const content = [
      '='.repeat(80),
      `TX:        ${result?.txHash ?? 'N/A'}`,
      `TIMESTAMP: ${new Date().toISOString()}`,
      `TYPE:      QA`,
      '='.repeat(80),
      '',
      '--- SYSTEM PROMPT ---',
      systemPrompt,
      '',
      '--- USER PROMPT ---',
      userPrompt,
      '',
      '--- ANSWER ---',
      answer,
      '',
    ].join('\n');
    await writeFile(resolve(LOGS_DIR, `${ts}_${short}_qa.txt`), content, 'utf8');
  } catch (err) {
    console.warn('[llm] Failed to write QA log:', err);
  }

  return answer;
}
