# @planora/widget-react

React and Next.js bindings for the [Planora widget](https://www.npmjs.com/package/@planora/widget): a floating bubble your team uses to report bugs and request features, with the status shown back in the bubble.

```bash
npm install @planora/widget-react
```

```tsx
import { PlanoraWidget, usePlanora } from '@planora/widget-react';

export function App({ user }) {
  return (
    <>
      <PlanoraWidget
        siteKey="pk_live_…"
        // userHash = HMAC-SHA256(user.id, site secret), computed on your server
        user={user ? { id: user.id, name: user.name, email: user.email, userHash: user.planoraHash } : null}
        metadata={{ appVersion: '2.3.1' }}
        onTicketCreated={({ ticket }) => console.log('Filed', ticket.key)}
      />
      <ReportButton />
    </>
  );
}

function ReportButton() {
  const planora = usePlanora();
  return <button onClick={() => planora.open('report')}>Report a problem</button>;
}
```

- `<PlanoraWidget>` renders nothing itself. The bubble mounts in its own Shadow DOM.
- It's safe in SSR frameworks: everything runs in effects.
- Passing `user={null}` logs the user out. In team mode the bubble then hides.

Full documentation: https://github.com/GonzagaLloyd/PlanoraFE
