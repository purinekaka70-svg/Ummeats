const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const pushLibPath = path.resolve(__dirname, "../api/_lib/push.js");
const serviceWorkerPath = path.resolve(__dirname, "../sw.js");

function loadPushLib() {
  delete require.cache[pushLibPath];
  return require(pushLibPath);
}

test("sendPushMessage builds a OneSignal alias push payload", async () => {
  const originalFetch = global.fetch;
  const originalRestKey = process.env.ONESIGNAL_REST_API_KEY;
  const calls = [];
  process.env.ONESIGNAL_REST_API_KEY = "test-rest-key";
  global.fetch = async (url, options) => {
    calls.push({ options, url });
    return {
      ok: true,
      async json() {
        return { id: "notification-id", recipients: 1 };
      },
    };
  };

  try {
    const { sendPushMessage } = loadPushLib();
    const result = await sendPushMessage({
      aliases: ["admin"],
      appId: "test-app-id",
      body: "Amina placed an order for Hotel A.",
      data: { refId: "orderA", type: "order" },
      title: "New order received",
      url: "https://example.test/admin.html",
    });

    assert.deepEqual(result, { id: "notification-id", recipients: 1 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.onesignal.com/notifications?c=push");
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.headers.Authorization, "Key test-rest-key");

    const payload = JSON.parse(calls[0].options.body);
    assert.deepEqual(payload, {
      app_id: "test-app-id",
      contents: {
        en: "Amina placed an order for Hotel A.",
      },
      data: {
        refId: "orderA",
        type: "order",
      },
      headings: {
        en: "New order received",
      },
      include_aliases: {
        external_id: ["admin"],
      },
      target_channel: "push",
      url: "https://example.test/admin.html",
    });
  } finally {
    global.fetch = originalFetch;
    if (originalRestKey === undefined) {
      delete process.env.ONESIGNAL_REST_API_KEY;
    } else {
      process.env.ONESIGNAL_REST_API_KEY = originalRestKey;
    }
  }
});

test("sendPushMessage builds a OneSignal tag filter push payload", async () => {
  const originalFetch = global.fetch;
  const originalRestKey = process.env.ONESIGNAL_REST_API_KEY;
  const calls = [];
  process.env.ONESIGNAL_REST_API_KEY = "test-rest-key";
  global.fetch = async (url, options) => {
    calls.push({ options, url });
    return {
      ok: true,
      async json() {
        return { id: "notification-id", recipients: 2 };
      },
    };
  };

  try {
    const { sendPushMessage } = loadPushLib();
    await sendPushMessage({
      appId: "test-app-id",
      body: "Order update",
      filters: [
        {
          field: "tag",
          key: "notification_target",
          relation: "=",
          value: "hotelA",
        },
      ],
      title: "New order received",
      url: "https://example.test/index.html",
    });

    const payload = JSON.parse(calls[0].options.body);
    assert.deepEqual(payload.filters, [
      {
        field: "tag",
        key: "notification_target",
        relation: "=",
        value: "hotelA",
      },
    ]);
    assert.equal(payload.include_aliases, undefined);
    assert.equal(payload.target_channel, "push");
  } finally {
    global.fetch = originalFetch;
    if (originalRestKey === undefined) {
      delete process.env.ONESIGNAL_REST_API_KEY;
    } else {
      process.env.ONESIGNAL_REST_API_KEY = originalRestKey;
    }
  }
});

test("sendPushMessage requires the OneSignal REST API key", async () => {
  const originalRestKey = process.env.ONESIGNAL_REST_API_KEY;
  delete process.env.ONESIGNAL_REST_API_KEY;

  try {
    const { sendPushMessage } = loadPushLib();
    await assert.rejects(
      () => sendPushMessage({
        aliases: ["admin"],
        appId: "test-app-id",
        body: "Order update",
        title: "New order received",
        url: "https://example.test/admin.html",
      }),
      /Missing required environment variable: ONESIGNAL_REST_API_KEY/,
    );
  } finally {
    if (originalRestKey !== undefined) {
      process.env.ONESIGNAL_REST_API_KEY = originalRestKey;
    }
  }
});

test("service worker loads OneSignal and handles notification clicks", () => {
  const source = fs.readFileSync(serviceWorkerPath, "utf8");

  assert.match(source, /OneSignalSDK\.sw\.js/);
  assert.match(source, /self\.addEventListener\("notificationclick"/);
  assert.match(source, /clients\.openWindow\(targetUrl\)/);
});
