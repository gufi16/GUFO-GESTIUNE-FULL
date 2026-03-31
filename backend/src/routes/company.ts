// @ts-nocheck
import { Router } from "express"
import jwt from "jsonwebtoken"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { getNextNumberPreview, getNumberingConfig, normalizeNumberingPayload } from "../lib/numbering"
import { requireTenantModule } from "../lib/tenantModules"
import { anafHttpRequest } from "../lib/anafHttp"

const router = Router()

const ANAF_AUTH_URL = "https://logincert.anaf.ro/anaf-oauth2/v1/authorize"
const ANAF_TOKEN_URL = "https://logincert.anaf.ro/anaf-oauth2/v1/token"
const ANAF_TEST_URL = "https://api.anaf.ro/TestOauth/jaxrs/hello?name=GuFo%20ERP"
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret"

async function getEffectiveAnafOauthConfig(tenantId: string) {
  const [company, platform] = await Promise.all([
    prisma.company.findUnique({
      where: { tenantId },
      select: {
        efacturaOauthClientId: true,
        efacturaOauthClientSecret: true,
        efacturaOauthRedirectUri: true,
      },
    }),
    prisma.platformConfig.findUnique({
      where: { key: "global" },
      select: {
        efacturaOauthClientId: true,
        efacturaOauthClientSecret: true,
        efacturaOauthRedirectUri: true,
      },
    }),
  ])

  return {
    clientId: company?.efacturaOauthClientId || platform?.efacturaOauthClientId || "",
    clientSecret: company?.efacturaOauthClientSecret || platform?.efacturaOauthClientSecret || "",
    redirectUri: company?.efacturaOauthRedirectUri || platform?.efacturaOauthRedirectUri || "",
    platformConfigured: Boolean(
      platform?.efacturaOauthClientId &&
        platform?.efacturaOauthClientSecret &&
        platform?.efacturaOauthRedirectUri,
    ),
    usesPlatformConfig: Boolean(
      !company?.efacturaOauthClientId &&
        !company?.efacturaOauthClientSecret &&
        !company?.efacturaOauthRedirectUri &&
        platform?.efacturaOauthClientId &&
        platform?.efacturaOauthClientSecret &&
        platform?.efacturaOauthRedirectUri,
    ),
  }
}

function decodeTokenExpiry(token: string | null | undefined) {
  if (!token) return null
  const decoded = jwt.decode(token) as { exp?: number } | null
  if (!decoded?.exp) return null
  return new Date(decoded.exp * 1000)
}

export async function handleAnafOauthCallback(req, res) {
  const code = String(req.query.code || "")
  const stateRaw = String(req.query.state || "")

  if (!code || !stateRaw) {
    return res.status(400).send("Lipsesc parametrii OAuth ANAF.")
  }

  let state: { tenantId: string; returnTo: string } | null = null
  try {
    state = jwt.verify(stateRaw, JWT_SECRET) as { tenantId: string; returnTo: string }
  } catch {
    return res.status(400).send("State OAuth invalid sau expirat.")
  }

  const oauthConfig = await getEffectiveAnafOauthConfig(state.tenantId)
  const moduleCheck = await requireTenantModule(state.tenantId, "efactura")

  if (!moduleCheck.enabled) {
    return res.status(403).send("Modulul e-Factura nu este activ pe licenta acestui client.")
  }

  if (!oauthConfig.clientId || !oauthConfig.clientSecret || !oauthConfig.redirectUri) {
    return res.status(400).send("Configuratia ANAF nu este completa.")
  }

  try {
    const authHeader = Buffer.from(`${oauthConfig.clientId}:${oauthConfig.clientSecret}`).toString("base64")
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: oauthConfig.redirectUri,
      token_content_type: "jwt",
    })

    const tokenRes = await fetch(ANAF_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    })

    const payload = await tokenRes.json().catch(() => ({}))

    if (!tokenRes.ok || !payload?.access_token) {
      await prisma.company.update({
        where: { tenantId: state.tenantId },
        data: {
          efacturaOauthLastError: String(payload?.error_description || payload?.error || "Nu am putut obtine token-ul ANAF."),
        },
      })

      return res.redirect(`${state.returnTo}${state.returnTo.includes("?") ? "&" : "?"}oauth=error`)
    }

    await prisma.company.update({
      where: { tenantId: state.tenantId },
      data: {
        efacturaOauthAccessToken: String(payload.access_token),
        efacturaOauthRefreshToken: payload.refresh_token ? String(payload.refresh_token) : null,
        efacturaOauthAccessTokenExpiresAt: decodeTokenExpiry(String(payload.access_token)),
        efacturaOauthRefreshTokenExpiresAt: decodeTokenExpiry(payload.refresh_token ? String(payload.refresh_token) : null),
        efacturaOauthConnectedAt: new Date(),
        efacturaOauthLastError: null,
      },
    })

    return res.redirect(`${state.returnTo}${state.returnTo.includes("?") ? "&" : "?"}oauth=success`)
  } catch (error: any) {
    await prisma.company.update({
      where: { tenantId: state.tenantId },
      data: {
        efacturaOauthLastError: error?.message || "Eroare la schimbul token-ului ANAF.",
      },
    })

    return res.redirect(`${state.returnTo}${state.returnTo.includes("?") ? "&" : "?"}oauth=error`)
  }
}

