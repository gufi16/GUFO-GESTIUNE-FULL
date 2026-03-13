const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const hash = "$2b$10$7/opg3EhjplKs8MeOtagfOHuOmCbNwlr0Pn2I/Wpzq4s9JgG5sGVK";

  const licenses = await prisma.license.findMany({
    orderBy: { createdAt: "desc" }
  });

  console.log("Licente gasite:", licenses.length);

  if (!licenses.length) {
    console.log("Nu exista nicio licenta in baza de date.");
    return;
  }

  const first = licenses[0];

  await prisma.license.update({
    where: { id: first.id },
    data: {
      keyHash: hash,
      isSuspended: false,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    }
  });

  console.log("Licenta actualizata cu succes.");
  console.log("License ID:", first.id);
  console.log("Cheia care trebuie pusa in Android:");
  console.log("PSH-G931-TB8Q-D6H0");
}

main()
  .catch((e) => {
    console.error("Eroare:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });