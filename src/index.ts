import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import path from "path";

dotenv.config();

export const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(process.cwd(), "index.html"));
});

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

const verboseLogs = process.env.VERBOSE_LOGS === "true" || process.env.VERBOSE_LOGS === "1";
// eslint-disable-next-line no-console
console.log(`VERBOSE_LOGS=${verboseLogs ? "true" : "false"}`);
const debugLog = (...args: unknown[]) => {
  if (!verboseLogs) return;
  // eslint-disable-next-line no-console
  console.log("[debug]", ...args);
};

type Severity = "Low" | "Medium" | "High" | "Critical";
type BugPriority = "P0" | "P1" | "P2" | "P3";
type Confidence = "low" | "medium" | "high";
type FixLanguage = "Java" | "Spring" | "JavaScript" | "TypeScript" | "HTML" | "SQL" | "Other";

type AnalyzeRequestBody = {
  testName?: unknown;
  testSteps?: unknown;
  logs?: unknown;
};

type AnalyzeResult = {
  rootCause: string;
  testIntent: string;
  severity: Severity;
  bugPriority: BugPriority;
  fixSuggestion: {
    language: FixLanguage;
    code: string;
  };
  productImpact: string;
  reproductionSteps: string;
  category: string;
  qaInsights: string;
  confidence: Confidence;
};

type ErrorResponse = {
  error: {
    message: string;
    code?: string;
  };
};

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
const openai = apiKey ? new OpenAI({ apiKey }) : null;

const mockOpenAI = process.env.MOCK_OPENAI === "true" || process.env.MOCK_OPENAI === "1";
// eslint-disable-next-line no-console
console.log(`MOCK_OPENAI=${mockOpenAI ? "true" : "false"}`);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

class HttpError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const asyncHandler =
  (
    fn: (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => Promise<unknown>,
  ) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    void fn(req, res, next).catch(next);
  };

const requireOpenAI = (): OpenAI => {
  if (!openai) {
    throw new HttpError(
      500,
      "Missing OPENAI_API_KEY in environment. Check your .env file.",
      "MISSING_OPENAI_API_KEY",
    );
  }
  return openai;
};

const truncate = (s: string, maxChars: number) =>
  s.length > maxChars ? `${s.slice(0, maxChars)}\n...[truncated ${s.length - maxChars} chars]` : s;

const asSeverity = (value: unknown): Severity | null =>
  value === "Low" || value === "Medium" || value === "High" || value === "Critical"
    ? value
    : null;

const asBugPriority = (value: unknown): BugPriority | null =>
  value === "P0" || value === "P1" || value === "P2" || value === "P3" ? value : null;

const asConfidence = (value: unknown): Confidence | null =>
  value === "low" || value === "medium" || value === "high" ? value : null;

const asFixLanguage = (value: unknown): FixLanguage | null =>
  value === "Java" ||
  value === "Spring" ||
  value === "JavaScript" ||
  value === "TypeScript" ||
  value === "HTML" ||
  value === "SQL" ||
  value === "Other"
    ? value
    : null;

const safeParseJsonObject = (raw: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
};

const buildMockAnalyzeResult = (
  testName: string,
  testSteps: string,
  logs: string,
): AnalyzeResult => {
  // Simple deterministic mock for demos; customize logic if you want it to vary by logs.
  const lower = logs.toLowerCase();
  const severity: Severity =
    lower.includes("500") || lower.includes("fatal") ? "Critical" : lower.includes("400") ? "High" : "Medium";
  const bugPriority: BugPriority =
    severity === "Critical" ? "P0" : severity === "High" ? "P1" : severity === "Medium" ? "P2" : "P3";

  return {
    rootCause: `A backend/process error occurs during execution of "${testName}", and downstream components fail to recover.`,
    testIntent: `Verify that "${testName}" completes successfully under expected conditions.`,
    severity,
    bugPriority,
    productImpact:
      "Users may be blocked or degraded in the same flow, reducing completion/conversion and increasing support tickets.",
    reproductionSteps: `1) Run test: ${testName}\n2) Follow steps:\n${truncate(testSteps, 800)}\n3) Observe error in logs.`,
    fixSuggestion: {
      language: "Java",
      code: [
        "@RestControllerAdvice",
        "public class ApiExceptionHandler {",
        "  @ExceptionHandler(PaymentIntentFailedException.class)",
        "  public ResponseEntity<Map<String, Object>> handle(PaymentIntentFailedException ex) {",
        "    Map<String, Object> body = new HashMap<>();",
        "    body.put(\"error\", \"PAYMENT_INTENT_FAILED\");",
        "    body.put(\"message\", ex.getMessage());",
        "    return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body);",
        "  }",
        "}",
      ].join("\n"),
    },
    category: "Backend error / integration",
    qaInsights:
      "Add assertions on HTTP status + response schema, capture correlation IDs, and log the exact failing request payload to reduce triage time.",
    confidence: "medium",
  };
};

const extractOpenAIErrorInfo = (
  err: unknown,
): { status?: number; code?: string; message?: string } => {
  if (!err || typeof err !== "object") return {};

  const e = err as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    error?: { code?: unknown } | undefined;
    message?: unknown;
    response?: { status?: unknown };
  };

  const statusCandidate = e.status ?? e.statusCode ?? e.response?.status;
  const status = typeof statusCandidate === "number" ? statusCandidate : undefined;

  const codeCandidate =
    typeof e.code === "string"
      ? e.code
      : e.error && typeof e.error.code === "string"
        ? e.error.code
        : undefined;

  const message = typeof e.message === "string" ? e.message : undefined;

  return { status, code: codeCandidate, message };
};

