import { mkdir, readFile, writeFile } from "node:fs/promises";

const artifactPath = "artifacts/contracts/SuperLottery.sol/SuperLottery.json";
const outputPath = "src/abi/SuperLottery.json";

const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
await mkdir("src/abi", { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact.abi, null, 2)}\n`);
console.log(`Copied ABI to ${outputPath}`);
