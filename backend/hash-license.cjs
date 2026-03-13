const bcrypt = require("bcryptjs");

async function run() {
  const key = "PSH-G931-TB8Q-D6H0";

  const hash = await bcrypt.hash(key, 10);

  console.log("LICENSE KEY:");
  console.log(key);
  console.log("");

  console.log("BCRYPT HASH:");
  console.log(hash);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});