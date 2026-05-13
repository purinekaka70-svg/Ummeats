const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const handlerPath = path.resolve(__dirname, "../api/send-order-notification.js");
const pushLibPath = path.resolve(__dirname, "../api/_lib/push.js");

function createResponse() {
  return {
    body: "",
    headers: {},
    statusCode: 200,
    end(payload = "") {
      this.body = payload;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
  };
}

function parseJsonResponse(res) {
  return JSON.parse(res.body || "{}");
}

function createFirestoreMock({ hotels = {}, orders = {}, shopOrders = {} } = {}) {
  const notifications = [];
  const updates = [];

  const createOrderRef = (collectionName, id, dataStore) => ({
    async get() {
      const data = dataStore[id];
      return {
        exists: Boolean(data),
        data: () => data,
      };
    },
    async update(payload) {
      updates.push({ collection: collectionName, id, payload });
      Object.assign(dataStore[id], payload);
    },
  });

  return {
    notifications,
    updates,
    collection(name) {
      if (name === "orders") {
        return {
          doc: (id) => createOrderRef(name, id, orders),
        };
      }

      if (name === "ummaShopOrders") {
        return {
          doc: (id) => createOrderRef(name, id, shopOrders),
        };
      }

      if (name === "hotels") {
        return {
          doc: (id) => ({
            async get() {
              const data = hotels[id];
              return {
                exists: Boolean(data),
                data: () => data,
              };
            },
          }),
        };
      }

      if (name === "notifications") {
        return {
          async add(payload) {
            notifications.push(payload);
            return { id: `notification-${notifications.length}` };
          },
        };
      }

      throw new Error(`Unexpected collection: ${name}`);
    },
  };
}

function loadHandler({ firestore, sendPushMessage = async () => ({ recipients: 1 }) } = {}) {
  delete require.cache[handlerPath];
  delete require.cache[pushLibPath];

  const pushCalls = [];
  require.cache[pushLibPath] = {
    exports: {
      admin: {
        firestore: {
          FieldValue: {
            serverTimestamp: () => "SERVER_TIMESTAMP",
          },
        },
      },
      getFirestore: () => firestore,
      getOneSignalAppId: () => "test-onesignal-app-id",
      getSiteUrl: () => "https://example.test",
      sendJson(res, statusCode, payload) {
        res.statusCode = statusCode;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify(payload));
      },
      async sendPushMessage(payload) {
        pushCalls.push(payload);
        return sendPushMessage(payload);
      },
    },
  };

  return {
    handler: require(handlerPath),
    pushCalls,
  };
}

test("notification API rejects unsupported methods", async () => {
  const firestore = createFirestoreMock();
  const { handler } = loadHandler({ firestore });
  const res = createResponse();

  await handler({ method: "GET" }, res);

  assert.equal(res.statusCode, 405);
  assert.deepEqual(parseJsonResponse(res), { error: "Method not allowed." });
});

