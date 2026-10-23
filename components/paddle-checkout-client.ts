export type PaddleCheckoutEvent = { name?: string; data?: { transaction_id?: string } };
type PaddleClient = {
  Environment: { set: (environment: "sandbox" | "production") => void };
  Initialize: (options: { token: string; eventCallback: (event: PaddleCheckoutEvent) => void }) => void;
  Checkout: { open: (options: { transactionId: string; settings: { displayMode: "overlay"; locale: "en"; allowLogout: false } }) => void };
};
type PaddleWindow = Window & { Paddle?: PaddleClient };
let loading: Promise<PaddleClient> | null = null;
let initializedFor = "";
const listeners = new Set<(event: PaddleCheckoutEvent) => void>();

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

export async function openPaddleCheckout(input: { environment: "sandbox" | "production"; clientToken: string; transactionId: string; isCurrent?: () => boolean }) {
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
  const paddle = await loadPaddle();
  if (input.isCurrent && !input.isCurrent()) return;
  const identity = `${input.environment}:${input.clientToken}`;
  if (initializedFor && initializedFor !== identity) throw new Error("Checkout settings changed. Refresh this page to continue the same order.");
  if (!initializedFor) {
    if (input.environment === "sandbox") paddle.Environment.set("sandbox");
    paddle.Initialize({ token: input.clientToken, eventCallback: event => listeners.forEach(listener => listener(event)) });
    initializedFor = identity;
  }
  paddle.Checkout.open({ transactionId: input.transactionId, settings: { displayMode: "overlay", locale: "en", allowLogout: false } });
}
