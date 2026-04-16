import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useAnalysis } from '../../store/analysis.store.js';
import { askQuestion } from '../../api/client.js';
import styles from './QAChat.module.css';

const SUGGESTED_QUESTIONS = [
  'Where did the funds go?',
  'Why was gas so high?',
  'What storage slots changed?',
  'What caused the failure?',
  'Which tokens were swapped?',
];

export function QAChat() {
  const { state, dispatch } = useAnalysis();
  const [question, setQuestion] = useState('');
  const historyEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new QA items are added
  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.qaHistory.length]);

  if (!state.result) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || !state.result) return;

    setQuestion('');
    dispatch({ type: 'QA_START' });

    try {
      const res = await askQuestion({ question: q, context: state.result });
      dispatch({ type: 'QA_SUCCESS', payload: { question: q, answer: res.answer } });
    } catch (err) {
      dispatch({
        type: 'QA_ERROR',
        payload: err instanceof Error ? err.message : 'Failed to get answer',
      });
    }
  }

  function handleSuggestion(q: string) {
    setQuestion(q);
  }

  return (
    <div className={styles.chat}>
      <h3 className={styles.title}>Ask a Question</h3>

      {state.qaHistory.length > 0 && (
        <div className={styles.history}>
          {state.qaHistory.map((item, i) => (
            <div key={`qa-${i}-${item.question.slice(0, 20)}`} className={styles.qaItem}>
              <div className={styles.question}>
                <span className={styles.qLabel}>Q</span>
                {item.question}
              </div>
              <div className={styles.answer}>
                <span className={styles.aLabel}>A</span>
                <pre className={styles.answerText}>{item.answer}</pre>
              </div>
            </div>
          ))}
          <div ref={historyEndRef} />
        </div>
      )}

      {state.qaError && (
        <div className={styles.error}>{state.qaError}</div>
      )}

      <div className={styles.suggestions}>
        {SUGGESTED_QUESTIONS.map(q => (
          <button key={q} className={styles.suggestion} onClick={() => handleSuggestion(q)}>
            {q}
          </button>
        ))}
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <input
          className={styles.input}
          type="text"
          placeholder="Ask anything about this transaction..."
          value={question}
          onChange={e => setQuestion(e.target.value)}
          disabled={state.qaLoading}
        />
        <button
          className={styles.sendBtn}
          type="submit"
          disabled={state.qaLoading || !question.trim()}
        >
          {state.qaLoading ? '...' : 'Ask'}
        </button>
      </form>
    </div>
  );
}