app.post(
  "/api/chat",
  asyncHandler(async (req, res) => {
    const message =
      typeof req.body?.message === "string"
        ? req.body.message
        : typeof req.body?.input === "string"
          ? req.body.input
          : "";

    if (!message.trim()) {
      throw new HttpError(400, "Request must include { message: string }", "INVALID_BODY");
    }

    debugLog("/api/chat request received", {
      messageLength: message.length,
    });

    if (mockOpenAI) {
      res.setHeader("X-Debug-Stage", "mock-openai");
      return res.status(200).json({
        reply: `Mock reply (demo mode). I would analyze or respond to: "${message}"`,
      });
    }

    const openai = requireOpenAI();
    const completion = await openai.chat.completions.create({
      model,
      messages: [{ role: "user", content: message }],
    });

    const reply = completion.choices?.[0]?.message?.content ?? "";
    debugLog("/api/chat OpenAI reply received", { replyLength: reply.length });
    return res.status(200).json({ reply });
  }),
);

app.post(
  "/analyze",
  asyncHandler(async (req, res) => {
    const body = req.body as AnalyzeRequestBody;
    const testName = body?.testName;
    const testSteps = body?.testSteps;
    const logs = body?.logs;

    // Debug: helps confirm the request reached this handler (even if console logs aren't visible).
    res.setHeader("X-Debug-Stage", "analyze-handler-reached");

    if (!isNonEmptyString(testName) || !isNonEmptyString(testSteps) || !isNonEmptyString(logs)) {
      throw new HttpError(
        400,
        "Request body must include non-empty strings: testName, testSteps, logs.",
        "INVALID_BODY",
      );
    }

    debugLog("/analyze request received", {
      testNameLength: testName.length,
      testStepsLength: testSteps.length,
      logsLength: logs.length,
      model,
    });

    debugLog("mockOpenAI evaluated", mockOpenAI);

    if (mockOpenAI) {
      res.setHeader("X-Debug-Stage", "mock-openai");
      return res.status(200).json(buildMockAnalyzeResult(testName, testSteps, logs));
    }

    const openai = requireOpenAI();
    const prompt = `You are a senior QA engineer and software developer.\n\nAnalyze the test failure and provide a solution.\n\nInput:\nTest Name: ${truncate(
      testName,
      4_000,
    )}\nTest Steps: ${truncate(testSteps, 12_000)}\nError Logs: ${truncate(logs, 30_000)}\n\nReturn ONLY valid JSON in this format:\n\n{\n\"rootCause\": \"...\",\n\"testIntent\": \"...\",\n\"severity\": \"...\",\n\"bugPriority\": \"...\",\n\"productImpact\": \"...\",\n\"reproductionSteps\": \"...\",\n\"fixSuggestion\": {\n  \"language\": \"Java/JS/etc\",\n  \"code\": \"actual code fix here\"\n},\n\"category\": \"...\",\n\"qaInsights\": \"...\"\n}\n\nRules:\n\n* Fix suggestion MUST be real code\n* If backend error → give Java/Spring code\n* If UI error → give JS/HTML fix\n* If API issue → give request/response fix\n* Keep code minimal and correct\n* Do not explain, only code inside fixSuggestion.code`;

    let completion;
    try {
      res.setHeader("X-Debug-Stage", "openai-call-started");
      completion = await openai.chat.completions.create({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Return JSON only. Output must include keys: rootCause, testIntent, severity, bugPriority, productImpact, reproductionSteps, fixSuggestion, category, qaInsights. Severity must be exactly one of: Low, Medium, High, Critical. bugPriority must be exactly one of: P0, P1, P2, P3. fixSuggestion must be an object with keys: language, code. code must be real minimal code only (no explanations).",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      });
    } catch (err) {
      const info = extractOpenAIErrorInfo(err);
      if (info.status) res.setHeader("X-OpenAI-Error-Status", String(info.status));
      if (info.code) res.setHeader("X-OpenAI-Error-Code", info.code);
      if (info.message) res.setHeader("X-OpenAI-Error-Message", info.message);

      debugLog("OpenAI call failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    const output = completion.choices?.[0]?.message?.content ?? "{}";
    debugLog("/analyze OpenAI output received", { outputPreview: output.slice(0, 200) });

    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch {
      throw new HttpError(502, "OpenAI returned invalid JSON for analysis.", "OPENAI_INVALID_JSON");
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HttpError(502, "OpenAI returned non-object JSON for analysis.", "OPENAI_INVALID_JSON");
    }

    return res.json(parsed);
  }),
);

app.use(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (verboseLogs) {
      // eslint-disable-next-line no-console
      console.error("[debug] error middleware", err instanceof Error ? err.message : err);
    }

    // Express JSON body parser errors (invalid JSON)
    if (err instanceof SyntaxError) {
      return res.status(400).json({
        error: {
          message: "Invalid JSON in request body.",
          code: "INVALID_JSON",
        },
      });
    }

    const getStatusFromUnknownError = (value: unknown): number | undefined => {
      if (!value || typeof value !== "object") return undefined;
      const e = value as { status?: unknown; statusCode?: unknown; response?: unknown };
      const candidate = e.status ?? e.statusCode;
      if (typeof candidate === "number") return candidate;
      if (typeof candidate === "string" && /^\d+$/.test(candidate)) return Number(candidate);
      const responseStatus = (e.response as { status?: unknown } | undefined)?.status;
      if (typeof responseStatus === "number") return responseStatus;
      return undefined;
    };

    const status = err instanceof HttpError ? err.status : getStatusFromUnknownError(err) ?? 500;
    const message = err instanceof Error ? err.message : "Unknown error";
    const code =
      err instanceof HttpError
        ? err.code
        : typeof (err as { code?: unknown } | undefined)?.code === "string"
          ? (err as { code: string }).code
          : undefined;
    res.status(status).json({ error: { message, code } });
  },
);

