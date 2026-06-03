import jwt, { type SignOptions } from "jsonwebtoken";
import bcrypt from "bcryptjs";

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";
const MIN_JWT_SECRET_LENGTH = 16
const INSECURE_DEV_SECRET = "dev_secret"

function getJwtSecret() {
  const configuredSecret = String(process.env.JWT_SECRET || "").trim()
  const isProduction = process.env.NODE_ENV === "production"
  const allowInsecureDevJwt = process.env.ALLOW_INSECURE_DEV_JWT === "true"

  if (configuredSecret) {
    if (configuredSecret.length < MIN_JWT_SECRET_LENGTH) {
      throw new Error(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters long`)
    }
    if (isProduction && configuredSecret === INSECURE_DEV_SECRET) {
      throw new Error("JWT_SECRET must not use the insecure development default in production")
    }
    return configuredSecret
  }

  if (!isProduction && allowInsecureDevJwt) {
    return INSECURE_DEV_SECRET
  }

  throw new Error("JWT_SECRET is required")
}

export { getJwtSecret }

export function hashSecret(raw: string) {
  return bcrypt.hash(raw, 12);
}

export function verifySecret(raw: string, hash: string) {
  return bcrypt.compare(raw, hash);
}

export function signAccessToken(payload: {
  tenantId: string | null
  userId: string
  role: string
  email?: string
  activeCompanyId?: string | null
  controlPanel?: boolean
}) {
  const expiresIn: SignOptions["expiresIn"] = JWT_EXPIRES_IN as SignOptions["expiresIn"]
  return jwt.sign(payload, getJwtSecret(), { expiresIn });
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, getJwtSecret()) as {
    tenantId: string | null
    userId: string
    role: string
    email?: string
    activeCompanyId?: string | null
    controlPanel?: boolean
    iat: number
    exp: number
  };
}

export function makeLicenseKey(prefix = "PSH") {
  // exemplu: PSH-AB12-CD34-EF56
  const part = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${part()}-${part()}-${part()}`;
}
