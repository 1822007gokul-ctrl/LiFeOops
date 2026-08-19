// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const RESEND_SENDER = "onboarding@resend.dev";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function validatePayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "Request body must be a JSON object.";
  }

  const { to, subject, html } = payload as Record<string, unknown>;

  const hasValidRecipient = typeof to === "string"
    ? to.trim().length > 0
    : Array.isArray(to) && to.length > 0 && to.every((address) => typeof address === "string" && address.trim().length > 0);

  if (!hasValidRecipient) {
    return "The 'to' field must be a non-empty email address or array of email addresses.";
  }

  if (typeof subject !== "string" || !subject.trim()) {
    return "The 'subject' field must be a non-empty string.";
  }

  if (typeof html !== "string" || !html.trim()) {
    return "The 'html' field must be a non-empty string.";
  }

  return null;
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, _ctx) => {
    if (!RESEND_API_KEY) {
      return jsonError("RESEND_API_KEY is not configured for this Edge Function.", 500);
    }

    let payload: unknown;

    try {
      payload = await req.json();
    } catch (_error) {
      return jsonError("Request body must contain valid JSON.", 400);
    }

    const validationError = validatePayload(payload);

    if (validationError) {
      return jsonError(validationError, 400);
    }

    const { to, subject, html } = payload as {
      to: string | string[];
      subject: string;
      html: string;
    };

    let res: Response;

    try {
      res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: RESEND_SENDER,
        to,
        subject: subject.trim(),
        html: html.trim(),
      }),
      });
    } catch (_error) {
      return jsonError("Unable to connect to Resend.", 502);
    }

    const data = await res.json().catch(() => ({ error: "Resend returned an invalid response." }));

    if (!res.ok) {
      return Response.json({ error: "Resend rejected the email request.", details: data }, { status: res.status });
    }

    return Response.json(data, { status: 200 });
  }),
};