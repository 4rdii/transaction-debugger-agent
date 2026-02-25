import OpenAI from 'openai';
import { writeFile, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { AnalysisResult } from '@debugger/shared';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = resolve(__dirname, '../../../logs');

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: config.openrouter.apiKey,
      baseURL: config.openrouter.baseURL,
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/ai-tx-debugger',
        'X-Title': 'AI Transaction Debugger',
      },
    });
  }
  return openaiClient;
}

export async function answerQuestion(
  result: AnalysisResult,
  question: string
): Promise<string> {
  const openai = getOpenAI();

  const context = `Transaction context:
- Hash: ${result.txHash}
- Status: ${result.success ? 'success' : 'failed'}
- Actions: ${result.semanticActions.map(a => a.description).join('; ')}
- Token flows: ${result.tokenFlows.map(f => `${f.formattedAmount} ${f.tokenSymbol} from ${f.from} to ${f.to}`).join('; ')}
- Risks: ${result.riskFlags.map(r => r.description).join('; ') || 'none'}
- Gas used: ${result.gasUsed}
- Block: ${result.blockNumber}
${result.failureReason ? `- Failure reason: ${result.failureReason.reason}` : ''}

Previous explanation:
${result.llmExplanation}`;

  const systemPrompt = 'You are a DeFi transaction analyst. Answer questions about the transaction using only the provided context. Be concise and precise.';
  const userPrompt = `${context}\n\nQuestion: ${question}`;

  const response = await openai.chat.completions.create({
    model: config.openrouter.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.2,
    max_tokens: 500,
  });

  const answer = response.choices[0]?.message?.content ?? 'Unable to answer question.';

  // Log QA call
  try {
    await mkdir(LOGS_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const short = result.txHash.slice(0, 10);
    const content = [
      '═'.repeat(80),
      `TX:        ${result.txHash}`,
      `TIMESTAMP: ${new Date().toISOString()}`,
      `TYPE:      QA`,
      '═'.repeat(80),
      '',
      '─── SYSTEM PROMPT ───────────────────────────────────────────────────────────',
      systemPrompt,
      '',
      '─── USER PROMPT ─────────────────────────────────────────────────────────────',
      userPrompt,
      '',
      '─── ANSWER ──────────────────────────────────────────────────────────────────',
      answer,
      '',
    ].join('\n');
    await writeFile(resolve(LOGS_DIR, `${ts}_${short}_qa.txt`), content, 'utf8');
  } catch (err) {
    console.warn('[llm] Failed to write QA log:', err);
  }

  return answer;
}
