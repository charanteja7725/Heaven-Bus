import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Sparkles,
  X,
  ArrowUp,
  ArrowRight,
  Mic,
  RotateCcw,
  PhoneCall,
  ShieldAlert,
} from "lucide-react";
import {
  api,
  money,
  time,
  type Trip,
  type SupportContact,
} from "./lib";
type Message = {
  role: "user" | "assistant";
  text: string;
  trips?: Trip[];
  supportContacts?: SupportContact[];
  supportDisclaimer?: string;
};
export default function Jarvis({
  initialPrompt,
  onClose,
}: {
  initialPrompt: string;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([
      {
        role: "assistant",
        text: "Hey, I’m Jarvis. A window seat, a weekend away, or the fastest way home? Tell me where you want to go.",
      },
    ]),
    [input, setInput] = useState(""),
    [busy, setBusy] = useState(false),
    [context, setContext] = useState<any>({}),
    [listening, setListening] = useState(false);
  const end = useRef<HTMLDivElement>(null),
    field = useRef<HTMLInputElement>(null),
    started = useRef(false),
    recognition = useRef<any>(null);
  async function send(text = input) {
    if (!text.trim() || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setBusy(true);
    try {
      const result = await api("/jarvis", {
        method: "POST",
        body: JSON.stringify({ message: text, context }),
      });
      setContext(result.context);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: result.reply,
          trips: result.trips,
          supportContacts: result.supportContacts,
          supportDisclaimer: result.supportDisclaimer,
        },
      ]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: (e as Error).message },
      ]);
    } finally {
      setBusy(false);
      field.current?.focus();
    }
  }
  useEffect(() => {
    field.current?.focus();
    if (initialPrompt && !started.current) {
      started.current = true;
      send(initialPrompt);
    }
    return () => recognition.current?.abort();
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  function voice() {
    const Speech =
      (window as any).SpeechRecognition ??
      (window as any).webkitSpeechRecognition;
    if (!Speech) return;
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const r = new Speech();
    recognition.current = r;
    r.lang = "en-IN";
    r.interimResults = false;
    r.onresult = (e: any) => setInput(e.results[0][0].transcript);
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    setListening(true);
    r.start();
  }
  return (
    <aside
      className="jarvis-panel"
      role="dialog"
      aria-label="Ask Jarvis travel assistant"
    >
      <header className="jarvis-header">
        <span className="jarvis-avatar">
          <Sparkles size={22} />
        </span>
        <div>
          <h2>Ask Jarvis</h2>
          <p>
            <span className="online-dot" />
            Your travel sidekick
          </p>
        </div>
        <button
          className="icon-button"
          aria-label="Start new conversation"
          onClick={() => {
            setContext({});
            setMessages([
              {
                role: "assistant",
                text: "A fresh start. Where are we heading?",
              },
            ]);
          }}
        >
          <RotateCcw size={17} />
        </button>
        <button
          className="icon-button"
          aria-label="Close Jarvis"
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </header>
      <div className="jarvis-messages" aria-live="polite">
        {messages.map((m, i) => (
          <div className={`message ${m.role}`} key={i}>
            {m.role === "assistant" && (
              <span className="message-symbol">
                <Sparkles size={14} />
              </span>
            )}
            <div>
              <p>{m.text}</p>
              {m.trips?.map((t) => (
                <Link
                  className="jarvis-trip"
                  key={t._id}
                  to={`/trip/${encodeURIComponent(t._id)}`}
                  onClick={onClose}
                >
                  <div>
                    <strong>{t.name}</strong>
                    <span>
                      {time(t.departureAt)} IST · {t.duration}h · {t.available}{" "}
                      seats
                    </span>
                  </div>
                  <strong>{money(t.fare)}</strong>
                  <ArrowRight size={16} />
                </Link>
              ))}
              {m.supportContacts?.length ? (
                <div className="jarvis-support-list">
                  {m.supportContacts.map((contact) => (
                    <a
                      href={`tel:${contact.phone.replace(/[^0-9+]/g, "")}`}
                      className={`jarvis-support-card ${contact.priority === "urgent" ? "urgent" : ""}`}
                      key={contact.id}
                    >
                      {contact.priority === "urgent" ? (
                        <ShieldAlert size={16} />
                      ) : (
                        <PhoneCall size={16} />
                      )}
                      <span>
                        <strong>{contact.role}</strong>
                        <small>{contact.issue}</small>
                      </span>
                      <b>{contact.phone}</b>
                    </a>
                  ))}
                  {m.supportDisclaimer && (
                    <small className="jarvis-support-disclaimer">
                      {m.supportDisclaimer}
                    </small>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        ))}
        {messages.length === 1 && (
          <div className="jarvis-suggestions">
            {[
              "Bengaluru to Chennai tomorrow",
              "A night bus to Goa from Bengaluru",
              "How do seat holds work?",
              "The bus is delayed — who should I call?",
              "The toilet is not clean",
            ].map((s) => (
              <button onClick={() => send(s)} key={s}>
                {s}
                <ArrowRight size={14} />
              </button>
            ))}
          </div>
        )}
        {busy && (
          <p className="jarvis-thinking">
            Jarvis is checking the routes<span>…</span>
          </p>
        )}
        <div ref={end} />
      </div>
      <form
        className="jarvis-input"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          ref={field}
          aria-label="Message Jarvis"
          placeholder={listening ? "Listening…" : "Where do you want to go?"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={800}
        />
        {((window as any).SpeechRecognition ||
          (window as any).webkitSpeechRecognition) && (
          <button
            type="button"
            onClick={voice}
            aria-label={listening ? "Stop voice input" : "Use voice input"}
            className={`icon-button ${listening ? "listening" : ""}`}
          >
            <Mic size={18} />
          </button>
        )}
        <button
          className="jarvis-send"
          disabled={busy || !input.trim()}
          aria-label="Send message"
        >
          <ArrowUp size={20} />
        </button>
      </form>
      <p className="jarvis-disclaimer">
        Searches HEAVEN-BUS inventory and routes support issues to the responsible
        desk. You choose and confirm every booking.
      </p>
    </aside>
  );
}
