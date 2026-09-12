import { useDictation } from '../hooks/useDictation.ts';
import { LanguageSelect } from '../components/LanguageProvider.tsx';
import { useState, useEffect, useRef } from 'react';
import { Mic, Send, Volume2, Square, Sparkles } from 'lucide-react';
import { api } from '../lib/api.ts';
import { Card, Empty, stamp, type Act } from '../components/ui.tsx';
import { useLocale } from '../i18n/context.ts';
import { localeInfo, isRtl } from '../../../shared/locales.ts';
import type { Snapshot, ChatMessage, ClientAction } from '../../../shared/types.ts';
export function CopilotView({
  data,
  busy,
  act,
  executeAction,
}: {
  data: Snapshot;
  busy: boolean;
  act: Act;
  executeAction: (action: ClientAction) => Promise<void>;
}) {
  const { language, store, choose } = useLocale();
  const [messages, setMessages] = useState<ChatMessage[]>([]),
    [input, setInput] = useState(''),
    [loadError, setLoadError] = useState('');
  const sending = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  const dictation = useDictation(
    language,
    (text) => setInput((current) => (current ? current + ' ' : '') + text),
    setLoadError,
  );
  async function load() {
    try {
      setMessages(await api<ChatMessage[]>('/copilot/messages'));
      setLoadError('');
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages]);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    const message = input.trim();
    if (!message || busy || sending.current) return;
    sending.current = true;
    let reply: ChatMessage | undefined;
    try {
      if (
        await act(async () => {
          reply = await api<ChatMessage>('/copilot/chat', 'POST', { message, language });
          if (reply.action) await executeAction(reply.action);
          await load();
        })
      ) {
        setInput('');
      }
    } finally {
      sending.current = false;
    }
  }
  async function speak(message: string, originalLanguage?: string) {
    if (!window.speechSynthesis) {
      setLoadError('Read aloud is unavailable in this browser.');
      return;
    }
    window.speechSynthesis.cancel();
    let text: string;
    try {
      text = originalLanguage === language ? message : await store.translate(message, true);
    } catch (e) {
      setLoadError((e as Error).message);
      return;
    }
    const speech = new SpeechSynthesisUtterance(text);
    speech.lang = language;
    window.speechSynthesis.speak(speech);
  }
  return (
    <Card title="SafarAI Copilot" action={<Sparkles className="accent" />}>
      <p className="muted">
        Find your meeting point, call a member, open their location, or share yours.
      </p>
      <LanguageSelect />
      {loadError && (
        <div className="notice error" role="alert">
          {loadError}
          <button onClick={() => void load()}>Reload conversation</button>
        </div>
      )}
      <div className="chat-log" aria-live="polite" dir={isRtl(language) ? 'rtl' : 'ltr'}>
        {messages.length ? (
          messages.map((m) => (
            <article key={m.id} className={'chat-message ' + m.role}>
              <small translate="no">
                {m.role === 'user' ? data.user.name : 'SafarAI · ' + m.provider}
              </small>
              <p data-localize-content="true" translate={m.language === language ? 'no' : 'yes'}>
                {m.text}
              </p>
              {m.action && (
                <button
                  onClick={() =>
                    void executeAction(m.action!).catch((e) => setLoadError(e.message))
                  }
                >
                  <span data-localize-content="true">{m.action.label}</span>
                </button>
              )}
              <div className="actions">
                <small>
                  <time translate="no">{stamp(m.createdAt)}</time>
                </small>
                {m.role === 'assistant' && (
                  <button
                    className="icon"
                    aria-label="Read answer aloud"
                    onClick={() => void speak(m.text, m.language)}
                  >
                    <Volume2 size={16} />
                  </button>
                )}
              </div>
            </article>
          ))
        ) : (
          <Empty>Start a conversation. No AI answer is generated until you send a message.</Empty>
        )}
        <div ref={end} />
      </div>
      <div className="actions prompts">
        {['Find my dynamic meeting point', 'Call my group leader', 'Send SOS to my group'].map(
          (p) => (
            <button
              key={p}
              onClick={() => void act(async () => setInput(await store.translate(p)))}
            >
              {p}
            </button>
          ),
        )}
      </div>
      <form className="chat-form" onSubmit={(e) => void send(e)}>
        <label className="field">
          <span>Your message</span>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (!busy && !dictation.recording && !dictation.transcribing)
                  e.currentTarget.form?.requestSubmit();
              }
            }}
            maxLength={4000}
            rows={3}
            required
            disabled={busy}
          />
        </label>
        <div className="actions">
          <button
            type="button"
            disabled={dictation.transcribing || busy}
            onClick={() => void dictation.toggle()}
          >
            <Mic size={17} />
            {dictation.transcribing
              ? 'Transcribing…'
              : dictation.recording
                ? 'Stop microphone'
                : 'Dictate'}
          </button>
          <button type="button" onClick={() => window.speechSynthesis?.cancel()}>
            <Square size={14} />
            Stop audio
          </button>
          <button
            className="primary"
            disabled={busy || dictation.recording || dictation.transcribing || !input.trim()}
          >
            <Send size={17} />
            {busy ? 'Waiting for provider…' : 'Send'}
          </button>
        </div>
      </form>
      <p className="fine">
        Enter sends your message. Shift + Enter adds a new line. Tap Dictate, speak, then Stop
        microphone. Copilot uses your group’s latest shared data and can open calls, member
        locations and meeting directions.
      </p>
      <button
        disabled={busy}
        onClick={() =>
          void act(async () => {
            await api('/copilot/messages', 'DELETE');
            setMessages([]);
          })
        }
      >
        Clear my conversation
      </button>
    </Card>
  );
}
