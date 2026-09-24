/** The fake shop page shared by the plain, hostile and public demos. */
export const SHOP_HTML = `
  <nav class="nav"><b>Demo Shop</b><a href="/">All demos</a><a href="#">Cart (2)</a></nav>
  <main>
    <h1>Autumn collection</h1>
    <div class="grid">
      <div class="card"><div class="swatch" style="background:#c9b79c"></div><strong>Wool scarf</strong><span>$49.00</span><button class="btn btn-dark">Add to cart</button></div>
      <div class="card"><div class="swatch" style="background:#6b7f6a"></div><strong>Field jacket</strong><span>$189.00</span><button class="btn btn-dark">Add to cart</button></div>
      <div class="card"><div class="swatch" style="background:#9c4a2f"></div><strong>Leather boots</strong><span>$229.00</span><button class="btn btn-dark">Add to cart</button></div>
    </div>
    <div class="card" style="max-width:420px">
      <strong>Checkout</strong>
      <label>Email <input value="ana@example.com"></label>
      <label>Password <input type="password" value="hunter2"></label>
      <div data-planora-mask>Card on file: 4242 4242 4242 4242</div>
      <span class="muted">The password field and the masked card line are blurred in screenshots and stripped from the page snapshot.</span>
    </div>
    <div class="tools">
      <b>Make trouble (the widget records this before you open it):</b>
      <button id="throw">Throw an error</button>
      <button id="reject">Unhandled rejection</button>
      <button id="console">console.error with a token</button>
      <button id="fetch404">Failing API call (404)</button>
      <button id="fetchOffline">Unreachable request</button>
      <button id="navigate">SPA navigation</button>
    </div>
  </main>`;
