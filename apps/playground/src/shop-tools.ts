/** Buttons that create the kind of trouble the widget should capture. */
export function wireTools(root: ParentNode = document) {
  const on = (id: string, fn: () => void) => root.querySelector<HTMLButtonElement>(`#${id}`)?.addEventListener('click', fn);
  on('throw', () => {
    setTimeout(() => {
      throw new Error('Cannot read properties of undefined (reading "price")');
    });
  });
  on('reject', () => {
    void Promise.reject(new Error('Payment provider timeout'));
  });
  on('console', () => console.error('Checkout failed', { orderId: 1042, token: 'sk_live_should_be_redacted' }));
  on('fetch404', () => void fetch('/api/orders/1042?api_key=secret123').catch(() => undefined));
  on('fetchOffline', () => void fetch('http://localhost:1/unreachable').catch(() => undefined));
  on('navigate', () => history.pushState({}, '', `?step=${Math.floor(Math.random() * 100)}`));
}
