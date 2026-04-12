import { Router } from "express"
import { z } from "zod"
import { generateGufoAiReply } from "../lib/gufoAi"
import { AuthedRequest, requireAuth } from "../middleware/requireAuth"

const router = Router()

const ChatSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  currentPath: z.string().trim().max(200).optional(),
})

router.post("/api/v1/gufo-ai/chat", requireAuth, async (req: AuthedRequest, res) => {
  if (!req.auth?.tenantId) {
    return res.status(403).json({ ok: false, error: "Gufo AI este disponibil doar in ERP." })
  }

  const parsed = ChatSchema.safeParse(req.body || {})
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "Mesaj invalid." })
  }

  const reply = generateGufoAiReply({
    message: parsed.data.message,
    currentPath: parsed.data.currentPath,
  })

  return res.json({
    ok: true,
    item: reply,
  })
})

export default router
