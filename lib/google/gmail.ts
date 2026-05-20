import { google } from "googleapis";
import { getGoogleClientForUser } from "./client";

/**
 * Build an RFC-2822 message and base64url-encode for Gmail API.
 */
function buildMimeMessage(opts: {
  to: string;
  from: string;
  subject: string;
  html: string;
}): string {
  const message = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    opts.html,
  ].join("\r\n");

  return Buffer.from(message).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Send an email via Gmail API as the given user. Used for nudges sent on
 * behalf of a manager, weekly digests, etc.
 */
export async function sendGmail(
  fromUserId: string,
  fromEmail: string,
  to: string,
  subject: string,
  html: string
): Promise<boolean> {
  const oauth = await getGoogleClientForUser(fromUserId);
  if (!oauth) return false;

  const gmail = google.gmail({ version: "v1", auth: oauth });

  try {
    await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: buildMimeMessage({ to, from: fromEmail, subject, html }),
      },
    });
    return true;
  } catch (err) {
    console.error("[gmail] send failed:", err);
    return false;
  }
}

// ====================================================================
// Email templates
// ====================================================================

const EMAIL_BASE_STYLES = `
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
  color: #0F172A; line-height: 1.5; max-width: 560px; margin: 0 auto;
`;

export function checkpointNudgeEmail(opts: {
  recipientName: string;
  cardTitle: string;
  checkpoint: number;
  checkpointLabel: string;
  cardUrl: string;
}): string {
  return `<div style="${EMAIL_BASE_STYLES}">
    <div style="border-left: 3px solid #2563EB; padding: 4px 0 4px 16px; margin: 24px 0;">
      <div style="font-size: 12px; color: #64748B; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">
        ${opts.checkpoint}% — ${opts.checkpointLabel} Checkpoint
      </div>
      <div style="font-size: 18px; font-weight: 600; margin-top: 4px;">${opts.cardTitle}</div>
    </div>
    <p>Hi ${opts.recipientName},</p>
    <p>Your card has crossed the <strong>${opts.checkpoint}% checkpoint</strong>. Time to request feedback before moving further.</p>
    <p>Use the FEEDBACK lenses (Feasible, Execution, Enhancement, Deliverables, Behaviors, Assumptions, Clarity, Key Next Step) to ask targeted questions of your reviewer.</p>
    <p style="margin: 32px 0;">
      <a href="${opts.cardUrl}" style="background: #2563EB; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600;">
        Open card →
      </a>
    </p>
    <p style="font-size: 12px; color: #94A3B8; margin-top: 40px; border-top: 1px solid #E2E8F0; padding-top: 16px;">
      Sent by Stagework · You're receiving this because a card you own has hit a Michelin Method checkpoint.
    </p>
  </div>`;
}

export function weeklyDigestEmail(opts: {
  recipientName: string;
  weekOf: string;
  inProgress: number;
  needsFeedback: number;
  overdue: number;
  served: number;
  highlights: { title: string; stage: string; progress: number }[];
  appUrl: string;
}): string {
  const stat = (label: string, n: number, color: string) => `
    <td style="padding: 12px; text-align: center; background: #F8FAFC; border-radius: 6px; min-width: 80px;">
      <div style="font-size: 24px; font-weight: 700; color: ${color}; line-height: 1;">${n}</div>
      <div style="font-size: 11px; color: #64748B; margin-top: 4px;">${label}</div>
    </td>`;

  const highlightRow = (h: { title: string; stage: string; progress: number }) => `
    <tr>
      <td style="padding: 10px 12px; border-bottom: 1px solid #F1F5F9; font-size: 14px;">${h.title}</td>
      <td style="padding: 10px 12px; border-bottom: 1px solid #F1F5F9; font-size: 12px; color: #64748B;">${h.stage}</td>
      <td style="padding: 10px 12px; border-bottom: 1px solid #F1F5F9; font-size: 12px; color: #64748B; text-align: right; font-family: monospace;">${h.progress}%</td>
    </tr>`;

  return `<div style="${EMAIL_BASE_STYLES}">
    <h1 style="font-size: 22px; margin: 24px 0 4px;">Your week in Stagework</h1>
    <div style="font-size: 13px; color: #64748B; margin-bottom: 24px;">${opts.weekOf} · Hi ${opts.recipientName}</div>

    <table style="width: 100%; border-spacing: 8px 0;">
      <tr>
        ${stat("In progress", opts.inProgress, "#2563EB")}
        ${stat("Needs feedback", opts.needsFeedback, "#7C3AED")}
        ${stat("Overdue", opts.overdue, "#DC2626")}
        ${stat("Served", opts.served, "#059669")}
      </tr>
    </table>

    ${opts.highlights.length > 0 ? `
      <h2 style="font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748B; margin: 32px 0 8px;">Active cards</h2>
      <table style="width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #E2E8F0; border-radius: 6px; overflow: hidden;">
        ${opts.highlights.map(highlightRow).join("")}
      </table>
    ` : `<p style="color: #64748B;">No active cards this week. Time to start something new?</p>`}

    <p style="margin: 32px 0;">
      <a href="${opts.appUrl}/dashboard" style="background: #2563EB; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600;">
        Open Stagework →
      </a>
    </p>

    <p style="font-size: 12px; color: #94A3B8; margin-top: 40px; border-top: 1px solid #E2E8F0; padding-top: 16px;">
      Sent every Monday. Reply with feedback or questions.
    </p>
  </div>`;
}
