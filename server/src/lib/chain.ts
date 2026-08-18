/**
 * Robinhood Chain access for $HAY (HANDOFF §7).
 *
 * Nothing in here runs unless HAY_ONCHAIN_ENABLED is set AND the RPC, token,
 * treasury address and treasury key are all present — the treasury key lives
 * in the server environment and is never sent to a client. Deposits are
 * verified against the chain (recipient, amount, confirmations) before a
 * single game hay is credited.
 */
import { Contract, JsonRpcProvider, Wallet, formatUnits, parseUnits } from 'ethers';
import { env, onChainReady } from '../env';
import { errors } from './errors';

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 value) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

let provider: JsonRpcProvider | null = null;
let decimalsCache: number | null = null;

function requireEnabled(): void {
  if (!onChainReady()) throw errors.disabled('On-chain $HAY');
}

export function getProvider(): JsonRpcProvider {
  requireEnabled();
  if (!provider) {
    provider = new JsonRpcProvider(
      env.CHAIN_RPC_URL,
      env.CHAIN_ID ? Number(env.CHAIN_ID) : undefined,
    );
  }
  return provider;
}

function token(withSigner = false): Contract {
  requireEnabled();
  const p = getProvider();
  const runner = withSigner ? new Wallet(env.TREASURY_PRIVATE_KEY as string, p) : p;
  return new Contract(env.HAY_TOKEN_ADDRESS as string, ERC20_ABI, runner);
}

export async function tokenDecimals(): Promise<number> {
  if (decimalsCache != null) return decimalsCache;
  const d = await token().decimals();
  decimalsCache = Number(d);
  return decimalsCache;
}

/** Treasury → player. Returns the transaction hash once it is broadcast. */
export async function sendHay(to: string, amount: string): Promise<string> {
  requireEnabled();
  const decimals = await tokenDecimals();
  const tx = await token(true).transfer(to, parseUnits(amount, decimals));
  return tx.hash as string;
}

export interface DepositCheck {
  ok: boolean;
  reason?: string;
  from?: string;
  amount?: string;
  confirmations?: number;
}

/**
 * Confirm that `txHash` really moved `$HAY` from `expectedFrom` into the
 * treasury, with enough confirmations behind it.
 */
export async function verifyDeposit(txHash: string, expectedFrom: string): Promise<DepositCheck> {
  requireEnabled();
  const p = getProvider();
  const receipt = await p.getTransactionReceipt(txHash);
  if (!receipt) return { ok: false, reason: 'Transaction not found yet' };
  if (receipt.status !== 1) return { ok: false, reason: 'Transaction failed on chain' };

  const head = await p.getBlockNumber();
  const confirmations = head - receipt.blockNumber + 1;
  if (confirmations < env.CHAIN_MIN_CONFIRMATIONS) {
    return { ok: false, reason: 'Not enough confirmations yet', confirmations };
  }

  const decimals = await tokenDecimals();
  const contract = token();
  const treasury = (env.TREASURY_ADDRESS as string).toLowerCase();
  const from = expectedFrom.toLowerCase();
  const tokenAddress = (env.HAY_TOKEN_ADDRESS as string).toLowerCase();

  let total = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== tokenAddress) continue;
    let parsed;
    try {
      parsed = contract.interface.parseLog({ topics: [...log.topics], data: log.data });
    } catch {
      continue;
    }
    if (!parsed || parsed.name !== 'Transfer') continue;
    const logFrom = String(parsed.args[0]).toLowerCase();
    const logTo = String(parsed.args[1]).toLowerCase();
    if (logFrom === from && logTo === treasury) total += BigInt(parsed.args[2]);
  }

  if (total <= 0n) return { ok: false, reason: 'No $HAY transfer to the treasury in that transaction', confirmations };
  return { ok: true, from, amount: formatUnits(total, decimals), confirmations };
}
