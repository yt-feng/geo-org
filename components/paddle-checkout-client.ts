export type PaddleCheckoutEvent = { name?: string; data?: { id?: string; transaction_id?: string } };
type PaddleClient = {
  Environment: { set: (environment: "sandbox" | "production") => void };
  Initialize: (options: { token: string; eventCallback: (event: PaddleCheckoutEvent) => void }) => void;
  Checkout: { open: (options: { transactionId: string; settings: { displayMode: "overlay"; locale: "en"; allowLogout: false } }) => void; close: () => void };
};
type PaddleWindow = Window & { Paddle?: PaddleClient };
type CheckoutInput = { environment: "sandbox" | "production"; clientToken: string; transactionId: string; isCurrent?: () => boolean };
type CheckoutAttempt = {
  input: CheckoutInput; promise: Promise<void>; resolve: () => void; reject: (error: Error) => void;
  state: "loading" | "opening" | "ready" | "finished"; paddle?: PaddleClient; checkoutId?: string;
  retiredCheckoutIds: Set<string>;
  readinessTimer?: number; currentTimer?: number;
};
let loading: Promise<PaddleClient> | null = null;
let initializedFor = "";
let activeCheckout: CheckoutAttempt | null = null;
let ignoredClose: { transactionId: string; checkoutId?: string; until: number } | null = null;
const listeners = new Set<(event: PaddleCheckoutEvent) => void>();

function clearAttemptTimers(attempt: CheckoutAttempt) {
  window.clearTimeout(attempt.readinessTimer); window.clearTimeout(attempt.currentTimer);
  attempt.readinessTimer = undefined; attempt.currentTimer = undefined;
}

function finishAttempt(attempt: CheckoutAttempt, error?: Error, close = false) {
  if (attempt.state === "finished") return;
  const wasOpened = attempt.state === "opening" || attempt.state === "ready";
  attempt.state = "finished"; clearAttemptTimers(attempt);
  if (activeCheckout === attempt) activeCheckout = null;
  // Settle before close(): Paddle may emit checkout.closed synchronously.
  if (error) attempt.reject(error); else attempt.resolve();
  if (close && wasOpened && attempt.paddle) {
    ignoredClose = { transactionId: attempt.input.transactionId, checkoutId: attempt.checkoutId, until: Date.now() + 5000 };
    try { attempt.paddle.Checkout.close(); } catch { /* Preserve the actionable timeout/error message. */ }
  }
}

function stillCurrent(attempt: CheckoutAttempt) {
  if (activeCheckout !== attempt || attempt.state === "finished") return false;
  if (!attempt.input.isCurrent || attempt.input.isCurrent()) return true;
  finishAttempt(attempt, new Error("The checkout session changed. Return to your saved order to continue."), true);
  return false;
}

function handlePaddleEvent(event: PaddleCheckoutEvent) {
  const attempt = activeCheckout, transactionId = event.data?.transaction_id;
  if (event.name === "checkout.closed" && ignoredClose) {
    const ignored = ignoredClose;
    const belongsToNewCheckout = !!attempt?.checkoutId && event.data?.id === attempt.checkoutId;
    if (Date.now() <= ignored.until && (!transactionId || transactionId === ignored.transactionId)
      && (!ignored.checkoutId || !event.data?.id || event.data.id === ignored.checkoutId) && !belongsToNewCheckout) {
      ignoredClose = null; return;
    }
    if (Date.now() > ignored.until) ignoredClose = null;
  }
  if (attempt && stillCurrent(attempt)) {
    const sameTransaction = transactionId === attempt.input.transactionId;
    const retired = !!event.data?.id && attempt.retiredCheckoutIds.has(event.data.id);
    if (retired && (event.name === "checkout.loaded" || event.name === "checkout.closed")) return;
    const matches = sameTransaction && !retired
      && (!attempt.checkoutId || !event.data?.id || event.data.id === attempt.checkoutId);
    const closeMatches = matches || (!transactionId && (!attempt.checkoutId || !event.data?.id || event.data.id === attempt.checkoutId));
    if (event.name === "checkout.loaded" && sameTransaction && !retired && (attempt.state === "opening" || attempt.state === "ready")) {
      // A timed-out iframe can report loaded after the same transaction was
      // reopened. The new iframe's loaded event must replace that stale ID;
      // later events from the replaced iframe cannot take ownership back.
      if (event.data?.id && attempt.checkoutId && event.data.id !== attempt.checkoutId) {
        attempt.retiredCheckoutIds.add(attempt.checkoutId);
        if (attempt.retiredCheckoutIds.size > 8) attempt.retiredCheckoutIds.delete(attempt.retiredCheckoutIds.values().next().value!);
      }
      if (event.data?.id) attempt.checkoutId = event.data.id;
      ignoredClose = null;
      attempt.state = "ready";
      window.clearTimeout(attempt.readinessTimer); attempt.readinessTimer = undefined;
      attempt.resolve();
    } else if (event.name === "checkout.completed" && matches) {
      // Completion may beat loaded. Only the server can confirm payment/credit.
      ignoredClose = { transactionId: attempt.input.transactionId, checkoutId: event.data?.id || attempt.checkoutId, until: Date.now() + 5000 };
      finishAttempt(attempt);
    } else if (event.name === "checkout.closed" && closeMatches) {
      finishAttempt(attempt, new Error("Checkout was closed. Your order is saved; check its status or resume the same checkout."));
    } else if (event.name === "checkout.error" && (!transactionId || matches)) {
      // Paddle documents checkout.error without a transaction data payload.
      finishAttempt(attempt, new Error("Paddle checkout could not load. Your order is saved; check its status, then resume the same checkout."), true);
    }
  }
  for (const listener of listeners) {
    try { listener(event); } catch { /* A UI observer must not break checkout readiness handling. */ }
  }
}

