export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const isProduction = process.env.NEXTAUTH_URL
    ? !process.env.NEXTAUTH_URL.includes("localhost")
    : false;

  if (!isProduction) return;

  const { startWorker } = await import("./worker/index");
  startWorker();
}
