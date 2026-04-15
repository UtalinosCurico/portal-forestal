const test = require("node:test");
const assert = require("node:assert/strict");

const aiRoute = require("../routes/ai");

function makeResponse({ ok, status, body, requestId = null }) {
  return {
    ok,
    status,
    headers: {
      get(name) {
        return name === "request-id" ? requestId : null;
      },
    },
    text: async () => JSON.stringify(body),
  };
}

test("requestAnthropic reintenta un 500 transitorio y luego responde", async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  let attempts = 0;

  global.setTimeout = (fn, ms, ...args) => {
    fn(...args);
    return 0;
  };

  global.fetch = async () => {
    attempts += 1;

    if (attempts === 1) {
      return makeResponse({
        ok: false,
        status: 500,
        requestId: "req_retry_me",
        body: {
          type: "error",
          error: {
            type: "api_error",
            message: "Internal server error",
          },
          request_id: "req_retry_me",
        },
      });
    }

    return makeResponse({
      ok: true,
      status: 200,
      body: {
        content: [{ text: "ok" }],
      },
    });
  };

  try {
    const payload = await aiRoute.__private.requestAnthropic({
      apiKey: "test-key",
      systemPrompt: "hola",
      messages: [{ role: "user", content: "ping" }],
    });

    assert.equal(attempts, 2);
    assert.equal(payload.content[0].text, "ok");
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
  }
});

test("requestAnthropic devuelve el mensaje del proveedor cuando el error no es transitorio", async () => {
  const originalFetch = global.fetch;

  global.fetch = async () =>
    makeResponse({
      ok: false,
      status: 400,
      requestId: "req_bad_request",
      body: {
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "model: invalid model",
        },
        request_id: "req_bad_request",
      },
    });

  try {
    await assert.rejects(
      aiRoute.__private.requestAnthropic({
        apiKey: "test-key",
        systemPrompt: "hola",
        messages: [{ role: "user", content: "ping" }],
      }),
      (error) => {
        assert.equal(error.statusCode, 502);
        assert.equal(error.message, "model: invalid model");
        assert.equal(error.details.requestId, "req_bad_request");
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});