function loadPaddle(): Promise<PaddleClient> {
  const browser = window as PaddleWindow;
  if (browser.Paddle) return Promise.resolve(browser.Paddle);
  if (!loading) loading = new Promise<PaddleClient>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    script.async = true;
    const timeout = window.setTimeout(() => finish(new Error("Paddle checkout took too long to load. Please retry the same order.")), 15_000);
    function finish(error?: Error) {
      window.clearTimeout(timeout);
      script.onload = null; script.onerror = null;
      if (error || !browser.Paddle) {
        script.remove(); loading = null;
        reject(error || new Error("Paddle checkout could not load. Please retry the same order."));
      } else resolve(browser.Paddle);
    }
    script.onload = () => finish();
    script.onerror = () => finish(new Error("Paddle checkout could not load. Please retry the same order."));
    document.head.appendChild(script);
  });
  return loading;
}

export function subscribeToPaddle(listener: (event: PaddleCheckoutEvent) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

async function beginCheckout(attempt: CheckoutAttempt) {
  const input = attempt.input;
  // Paddle.js reads these query parameters itself during Initialize. Remove
  // them before even loading the SDK; only our owner-checked order may open.
  const page = new URL(window.location.href);
  const controls = ["_ptxn", "paddle_env", "_paction", "__pw_iic", "__pw"];
  // The SDK's parser scans the entire href, including query-like fragments.
  if (page.hash || controls.some(key => page.searchParams.has(key))) {
    controls.forEach(key => page.searchParams.delete(key));
    page.hash = "";
    window.history.replaceState(window.history.state, "", `${page.pathname}${page.search}${page.hash}`);
  }
  let paddle: PaddleClient;
  try { paddle = await loadPaddle(); }
  catch { finishAttempt(attempt, new Error("Paddle checkout could not load. Your order is saved; resume the same checkout to try again.")); return; }
  if (!stillCurrent(attempt)) return;
  attempt.paddle = paddle;
  const identity = `${input.environment}:${input.clientToken}`;
  if (initializedFor && initializedFor !== identity) { finishAttempt(attempt, new Error("Checkout settings changed. Refresh this page to continue the same order.")); return; }
  if (!initializedFor) {
    if (input.environment === "sandbox") paddle.Environment.set("sandbox");
    paddle.Initialize({ token: input.clientToken, eventCallback: handlePaddleEvent });
    initializedFor = identity;
  }
  if (!stillCurrent(attempt)) return;
  attempt.state = "opening";
  attempt.readinessTimer = window.setTimeout(() => {
    if (stillCurrent(attempt) && attempt.state === "opening") finishAttempt(attempt,
      new Error("Paddle checkout did not finish loading. Your order is saved; close the payment window if it is still visible, check its status, then resume the same checkout."), true);
  }, 20_000);
  paddle.Checkout.open({ transactionId: input.transactionId, settings: { displayMode: "overlay", locale: "en", allowLogout: false } });
}

export function openPaddleCheckout(input: CheckoutInput): Promise<void> {
  if (input.isCurrent && !input.isCurrent()) return Promise.resolve();
  if (activeCheckout && stillCurrent(activeCheckout)) {
    if (activeCheckout.input.transactionId === input.transactionId && activeCheckout.input.environment === input.environment && activeCheckout.input.clientToken === input.clientToken) return activeCheckout.promise;
    return Promise.reject(new Error("Another checkout is already open. Close it before continuing this saved order."));
  }
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  const attempt: CheckoutAttempt = { input, promise, resolve, reject, state: "loading", retiredCheckoutIds: new Set() };
  activeCheckout = attempt;
  const checkCurrent = () => {
    if (!stillCurrent(attempt)) return;
    attempt.currentTimer = window.setTimeout(checkCurrent, 250);
  };
  attempt.currentTimer = window.setTimeout(checkCurrent, 250);
  void beginCheckout(attempt).catch(() => finishAttempt(attempt,
    new Error("Paddle checkout could not open. Your order is saved; check its status, then resume the same checkout."), true));
  return promise;
}
