import dotenv from "dotenv"
dotenv.config()

import bcrypt from "bcryptjs"
import { prisma } from "./lib/prisma"
import { hashSecret, makeLicenseKey } from "./lib/auth"

async function main() {
  const demoEmail = "admin@demo.local"
  const demoPassword = "admin1234"

  let tenant = await prisma.tenant.findFirst({
    where: { name: "Demo Tenant" }
  })

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: { name: "Demo Tenant" }
    })
  }

  const passwordHash = await hashSecret(demoPassword)

  const existingUser = await prisma.user.findFirst({
    where: {
      tenantId: tenant.id,
      email: demoEmail
    }
  })

  let user
  if (!existingUser) {
    user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: demoEmail,
        name: "Admin Demo",
        passwordHash,
        role: "OWNER",
        isActive: true
      }
    })
  } else {
    user = await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        name: "Admin Demo",
        passwordHash,
        role: "OWNER",
        isActive: true
      }
    })
  }

  let company = await prisma.company.findUnique({
    where: { tenantId: tenant.id }
  })

  if (!company) {
    company = await prisma.company.create({
      data: {
        tenantId: tenant.id,
        name: "POSHARD IMPEX SRL",
        cui: "RO42691617",
        regNo: "J12/2000/2028",
        address: "CALEA FLORESTI 20, CLUJ NAPOCA, CLUJ",
        bank: "Transilvania Cluj",
        iban: "RO74BTRLRONCRT0557477501",
        email: "ervinarg@poshard.ro",
        phone: "0733985881"
      }
    })
  } else {
    await prisma.company.update({
      where: { id: company.id },
      data: {
        name: "POSHARD IMPEX SRL",
        cui: "RO42691617",
        regNo: "J12/2000/2028",
        address: "CALEA FLORESTI 20, CLUJ NAPOCA, CLUJ",
        bank: "Transilvania Cluj",
        iban: "RO74BTRLRONCRT0557477501",
        email: "ervinarg@poshard.ro",
        phone: "0733985881"
      }
    })
  }

  let location = await prisma.location.findFirst({
    where: {
      tenantId: tenant.id,
      code: "MAG1"
    }
  })

  if (!location) {
    location = await prisma.location.create({
      data: {
        tenantId: tenant.id,
        name: "Magazin 1",
        code: "MAG1",
        isActive: true
      }
    })
  }

  const existingVat19 = await prisma.vatRate.findFirst({
    where: {
      tenantId: tenant.id,
      rate: 19
    }
  })

  if (!existingVat19) {
    await prisma.vatRate.create({
      data: {
        tenantId: tenant.id,
        name: "TVA 19%",
        rate: 19,
        isActive: true
      }
    })
  }

  const existingVat9 = await prisma.vatRate.findFirst({
    where: {
      tenantId: tenant.id,
      rate: 9
    }
  })

  if (!existingVat9) {
    await prisma.vatRate.create({
      data: {
        tenantId: tenant.id,
        name: "TVA 9%",
        rate: 9,
        isActive: true
      }
    })
  }

  const existingVat5 = await prisma.vatRate.findFirst({
    where: {
      tenantId: tenant.id,
      rate: 5
    }
  })

  if (!existingVat5) {
    await prisma.vatRate.create({
      data: {
        tenantId: tenant.id,
        name: "TVA 5%",
        rate: 5,
        isActive: true
      }
    })
  }

  const existingVat0 = await prisma.vatRate.findFirst({
    where: {
      tenantId: tenant.id,
      rate: 0
    }
  })

  if (!existingVat0) {
    await prisma.vatRate.create({
      data: {
        tenantId: tenant.id,
        name: "TVA 0%",
        rate: 0,
        isActive: true
      }
    })
  }

  const defaultUoms = [
    { code: "buc", name: "Bucată" },
    { code: "set", name: "Set" },
    { code: "portie", name: "Porție" },
    { code: "kg", name: "Kilogram" },
    { code: "g", name: "Gram" },
    { code: "l", name: "Litru" },
    { code: "ml", name: "Mililitru" },
    { code: "bax", name: "Bax" },
    { code: "cutie", name: "Cutie" },
    { code: "sac", name: "Sac" },
    { code: "lada", name: "Ladă" },
    { code: "pachet", name: "Pachet" },
    { code: "bidon", name: "Bidon" },
    { code: "sticla", name: "Sticlă" },
    { code: "doza", name: "Doză" }
  ]

  const existingUoms = await prisma.uom.findMany({
    where: { tenantId: tenant.id }
  })
  const uomsByCode = new Map(existingUoms.map(item => [item.code.trim().toLowerCase(), item]))

  for (const unit of defaultUoms) {
    const existing = uomsByCode.get(unit.code)

    if (existing) {
      await prisma.uom.update({
        where: { id: existing.id },
        data: {
          code: unit.code,
          name: unit.name,
          isActive: true
        }
      })
      continue
    }

    await prisma.uom.create({
      data: {
        tenantId: tenant.id,
        code: unit.code,
        name: unit.name,
        isActive: true
      }
    })
  }

  const activeLicense = await prisma.license.findFirst({
    where: {
      tenantId: tenant.id,
      isSuspended: false,
      expiresAt: { gt: new Date() }
    },
    orderBy: { createdAt: "desc" }
  })

  let printedLicenseKey = "(licență existentă păstrată)"
  if (!activeLicense) {
    const licenseKey = makeLicenseKey("PSH")
    const keyHash = bcrypt.hashSync(licenseKey, 10)

    await prisma.license.create({
      data: {
        tenantId: tenant.id,
        keyHash,
        keyPrefix: licenseKey.slice(0, 3),
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
        modDashboard: true,
        modDocuments: true,
        modInventory: true,
        modNomenclature: true,
        modSettings: true,
        modPos: true,
        modReports: true,
        limitLocations: 10,
        limitTerminals: 20
      }
    })

    printedLicenseKey = licenseKey
  }

  console.log("✅ Seed OK")
  console.log("Tenant:", tenant.id)
  console.log("User:", user.email)
  console.log("Password:", demoPassword)
  console.log("Location:", location.id, location.code)
  console.log("LICENSE KEY:", printedLicenseKey)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })