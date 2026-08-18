import jwt from 'jsonwebtoken';
import { env } from '../env';

export interface SessionClaims {
  userId: string;
  wallet?: string | null;
}

export function signSession(claims: SessionClaims): string {
  return jwt.sign(claims, env.JWT_SECRET, {
    expiresIn: env.JWT_TTL_SECONDS,
    issuer: 'sunmil',
    subject: claims.userId,
  });
}

export function verifySession(token: string): SessionClaims | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { issuer: 'sunmil' });
    if (typeof decoded !== 'object' || decoded === null) return null;
    const { userId, wallet } = decoded as jwt.JwtPayload & SessionClaims;
    if (typeof userId !== 'string' || !userId) return null;
    return { userId, wallet: typeof wallet === 'string' ? wallet : null };
  } catch {
    return null;
  }
}