router.get("/api/v1/company/efactura/oauth/callback", handleAnafOauthCallback)

router.use(requireAuth)

const ALLOWED_POS_SYNC_INTERVALS = [1, 2, 3, 4, 5, 10, 15, 20, 25, 30]

router.get("/api/v1/company", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId

  try {
    const [company, oauthConfig] = await Promise.all([
      prisma.company.findUnique({
        where: { tenantId }
      }),
      getEffectiveAnafOauthConfig(tenantId),
    ])

    return res.json({
      ok: true,
      company: {
        ...company,
        efacturaPlatformConfigured: oauthConfig.platformConfigured,
        efacturaUsesPlatformConfig: oauthConfig.usesPlatformConfig,
      }
    })
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: e?.message || "Eroare la încărcarea firmei"
    })
  }
})

router.post("/api/v1/company", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId

  const {
    name,
    cui,
    regNo,
    address,
    city,
    county,
    country,
    postalCode,
    bank,
    iban,
    email,
    contactEmail,
    phone,
    isVatPayer,
    posSyncInterval,
    efacturaEnabled,
    efacturaEnvironment,
    efacturaSellerCountryCode,
    efacturaSellerCity,
    efacturaSellerCounty,
    efacturaSellerPostalCode,
    efacturaContactEmail,
    efacturaOauthClientId,
    efacturaOauthClientSecret,
    efacturaOauthRedirectUri
  } = req.body || {}

  if (!String(name || "").trim()) {
    return res.status(400).json({
      ok: false,
      error: "Numele firmei este obligatoriu."
    })
  }

  const nextIsVatPayer = isVatPayer !== undefined ? Boolean(isVatPayer) : true

  let nextPosSyncInterval = 5
  if (posSyncInterval !== undefined) {
    const parsed = Number(posSyncInterval)
    if (!ALLOWED_POS_SYNC_INTERVALS.includes(parsed)) {
      return res.status(400).json({
        ok: false,
        error: "Intervalul de sync POS este invalid."
      })
    }
    nextPosSyncInterval = parsed
  }

  try {
    const existing = await prisma.company.findUnique({
      where: { tenantId }
    })

    const company = await prisma.company.upsert({
      where: { tenantId },
      update: {
        name: String(name).trim(),
        cui: cui ? String(cui).trim() : null,
        regNo: regNo ? String(regNo).trim() : null,
        address: address ? String(address).trim() : null,
        city: city ? String(city).trim() : null,
        county: county ? String(county).trim() : null,
        country: String(country || existing?.country || "RO").trim().toUpperCase() || "RO",
        postalCode: postalCode ? String(postalCode).trim() : null,
        bank: bank ? String(bank).trim() : null,
        iban: iban ? String(iban).trim() : null,
        email: email ? String(email).trim() : null,
        contactEmail: contactEmail ? String(contactEmail).trim() : null,
        phone: phone ? String(phone).trim() : null,
        isVatPayer: isVatPayer !== undefined
          ? nextIsVatPayer
          : (existing?.isVatPayer ?? true),
        efacturaEnabled: efacturaEnabled !== undefined
          ? Boolean(efacturaEnabled)
          : (existing?.efacturaEnabled ?? false),
        efacturaEnvironment: String(efacturaEnvironment || existing?.efacturaEnvironment || "test").trim() || "test",
        efacturaSellerCountryCode: String(efacturaSellerCountryCode || country || existing?.efacturaSellerCountryCode || existing?.country || "RO").trim().toUpperCase() || "RO",
        efacturaSellerCity: String(efacturaSellerCity || city || existing?.efacturaSellerCity || existing?.city || "").trim() || null,
        efacturaSellerCounty: String(efacturaSellerCounty || county || existing?.efacturaSellerCounty || existing?.county || "").trim() || null,
        efacturaSellerPostalCode: String(efacturaSellerPostalCode || postalCode || existing?.efacturaSellerPostalCode || existing?.postalCode || "").trim() || null,
        efacturaContactEmail: String(efacturaContactEmail || contactEmail || existing?.efacturaContactEmail || existing?.contactEmail || "").trim() || null,
        efacturaOauthClientId: efacturaOauthClientId ? String(efacturaOauthClientId).trim() : null,
        efacturaOauthClientSecret: efacturaOauthClientSecret ? String(efacturaOauthClientSecret).trim() : null,
        efacturaOauthRedirectUri: efacturaOauthRedirectUri ? String(efacturaOauthRedirectUri).trim() : null,
        posSyncInterval: posSyncInterval !== undefined
          ? nextPosSyncInterval
          : (existing?.posSyncInterval ?? 5),
        invoiceSeries: existing?.invoiceSeries ?? "FAC",
        purchaseSeries: existing?.purchaseSeries ?? "NIR",
        transferSeries: existing?.transferSeries ?? "TRF",
        inventorySeries: existing?.inventorySeries ?? "INV",
        productionSeries: existing?.productionSeries ?? "PROD",
        customerCodePrefix: existing?.customerCodePrefix ?? "CLI",
        supplierCodePrefix: existing?.supplierCodePrefix ?? "FUR",
      },
      create: {
        tenantId,
        name: String(name).trim(),
        cui: cui ? String(cui).trim() : null,
        regNo: regNo ? String(regNo).trim() : null,
        address: address ? String(address).trim() : null,
        city: city ? String(city).trim() : null,
        county: county ? String(county).trim() : null,
        country: String(country || "RO").trim().toUpperCase() || "RO",
        postalCode: postalCode ? String(postalCode).trim() : null,
        bank: bank ? String(bank).trim() : null,
        iban: iban ? String(iban).trim() : null,
        email: email ? String(email).trim() : null,
        contactEmail: contactEmail ? String(contactEmail).trim() : null,
        phone: phone ? String(phone).trim() : null,
        isVatPayer: nextIsVatPayer,
        efacturaEnabled: Boolean(efacturaEnabled),
        efacturaEnvironment: String(efacturaEnvironment || "test").trim() || "test",
        efacturaSellerCountryCode: String(efacturaSellerCountryCode || country || "RO").trim().toUpperCase() || "RO",
        efacturaSellerCity: String(efacturaSellerCity || city || "").trim() || null,
        efacturaSellerCounty: String(efacturaSellerCounty || county || "").trim() || null,
        efacturaSellerPostalCode: String(efacturaSellerPostalCode || postalCode || "").trim() || null,
        efacturaContactEmail: String(efacturaContactEmail || contactEmail || "").trim() || null,
        efacturaOauthClientId: efacturaOauthClientId ? String(efacturaOauthClientId).trim() : null,
        efacturaOauthClientSecret: efacturaOauthClientSecret ? String(efacturaOauthClientSecret).trim() : null,
        efacturaOauthRedirectUri: efacturaOauthRedirectUri ? String(efacturaOauthRedirectUri).trim() : null,
        posSyncInterval: nextPosSyncInterval,
        invoiceSeries: "FAC",
        purchaseSeries: "NIR",
        transferSeries: "TRF",
        inventorySeries: "INV",
        productionSeries: "PROD",
        customerCodePrefix: "CLI",
        supplierCodePrefix: "FUR",
      }
    })

    return res.json({
      ok: true,
      company
    })
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: e?.message || "Eroare la salvarea firmei"
    })
  }
})

