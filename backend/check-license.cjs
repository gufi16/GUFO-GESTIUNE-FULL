const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const inputKey = "PSH-G931-TB8Q-D6H0";

  const licenses = await prisma.license.findMany({
    where: {
      isSuspended: false,
      expiresAt: {
        gt: new Date()
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  console.log("Licente active gasite:", licenses.length);
  console.log("");

  for (const lic of licenses) {
    const ok = await bcrypt.compare(inputKey, lic.keyHash);

    console.log("License ID:", lic.id);
    console.log("Tenant ID:", lic.tenantId);
    console.log("ExpiresAt:", lic.expiresAt);
    console.log("isSuspended:", lic.isSuspended);
    console.log("MATCH:", ok);
    console.log("----------------------------");
  }
}

main()
  .catch((e) => {
    console.error("Eroare:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });