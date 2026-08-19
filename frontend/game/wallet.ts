/**
 * Solana wallet discovery and signing.
 *
 * This used to read `window.ethereum` and ask for an EVM signature, which is
 * why Phantom answered "this website is trying to use Ethereum, which is not
 * supported by this Solana account". It was right to refuse. SUNMIL is on
 * Solana, so the wallet is asked for what it actually holds.
 *
 * Discovery walks the known injection points rather than a single global,
 * because more than one wallet can be installed and the last one to load
 * should not get to decide for the player.
 */
export interface SolanaProvider {
  isPhantom?: boolean;
  isSolflare?: boolean;
  isBackpack?: boolean;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey?: { toString(): string } }>;
  publicKey?: { toString(): string } | null;
  signMessage(message: Uint8Array, encoding?: string): Promise<{ signature: Uint8Array } | Uint8Array>;
}

export interface WalletChoice {
  id: string;
  name: string;
  icon: string;
  provider: SolanaProvider;
}

type Win = Record<string, unknown> & { phantom?: Record<string, unknown> };

/** Where each wallet puts itself. Order only decides listing, never priority. */
function injected(): WalletChoice[] {
  if (typeof window === 'undefined') return [];
  const w = window as unknown as Win;
  const phantom = (w.phantom as Record<string, unknown> | undefined)?.solana;
  const candidates: Array<[string, string, unknown]> = [
    ['app.phantom', 'Phantom', phantom],
    ['io.solflare', 'Solflare', w.solflare],
    ['app.backpack', 'Backpack', (w.backpack as Record<string, unknown> | undefined)?.solana ?? w.backpack],
    ['com.coinbase', 'Coinbase Wallet', (w.coinbaseSolana as unknown)],
    // Last, and only if nothing above claimed it: whoever took window.solana.
    ['window.solana', 'Solana wallet', w.solana],
  ];

  const found = new Map<string, WalletChoice>();
  for (const [id, name, provider] of candidates) {
    const p = provider as SolanaProvider | undefined;
    if (!p || typeof p.connect !== 'function' || typeof p.signMessage !== 'function') continue;
    // window.solana is usually one of the above wearing a second hat.
    if (id === 'window.solana' && [...found.values()].some((f) => f.provider === p)) continue;
    found.set(id, { id, name: label(p, name), icon: '', provider: p });
  }
  return [...found.values()];
}

function label(p: SolanaProvider, fallback: string): string {
  if (p.isPhantom) return 'Phantom';
  if (p.isSolflare) return 'Solflare';
  if (p.isBackpack) return 'Backpack';
  return fallback;
}

export function discoverWallets(): Promise<WalletChoice[]> {
  // Extensions inject before the page runs, so there is nothing to wait for —
  // kept async so callers do not have to change if that stops being true.
  return Promise.resolve(injected());
}

/** Connect, and return the account's base58 address. */
export async function connect(choice: WalletChoice): Promise<string> {
  const res = await choice.provider.connect();
  const key = res?.publicKey ?? choice.provider.publicKey;
  const address = key?.toString();
  if (!address) throw new Error('wallet returned no account');
  return address;
}

/**
 * Sign the challenge. Wallets differ in what they hand back — Phantom returns
 * `{ signature }`, some return the bytes directly — so both are accepted.
 */
export async function signMessage(choice: WalletChoice, message: string): Promise<string> {
  const bytes = new TextEncoder().encode(message);
  const out = await choice.provider.signMessage(bytes, 'utf8');
  const sig = out instanceof Uint8Array ? out : out?.signature;
  if (!sig) throw new Error('wallet returned no signature');
  return base58Encode(sig);
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** The server speaks base58; wallets hand back raw bytes. */
export function base58Encode(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = '';
  for (const byte of bytes) { if (byte !== 0) break; out += '1'; }
  for (let i = digits.length - 1; i >= 0; i -= 1) out += B58[digits[i]];
  return out;
}