router.get("/api/v1/company/efactura/oauth/start", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const returnTo = String(req.query.returnTo || "").trim() || "http://localhost:5173/setari/efactura"
  const moduleCheck = await requireTenantModule(tenantId, "efactura")

  if (!moduleCheck.enabled) {
    return res.status(403).json({
      ok: false,
      error: "Modulul e-Factura nu este activ pe licenta acestui client.",
    })
  }

  const oauthConfig = await getEffectiveAnafOauthConfig(tenantId)

  if (!oauthConfig.clientId || !oauthConfig.redirectUri) {
    return res.status(400).json({
      ok: false,
      error: "Platforma nu are configurata inca aplicatia ANAF. Completeaza datele globale din Control Panel.",
    })
  }

  const state = jwt.sign(
    {
      tenantId,
      returnTo,
    },
    JWT_SECRET,
    { expiresIn: "15m" },
  )

  const params = new URLSearchParams({
    response_type: "code",
    client_id: oauthConfig.clientId,
    redirect_uri: oauthConfig.redirectUri,
    state,
    token_content_type: "jwt",
  })

  return res.json({
    ok: true,
    url: `${ANAF_AUTH_URL}?${params.toString()}`,
  })
})

router.post("/api/v1/company/efactura/oauth/test", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const moduleCheck = await requireTenantModule(tenantId, "efactura")

  if (!moduleCheck.enabled) {
    return res.status(403).json({
      ok: false,
      error: "Modulul e-Factura nu este activ pe licenta acestui client.",
    })
  }

  const company = await prisma.company.findUnique({
    where: { tenantId },
    select: {
      efacturaOauthAccessToken: true,
      efacturaOauthConnectedAt: true,
      efacturaOauthAccessTokenExpiresAt: true,
    },
  })

  if (!company?.efacturaOauthAccessToken) {
    return res.status(400).json({
      ok: false,
      error: "Nu exista token ANAF salvat pentru aceasta firma. Genereaza mai intai tokenul cu certificatul digital.",
    })
  }

  try {
    const response = await anafHttpRequest(ANAF_TEST_URL, {
      headers: {
        Authorization: `Bearer ${company.efacturaOauthAccessToken}`,
      },
    })

    const text = response.text

    if (!response.ok) {
      await prisma.company.update({
        where: { tenantId },
        data: {
          efacturaOauthLastError: text.slice(0, 1000),
        },
      })

      return res.status(400).json({
        ok: false,
        error: "Conexiunea ANAF a raspuns cu eroare.",
        details: text,
      })
    }

    await prisma.company.update({
      where: { tenantId },
      data: {
        efacturaOauthConnectedAt: company.efacturaOauthConnectedAt ?? new Date(),
        efacturaOauthLastError: null,
      },
    })

    return res.json({
      ok: true,
      message: "Conexiunea ANAF a raspuns corect.",
      details: text,
      expiresAt: company.efacturaOauthAccessTokenExpiresAt,
    })
  } catch (error: any) {
    await prisma.company.update({
      where: { tenantId },
      data: {
        efacturaOauthLastError: error?.message || "Eroare la testarea conexiunii ANAF.",
      },
    })

    return res.status(500).json({
      ok: false,
      error: error?.message || "Eroare la testarea conexiunii ANAF.",
    })
  }
})

