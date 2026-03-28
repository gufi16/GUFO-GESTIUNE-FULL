import jwt, { type SignOptions } from "jsonwebtoken";
import bcrypt from "bcryptjs";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";

export function hashSecret(raw: string) {
  return bcrypt.hash(raw, 12);
}

export function verifySecret(raw: string, hash: string) {
  return bcrypt.compare(raw, hash);
}

export function signAccessToken(payload: {
  tenantId: string
  userId: string
  role: string
  email?: string
}) {
  const expiresIn: SignOptions["expiresIn"] = JWT_EXPIRES_IN as SignOptions["expiresIn"]
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, JWT_SECRET) as {
    tenantId: string
    userId: string
    role: string
    email?: string
    iat: number
    exp: number
  };
}

export function makeLicenseKey(prefix = "PSH") {
  // exemplu: PSH-AB12-CD34-EF56
  const part = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${part()}-${part()}-${part()}`;
}
