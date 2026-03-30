import { app } from "./index";

// eslint-disable-next-line no-console
console.log("Starting server...");

const port = Number(process.env.PORT ?? 5000);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on http://localhost:${port}`);
});

