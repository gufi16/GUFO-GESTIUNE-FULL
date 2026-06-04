import crypto from "crypto"
import { prisma } from "./prisma"

export function createBrowserCsrfToken() {
  return crypto.randomBytes(24).toString("hex")
}

export async function issuePasswordResetToken(userId: string, tenantId: string) {
  await prisma.passwordResetToken.updateMany({
    where: {
      userId,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: {
      usedAt: new Date(),
    },
  })

  const rawToken = crypto.randomBytes(32).toString("hex")
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex")
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60)

  await prisma.passwordResetToken.create({
    data: {
      tenantId,
      userId,
      tokenHash,
      expiresAt,
    },
  })

  return rawToken
}