router.get("/api/v1/company/document-numbering", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId

  try {
    const settings = await getNumberingConfig(tenantId)
    const [invoice, purchaseReceipt, transfer, inventory, production, deterioration, priceChange, customer, supplier] = await Promise.all([
      getNextNumberPreview(tenantId, "invoice"),
      getNextNumberPreview(tenantId, "purchaseReceipt"),
      getNextNumberPreview(tenantId, "transfer"),
      getNextNumberPreview(tenantId, "inventory"),
      getNextNumberPreview(tenantId, "production"),
      getNextNumberPreview(tenantId, "deterioration"),
      getNextNumberPreview(tenantId, "priceChange"),
      getNextNumberPreview(tenantId, "customer"),
      getNextNumberPreview(tenantId, "supplier"),
    ])

    return res.json({
      ok: true,
      settings,
      previews: { invoice, purchaseReceipt, transfer, inventory, production, deterioration, priceChange, customer, supplier },
    })
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: e?.message || "Eroare la incarcarea numerotarii documentelor",
    })
  }
})

router.post("/api/v1/company/document-numbering", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId

  try {
    const settings = normalizeNumberingPayload(req.body)

    await prisma.company.upsert({
      where: { tenantId },
      update: settings,
      create: {
        tenantId,
        name: "Companie",
        ...settings,
      },
    })

    const counterUpdates: Array<{ key: string; nextNumber: unknown }> = [
      { key: "invoice", nextNumber: req.body?.invoiceNextNumber },
      { key: "purchaseReceipt", nextNumber: req.body?.purchaseReceiptNextNumber },
      { key: "transfer", nextNumber: req.body?.transferNextNumber },
      { key: "inventory", nextNumber: req.body?.inventoryNextNumber },
      { key: "production", nextNumber: req.body?.productionNextNumber },
      { key: "deterioration", nextNumber: req.body?.deteriorationNextNumber },
      { key: "priceChange", nextNumber: req.body?.priceChangeNextNumber },
      { key: "customer", nextNumber: req.body?.customerNextNumber },
      { key: "supplier", nextNumber: req.body?.supplierNextNumber },
    ]

    for (const item of counterUpdates) {
      const parsed = Number(item.nextNumber)
      if (!Number.isFinite(parsed) || parsed < 1) continue

      await prisma.skuCounter.upsert({
        where: {
          tenantId_key: {
            tenantId,
            key: item.key,
          },
        },
        update: {
          value: Math.max(0, Math.floor(parsed) - 1),
        },
        create: {
          tenantId,
          key: item.key,
          value: Math.max(0, Math.floor(parsed) - 1),
        },
      })
    }

    const refreshedSettings = await getNumberingConfig(tenantId)
    const [invoice, purchaseReceipt, transfer, inventory, production, deterioration, priceChange, customer, supplier] = await Promise.all([
      getNextNumberPreview(tenantId, "invoice"),
      getNextNumberPreview(tenantId, "purchaseReceipt"),
      getNextNumberPreview(tenantId, "transfer"),
      getNextNumberPreview(tenantId, "inventory"),
      getNextNumberPreview(tenantId, "production"),
      getNextNumberPreview(tenantId, "deterioration"),
      getNextNumberPreview(tenantId, "priceChange"),
      getNextNumberPreview(tenantId, "customer"),
      getNextNumberPreview(tenantId, "supplier"),
    ])

    return res.json({
      ok: true,
      settings: refreshedSettings,
      previews: { invoice, purchaseReceipt, transfer, inventory, production, deterioration, priceChange, customer, supplier },
    })
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: e?.message || "Eroare la salvarea numerotarii documentelor",
    })
  }
})

