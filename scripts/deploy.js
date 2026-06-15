import { network } from "hardhat";

const DEFAULT_TICKET_PRICE = 1_000_000_000_000_000n;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

async function main() {
  const { ethers } = await network.getOrCreate();
  const Lottery = await ethers.getContractFactory("SuperLottery");

  const ticketPrice = process.env.TICKET_PRICE_WEI
    ? BigInt(process.env.TICKET_PRICE_WEI)
    : DEFAULT_TICKET_PRICE;
  const coordinator = requiredEnv("VRF_COORDINATOR");
  const subscriptionId = BigInt(requiredEnv("VRF_SUBSCRIPTION_ID"));
  const keyHash = requiredEnv("VRF_KEY_HASH");
  const callbackGasLimit = Number(process.env.VRF_CALLBACK_GAS_LIMIT || "500000");
  const nativePayment = process.env.VRF_NATIVE_PAYMENT !== "false";
  const localTesting = process.env.LOCAL_TESTING === "true";

  const lottery = await Lottery.deploy(
    ticketPrice,
    coordinator,
    subscriptionId,
    keyHash,
    callbackGasLimit,
    localTesting,
    nativePayment
  );
  await lottery.waitForDeployment();

  console.log(`SuperLottery deployed to ${await lottery.getAddress()}`);
  console.log(`Local testing draw enabled: ${localTesting}`);
  if (!localTesting) {
    console.log("Add this address as a consumer in your Chainlink VRF subscription.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