test("notification API requires an orderId", async () => {
  const firestore = createFirestoreMock();
  const { handler } = loadHandler({ firestore });
  const res = createResponse();

  await handler({ body: {}, method: "POST" }, res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(parseJsonResponse(res), { error: "orderId is required." });
});

test("standard order dispatch writes in-app notifications and sends push targets", async () => {
  const firestore = createFirestoreMock({
    hotels: {
      hotelA: { name: "Hotel A" },
    },
    orders: {
      orderA: {
        customerName: "Amina",
        hotelId: "hotelA",
      },
    },
  });
  const { handler, pushCalls } = loadHandler({ firestore });
  const res = createResponse();

  await handler({
    body: { orderId: "orderA", type: "order" },
    method: "POST",
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(parseJsonResponse(res).sentInApp, 2);
  assert.equal(parseJsonResponse(res).sentPush, 2);
  assert.deepEqual(
    firestore.notifications.map((item) => ({ message: item.message, to: item.to, type: item.type })),
    [
      { message: "Amina placed an order for Hotel A.", to: "admin", type: "order" },
      { message: "Amina placed an order for Hotel A.", to: "hotelA", type: "order" },
    ],
  );
  assert.deepEqual(pushCalls.map((item) => item.aliases), [["admin"], ["hotelA"]]);
  assert.equal(firestore.updates.length, 1);
  assert.deepEqual(Object.keys(firestore.updates[0].payload).sort(), [
    "notificationAdminDispatchedAt",
    "notificationHotelDispatchedAt",
    "onesignalAdminDispatchedAt",
    "onesignalHotelDispatchedAt",
  ]);
});

test("already dispatched standard orders are not duplicated", async () => {
  const firestore = createFirestoreMock({
    hotels: {
      hotelA: { name: "Hotel A" },
    },
    orders: {
      orderA: {
        customerName: "Amina",
        hotelId: "hotelA",
        notificationAdminDispatchedAt: 1,
        notificationHotelDispatchedAt: 1,
        onesignalAdminDispatchedAt: 1,
        onesignalHotelDispatchedAt: 1,
      },
    },
  });
  const { handler, pushCalls } = loadHandler({ firestore });
  const res = createResponse();

  await handler({
    body: { orderId: "orderA", type: "order" },
    method: "POST",
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(parseJsonResponse(res).sentInApp, 0);
  assert.equal(parseJsonResponse(res).sentPush, 0);
  assert.equal(firestore.notifications.length, 0);
  assert.equal(pushCalls.length, 0);
  assert.equal(firestore.updates.length, 0);
});

test("paid order dispatch notifies customer, admin, and hotel", async () => {
  const firestore = createFirestoreMock({
    hotels: {
      hotelA: { name: "Hotel A" },
    },
    orders: {
      orderA: {
        customerId: "customerA",
        customerName: "Amina",
        hotelId: "hotelA",
      },
    },
  });
  const { handler, pushCalls } = loadHandler({ firestore });
  const res = createResponse();

  await handler({
    body: { orderId: "orderA", type: "order_paid" },
    method: "POST",
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(parseJsonResponse(res).sentInApp, 3);
  assert.equal(parseJsonResponse(res).sentPush, 3);
  assert.deepEqual(
    firestore.notifications.map((item) => ({ message: item.message, to: item.to, type: item.type })),
    [
      { message: "Your order for Hotel A has been marked as paid.", to: "customerA", type: "order-paid" },
      { message: "Order for Amina at Hotel A has been marked as paid.", to: "admin", type: "order-paid" },
      { message: "Order for Amina at Hotel A has been marked as paid.", to: "hotelA", type: "order-paid" },
    ],
  );
  assert.deepEqual(pushCalls.map((item) => item.aliases), [["customerA"], ["admin"], ["hotelA"]]);
});

test("push dispatch falls back from aliases to tag filters when aliases have no recipients", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  const firestore = createFirestoreMock({
    hotels: {
      hotelA: { name: "Hotel A" },
    },
    orders: {
      orderA: {
        customerName: "Amina",
        hotelId: "hotelA",
      },
    },
  });
  const { handler, pushCalls } = loadHandler({
    firestore,
    sendPushMessage: async (payload) => (payload.aliases ? { recipients: 0 } : { recipients: 1 }),
  });
  const res = createResponse();

  try {
    await handler({
      body: { orderId: "orderA", type: "order" },
      method: "POST",
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(parseJsonResponse(res).sentPush, 2);
    assert.deepEqual(pushCalls.map((item) => ({ aliases: item.aliases, filterKeys: item.filters?.map((filter) => filter.key) })), [
      { aliases: ["admin"], filterKeys: undefined },
      { aliases: undefined, filterKeys: ["notification_target"] },
      { aliases: ["hotelA"], filterKeys: undefined },
      { aliases: undefined, filterKeys: ["hotel_id"] },
    ]);
  } finally {
    console.warn = originalWarn;
  }
});
