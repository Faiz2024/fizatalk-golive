import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const root = new URL("../", import.meta.url);

Deno.test("Railway selects the root bot Dockerfile instead of the website build", async () => {
  const config = JSON.parse(await Deno.readTextFile(new URL("railway.json", root)));
  assertEquals(config.build.builder, "DOCKERFILE");
  assertEquals(config.build.dockerfilePath, "Dockerfile");
  const dockerfile = await Deno.readTextFile(new URL(config.build.dockerfilePath, root));
  assert(dockerfile.startsWith("FROM denoland/deno:2.4.2\n"));
  assert(dockerfile.includes('CMD ["run", "--v8-flags=--max-old-space-size=256", "--allow-net", "--allow-env", "railway/server.ts"]'));
  assertEquals(/vite|bun run build|npm run build/.test(dockerfile), false);
  assertEquals(config.deploy.healthcheckPath, "/health");
  assertEquals(config.deploy.numReplicas, 1);
});

Deno.test("root and legacy Dockerfiles stay identical and copy existing bot sources", async () => {
  const dockerfile = await Deno.readTextFile(new URL("Dockerfile", root));
  assertEquals(dockerfile, await Deno.readTextFile(new URL("railway/Dockerfile", root)));
  for (const line of dockerfile.split("\n")) {
    if (!line.startsWith("COPY ")) continue;
    const source = line.split(/\s+/)[1];
    assert(source);
    const stat = await Deno.stat(new URL(source, root));
    assert(stat.isFile || stat.isDirectory);
  }
});