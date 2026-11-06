import { app } from "./app.js";
import { pool } from "./db.js";
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, () =>
  console.log(`Smart Parking API: http://localhost:${port}`),
);
function shutdown() {
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
