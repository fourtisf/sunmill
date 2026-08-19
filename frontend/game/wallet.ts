/**
 * Wallet discovery (EIP-6963).
 *
 * Reading `window.ethereum` was never safe with more than one extension
 * installed: whichever injects last wins the property, and the player has no
 * say. On a browser carrying both Phantom and MetaMask, Phantom takes it and
 * then refuses with "Unable to find any account for 60" — SLIP-44's coin type
 * for Ethereum — because its EVM side is empty. MetaMask, sitting right there,
 * is never asked.
 *
 * EIP-6963 inverts that: the page announces interest, every installed wallet
 * answers with its own handle, and the player picks. The legacy path stays as
 * a fallback for wallets that have not adopted it.
 */
export interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export interface WalletChoice {
  id: string;
  name: string;
  icon: string;
  provider: Eip1193;
}

interface AnnounceDetail {
  info?: { uuid?: string; name?: string; icon?: string; rdns?: string };
  provider?: Eip1193;
}

/** Best-effort name for a provider that predates EIP-6963. */
function legacyName(p: Record<string, unknown>): string {
  if (p.isMetaMask) return 'MetaMask';
  if (p.isPhantom) return 'Phantom';
  if (p.isCoinbaseWallet) return 'Coinbase Wallet';
  if (p.isRabby) return 'Rabby';
  if (p.isBraveWallet) return 'Brave Wallet';
  if (p.isTrust || p.isTrustWallet) return 'Trust Wallet';
  return 'Browser wallet';
}

function legacyWallets(): WalletChoice[] {
  const eth = (window as unknown as { ethereum?: Record<string, unknown> }).ethereum;
  if (!eth) return [];
  // Some extensions publish every injected provider here when they collide.
  const many = eth.providers;
  const list = Array.isArray(many) && many.length ? (many as Record<string, unknown>[]) : [eth];
  return list.map((p, i) => ({
    id: `legacy:${i}:${legacyName(p)}`,
    name: legacyName(p),
    icon: '',
    provider: p as unknown as Eip1193,
  }));
}

/**
 * Ask who is out there. Resolves after a short window because announcements
 * are fire-and-forget — there is no count to wait for.
 */
export function discoverWallets(windowMs = 180): Promise<WalletChoice[]> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve([]);
    const found = new Map<string, WalletChoice>();

    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<AnnounceDetail>).detail;
      const info = detail?.info;
      if (!info || !detail?.provider) return;
      const id = info.rdns || info.uuid;
      if (!id || found.has(id)) return;
      found.set(id, {
        id,
        name: info.name || 'Wallet',
        icon: info.icon || '',
        provider: detail.provider,
      });
    };

    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    window.setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      resolve(found.size ? [...found.values()] : legacyWallets());
    }, windowMs);
  });
}