router.get("/api/v1/company/pos-sync-config", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId

  try {
    const company = await prisma.company.findUnique({
      where: { tenantId },
      select: {
        posSyncInterval: true
      }
    })

    return res.json({
      ok: true,
      posSyncInterval: company?.posSyncInterval ?? 5,
      allowedIntervals: ALLOWED_POS_SYNC_INTERVALS
    })
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: e?.message || "Eroare la încărcarea setărilor POS"
    })
  }
})

router.post("/api/v1/company/pos-sync-config", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const interval = Number(req.body?.posSyncInterval)

  if (!ALLOWED_POS_SYNC_INTERVALS.includes(interval)) {
    return res.status(400).json({
      ok: false,
      error: "Intervalul de sync POS este invalid."
    })
  }

  try {
    const existingCompany = await prisma.company.findUnique({
      where: { tenantId }
    })

    let company = existingCompany

    if (!company) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true }
      })

      company = await prisma.company.create({
        data: {
          tenantId,
          name: tenant?.name || "Companie",
          posSyncInterval: interval
        }
      })
    } else {
      company = await prisma.company.update({
        where: { tenantId },
        data: {
          posSyncInterval: interval
        }
      })
    }

    return res.json({
      ok: true,
      posSyncInterval: company.posSyncInterval,
      allowedIntervals: ALLOWED_POS_SYNC_INTERVALS
    })
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: e?.message || "Eroare la salvarea setărilor POS"
    })
  }
})

export default router
