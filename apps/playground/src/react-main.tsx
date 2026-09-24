import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PlanoraWidget, usePlanora, type PlanoraUser } from '@planora/widget-react';
import './shop.css';
import { wireTools } from './shop-tools';

const USERS: Record<string, PlanoraUser> = {
  ana: { id: 'user_42', name: 'Ana Reyes', email: 'ana@example.com' },
  ben: { id: 'user_77', name: 'Ben Cruz', email: 'ben@example.com' },
};

function App() {
  const [who, setWho] = useState<string>('ana');
  const [log, setLog] = useState<string[]>([]);
  const planora = usePlanora();

  useEffect(() => wireTools(), []);

  return (
    <>
      <PlanoraWidget
        siteKey="pk_test_demo"
        apiBase="http://localhost:8787"
        user={USERS[who] ?? null}
        metadata={{ appVersion: '2.3.1', framework: 'react' }}
        onTicketCreated={({ ticket }) => setLog((l) => [`Created ${ticket.key}: ${ticket.title}`, ...l])}
        onStatusChanged={({ ticket, previous }) => setLog((l) => [`${ticket.key}: ${previous} → ${ticket.status}`, ...l])}
      />
      <nav className="nav">
        <b>Demo Shop (React)</b>
        <a href="/">All demos</a>
        <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Current user">
          <option value="ana">Logged in as Ana</option>
          <option value="ben">Logged in as Ben</option>
          <option value="">Logged out</option>
        </select>
      </nav>
      <main>
        <h1>React install</h1>
        <p className="muted">
          Switch users to see that each user only sees their own tickets. Log out and the bubble disappears, because team mode
          needs a user.
        </p>
        <div className="tools">
          <b>Open the widget from your own UI:</b>
          <button onClick={() => planora.open('report')}>Report a problem</button>
          <button onClick={() => planora.open('list')}>My tickets</button>
        </div>
        <div className="tools">
          <b>Make trouble:</b>
          <button id="throw">Throw an error</button>
          <button id="console">console.error with a token</button>
          <button id="fetch404">Failing API call (404)</button>
          <button id="navigate">SPA navigation</button>
        </div>
        <div className="card">
          <strong>Widget events</strong>
          {log.length === 0 ? <span className="muted">Nothing yet.</span> : log.map((line, i) => <span key={i}>{line}</span>)}
        </div>
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
