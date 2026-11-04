import { createHmac, timingSafeEqual } from "node:crypto";
import { getDatabase } from "./lib/database.mjs";

const SESSION_TTL_SECONDS = 8 * 60 * 60;
const SESSION_COOKIE = "admin_session";

function json(status, data, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function getApiPath(request) {
  const pathname = new URL(request.url).pathname;
  if (pathname.startsWith("/api/")) return pathname.slice(4);
  const functionPrefix = "/.netlify/functions/api";
  if (pathname.startsWith(functionPrefix)) {
    return pathname.slice(functionPrefix.length) || "/";
  }
  return pathname;
}

function safeEqual(first, second) {
  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);
  return firstBuffer.length === secondBuffer.length && timingSafeEqual(firstBuffer, secondBuffer);
}

function sessionSecret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || "";
}

function createSessionToken() {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = String(expiresAt);
  const signature = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function isAdmin(request) {
  const cookieHeader = request.headers.get("cookie") || "";
  const token = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!token || !sessionSecret()) return false;

  const [expiresAt, signature] = token.split(".");
  if (!expiresAt || !signature || Number(expiresAt) <= Math.floor(Date.now() / 1000)) return false;
  const expected = createHmac("sha256", sessionSecret()).update(expiresAt).digest("base64url");
  return safeEqual(signature, expected);
}

function sessionCookie(value, maxAge) {
  const secure = process.env.COOKIE_SECURE === "0" ? "" : "; Secure";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > 10_000) throw new Error("Request is too large.");
  return JSON.parse(text);
}

async function handleOptions() {
  const database = await getDatabase();
  const { data, error } = await database
    .from("options")
    .select("id, label, capacity, taken")
    .order("id");
  if (error) throw error;
  const options = data.map((option) => ({
    ...option,
    remaining: option.capacity - option.taken,
  }));
  return json(200, { options });
}

async function handleResponses(request) {
  if (!isAdmin(request)) return json(401, { message: "Admin login required." });
  const database = await getDatabase();
  const [{ data: options, error: optionsError }, { data: submissions, error: submissionsError }] = await Promise.all([
    database.from("options").select("id, label, capacity, taken").order("id"),
    database.from("submissions").select("id, name, option_id").order("name"),
  ]);
  if (optionsError) throw optionsError;
  if (submissionsError) throw submissionsError;

  const peopleByOption = new Map(options.map((option) => [option.id, []]));
  for (const submission of submissions) {
    peopleByOption.get(submission.option_id)?.push({ id: submission.id, name: submission.name });
  }
  const responses = options.map((option) => ({
    ...option,
    remaining: option.capacity - option.taken,
    people: peopleByOption.get(option.id),
  }));
  return json(200, { options: responses });
}

async function handleSubmit(request) {
  const payload = await readJson(request);
  const name = String(payload.name || "").trim();
  const email = String(payload.email || "").trim().toLowerCase();
  const optionId = String(payload.option_id || "").trim();

  if (!name || name.length > 100) return json(400, { message: "Enter your name (up to 100 characters)." });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) {
    return json(400, { message: "Enter a valid email address." });
  }
  if (!optionId) return json(400, { message: "Choose an available option." });

  const database = await getDatabase();
  const { data, error } = await database.rpc("reserve_slot", {
    p_name: name,
    p_email: email,
    p_option_id: optionId,
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  if (!result) throw new Error("Reservation returned no result.");
  if (result.status === "duplicate") return json(409, { message: "This email already has a response." });
  if (result.status !== "ok") return json(409, { message: "That option just filled up. Please choose another." });
  return json(201, { message: "Your place is reserved.", option: result.option_label });
}

async function handleLogin(request) {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password || !sessionSecret()) {
    return json(503, { message: "Admin login is not configured for this site." });
  }

  const payload = await readJson(request);
  if (!safeEqual(String(payload.username || ""), username) || !safeEqual(String(payload.password || ""), password)) {
    return json(401, { message: "Username or password is incorrect." });
  }

  return json(200, { message: "Signed in." }, {
    "Set-Cookie": sessionCookie(createSessionToken(), SESSION_TTL_SECONDS),
  });
}

async function handleCancel(request) {
  if (!isAdmin(request)) return json(401, { message: "Admin login required." });
  const payload = await readJson(request);
  const submissionId = Number(payload.submission_id);
  if (!Number.isSafeInteger(submissionId) || submissionId < 1) {
    return json(400, { message: "Select a valid signup to cancel." });
  }

  const database = await getDatabase();
  const { data, error } = await database.rpc("cancel_slot", {
    p_submission_id: submissionId,
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  if (!result) throw new Error("Cancellation returned no result.");
  if (result.status !== "ok") return json(404, { message: "That signup is no longer active." });
  return json(200, { message: "The signup has been cancelled." });
}

export default async function handler(request) {
  const path = getApiPath(request);
  const method = request.method.toUpperCase();

  try {
    if (method === "GET" && path === "/options") return await handleOptions();
    if (method === "GET" && path === "/responses") return await handleResponses(request);
    if (method === "POST" && path === "/submit") return await handleSubmit(request);
    if (method === "POST" && path === "/login") return await handleLogin(request);
    if (method === "POST" && path === "/admin/cancel") return await handleCancel(request);
    if (method === "POST" && path === "/logout") {
      return json(200, { message: "Signed out." }, { "Set-Cookie": sessionCookie("", 0) });
    }
    return json(404, { message: "Not found." });
  } catch (error) {
    console.error("Netlify API request failed:", error);
    if (error instanceof SyntaxError) return json(400, { message: "Please send a valid response." });
    if (error.message === "Request is too large.") return json(413, { message: error.message });
    return json(500, { message: "The service is temporarily unavailable." });
  }
}