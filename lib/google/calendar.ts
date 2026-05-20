import { google } from "googleapis";
import { getGoogleClientForUser } from "./client";
import type { Card } from "../types";

/**
 * Create a Calendar event for a card on the assignee's calendar.
 * Returns the created event ID, or null if the user has no Google token
 * (sign-in only didn't grant calendar scope, or assignee unset).
 */
export async function createCalendarEvent(
  userId: string,
  card: Pick<Card, "title" | "due_date" | "notes" | "id">,
  appUrl: string
): Promise<string | null> {
  if (!card.due_date) return null;

  const oauth = await getGoogleClientForUser(userId);
  if (!oauth) return null;

  const calendar = google.calendar({ version: "v3", auth: oauth });

  try {
    const res = await calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary: `[Stagework] ${card.title}`,
        description:
          (card.notes || "") +
          `\n\n— View card: ${appUrl}/dashboard?card=${card.id}`,
        start: { date: card.due_date },
        end: { date: card.due_date },
        reminders: {
          useDefault: false,
          overrides: [
            { method: "popup", minutes: 60 * 24 },   // 1 day before
            { method: "email", minutes: 60 * 24 * 3 }, // 3 days before
          ],
        },
        // Mark as Stagework-managed so we can find it later
        extendedProperties: {
          private: { stagework_card_id: card.id },
        },
      },
    });
    return res.data.id ?? null;
  } catch (err) {
    console.error("[calendar] create failed:", err);
    return null;
  }
}

export async function updateCalendarEvent(
  userId: string,
  eventId: string,
  card: Pick<Card, "title" | "due_date" | "notes" | "id">,
  appUrl: string
): Promise<boolean> {
  const oauth = await getGoogleClientForUser(userId);
  if (!oauth) return false;

  const calendar = google.calendar({ version: "v3", auth: oauth });

  try {
    await calendar.events.patch({
      calendarId: "primary",
      eventId,
      requestBody: {
        summary: `[Stagework] ${card.title}`,
        description:
          (card.notes || "") +
          `\n\n— View card: ${appUrl}/dashboard?card=${card.id}`,
        ...(card.due_date && {
          start: { date: card.due_date },
          end: { date: card.due_date },
        }),
      },
    });
    return true;
  } catch (err) {
    console.error("[calendar] update failed:", err);
    return false;
  }
}

export async function deleteCalendarEvent(userId: string, eventId: string): Promise<boolean> {
  const oauth = await getGoogleClientForUser(userId);
  if (!oauth) return false;

  const calendar = google.calendar({ version: "v3", auth: oauth });
  try {
    await calendar.events.delete({ calendarId: "primary", eventId });
    return true;
  } catch (err) {
    console.error("[calendar] delete failed:", err);
    return false;
  }
}
