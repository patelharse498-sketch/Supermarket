const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const { test, before, after, beforeEach } = require("node:test");
const fs = require("node:fs");

let testEnv;
const PROJECT_ID = process.env.GCP_PROJECT || "demo-no-project";
const ALICE_UID = "alice_123";
const BOB_UID = "bob_456";

const [emulatorHost, emulatorPortStr] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085").split(":");
const emulatorPort = parseInt(emulatorPortStr, 10);

before(async () => {
  const rules = fs.readFileSync("./firestore.rules", "utf8");
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules,
      host: emulatorHost,
      port: emulatorPort,
    },
  });
});

after(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

beforeEach(async () => {
  if (testEnv) {
    await testEnv.clearFirestore();
  }
});

// --- TESTS ---

test("Unauthenticated user: cannot read products or orders", async () => {
  const unauthDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(unauthDb.collection("products").get());
  await assertFails(unauthDb.collection("orders").get());
  await assertFails(unauthDb.collection("users").doc(ALICE_UID).get());
});

test("Authenticated user: can read products and inventory", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().collection("products").doc("apple_1").set({
      name: "Organic Honeycrisp Apples",
      category: "Produce",
      aisle: "Aisle 1 - Fresh Produce",
      stockQuantity: 45,
      price: 2.99,
      unit: "per lb",
      isOrganic: true
    });
  });

  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  await assertSucceeds(aliceDb.collection("products").doc("apple_1").get());
  await assertSucceeds(aliceDb.collection("products").get());
});

test("Authenticated user: cannot read another user's profile", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().collection("users").doc(BOB_UID).set({
      userId: BOB_UID,
      bonusPoints: 500,
      tier: "Silver",
      displayName: "Bob"
    });
  });

  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  await assertFails(aliceDb.collection("users").doc(BOB_UID).get());
});

test("Authenticated user: can create and update their own profile", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  await assertSucceeds(aliceDb.collection("users").doc(ALICE_UID).set({
    userId: ALICE_UID,
    bonusPoints: 1200,
    tier: "Gold",
    displayName: "Alice",
    email: "alice@example.com",
    address: "742 Evergreen Terrace"
  }));

  // Update bonus points after purchase
  await assertSucceeds(aliceDb.collection("users").doc(ALICE_UID).update({
    bonusPoints: 950
  }));
});

test("Authenticated user: cannot create order for another user", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  await assertFails(aliceDb.collection("orders").doc("order_bad").set({
    userId: BOB_UID,
    totalAmount: 50.0,
    finalAmount: 45.0,
    pointsRedeemed: 100,
    discountAmount: 5.0,
    deliveryDate: "2026-10-20",
    deliveryTimeSlot: "10:00 AM - 12:00 PM",
    deliveryAddress: "123 Main St",
    status: "Scheduled"
  }));
});

test("Authenticated user: can create and read their own order with delivery schedule", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  await assertSucceeds(aliceDb.collection("orders").doc("order_1").set({
    userId: ALICE_UID,
    items: [
      { productId: "apple_1", name: "Apples", price: 2.99, quantity: 2 }
    ],
    totalAmount: 5.98,
    pointsRedeemed: 50,
    discountAmount: 2.50,
    finalAmount: 3.48,
    pointsEarned: 35,
    deliveryDate: "2026-10-20",
    deliveryTimeSlot: "2:00 PM - 4:00 PM",
    deliveryAddress: "742 Evergreen Terrace",
    deliveryType: "Standard Delivery",
    status: "Scheduled"
  }));

  await assertSucceeds(aliceDb.collection("orders").doc("order_1").get());

  // Bob cannot read Alice's order
  const bobDb = testEnv.authenticatedContext(BOB_UID).firestore();
  await assertFails(bobDb.collection("orders").doc("order_1").get());
});
