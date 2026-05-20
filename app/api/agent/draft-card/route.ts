import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase-server";
import { isAdmin } from "@/lib/access";
import { z } from "zod";

const bodySchema = z.object({
  prompt: z.string().min(1).max(2000),
  project_id: z.string().uuid().optional(),
});

// Must match basicCatalog.id from @a2ui/react/v0_9 — otherwise MessageProcessor
// rejects createSurface with "Catalog not found".
const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

export async function POST(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY is not configured" }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { data: me } = await sb
    .from("users")
    .select("id, org_id, name, role, department_id")
    .eq("id", user.id)
    .single();
  if (!me) return NextResponse.json({ error: "no profile" }, { status: 403 });

  const [projectsRes, departmentsRes, teamsRes, teamMembersRes, projectAccessRes] = await Promise.all([
    sb.from("projects").select("*").eq("org_id", me.org_id),
    sb.from("departments").select("id, name").eq("org_id", me.org_id),
    sb.from("teams").select("*").eq("org_id", me.org_id),
    sb.from("team_members").select("*"),
    sb.from("project_access").select("project_id, user_id"),
  ]);
  const allProjects = projectsRes.data ?? [];
  const departments = departmentsRes.data ?? [];

  // The cards RLS write policy only allows team members (or admins) to insert,
  // so filter to projects whose team the user is a member of. (READ access via
  // org-visibility is irrelevant here — we need WRITE access.)
  let projects = allProjects;
  if (!isAdmin(me as any)) {
    const myTeamIds = new Set(
      (teamMembersRes.data ?? []).filter((m: any) => m.user_id === me.id).map((m: any) => m.team_id),
    );
    projects = allProjects.filter(
      (p: any) => p.team_id && myTeamIds.has(p.team_id),
    );
  }

  const projectChoices = projects.map((p: any) => {
    const dept = departments.find((d: any) => d.id === p.department_id);
    return { value: p.id, label: `${dept ? `${dept.name} / ` : ""}${p.name}` };
  });

  if (projectChoices.length === 0) {
    return NextResponse.json(
      { error: "no projects available — ask an admin to grant access" },
      { status: 400 },
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const surfaceId = `card-draft-${Date.now().toString(36)}`;

  const projectOptionsJson = JSON.stringify(projectChoices, null, 2);
  const defaultProjectId = projectChoices[0].value;

  // Few-shot example showing the EXACT v0.9 message shape Gemini must emit.
  // KEY: ChoicePicker.value is DynamicStringList (array), DateTimeInput needs
  // enableDate:true, and the data model values for ChoicePicker must be arrays.
  const exampleOutput = `{
  "messages": [
    {
      "version": "v0.9",
      "createSurface": {
        "surfaceId": "${surfaceId}",
        "catalogId": "${BASIC_CATALOG_ID}",
        "sendDataModel": true
      }
    },
    {
      "version": "v0.9",
      "updateComponents": {
        "surfaceId": "${surfaceId}",
        "components": [
          { "id": "root", "component": "Card", "child": "main_col" },
          { "id": "main_col", "component": "Column", "children": ["title_field","notes_field","priority_field","due_field","project_field","tags_field","submit_btn"] },
          { "id": "title_field", "component": "TextField", "label": "Title", "value": {"path": "/title"} },
          { "id": "notes_field", "component": "TextField", "label": "Notes", "value": {"path": "/notes"} },
          { "id": "priority_field", "component": "ChoicePicker", "label": "Priority", "variant": "mutuallyExclusive", "value": {"path": "/priority"},
            "options": [{"label":"High","value":"high"},{"label":"Medium","value":"medium"},{"label":"Low","value":"low"}] },
          { "id": "due_field", "component": "DateTimeInput", "label": "Due date", "enableDate": true, "value": {"path": "/due_date"} },
          { "id": "project_field", "component": "ChoicePicker", "label": "Project", "variant": "mutuallyExclusive", "value": {"path": "/project_id"},
            "options": ${projectOptionsJson} },
          { "id": "tags_field", "component": "TextField", "label": "Tags (comma-separated)", "value": {"path": "/tags"} },
          { "id": "submit_btn_text", "component": "Text", "text": "Create card" },
          { "id": "submit_btn", "component": "Button", "child": "submit_btn_text",
            "action": { "event": { "name": "submit_card", "context": {
              "title": {"path":"/title"}, "notes": {"path":"/notes"}, "priority": {"path":"/priority"},
              "due_date": {"path":"/due_date"}, "project_id": {"path":"/project_id"}, "tags": {"path":"/tags"}
            } } } }
        ]
      }
    },
    {
      "version": "v0.9",
      "updateDataModel": {
        "surfaceId": "${surfaceId}",
        "value": {
          "title": "EXAMPLE: Publish new pricing page",
          "notes": "Ship the new pricing page; sales is blocked without it.",
          "priority": ["high"],
          "due_date": "${today}",
          "project_id": ["${defaultProjectId}"],
          "tags": "pricing, sales"
        }
      }
    }
  ]
}`;

  const systemPrompt = `You are an assistant inside Orka Project. Your job: take a user's natural-language request and turn it into an A2UI v0.9 message list that renders a pre-filled "create card" form.

Today's date is ${today}.

Return a single JSON object {"messages": [...]} with exactly THREE messages in this order: createSurface, updateComponents, updateDataModel. Copy the EXACT shape of the example below — same field names ("version": "v0.9", nested key like "createSurface"/"updateComponents"/"updateDataModel"). Change ONLY the data-model VALUES (title, notes, priority, due_date, project_id, tags) so they reflect the user's request. Keep the surfaceId, catalogId, component tree, and field paths IDENTICAL to the example.

Pre-fill values from the user's prompt:
- title (string): short imperative, ≤80 chars
- notes (string): 1-3 plain-text sentences, what + why (no markdown)
- priority (string array, exactly one item): ["medium"] by default; ["high"] only if prompt signals urgency/blockers/deadline this week; ["low"] for nice-to-haves
- due_date (string): ISO YYYY-MM-DD if user mentioned a date (anchor to today's date above), otherwise ""
- project_id (string array, exactly one item): choose the most relevant id from the project options in the example; if no clear match, ["${defaultProjectId}"]
- tags (string): 0-5 lowercase keywords, comma-separated (e.g. "marketing, launch")

IMPORTANT: priority and project_id MUST be arrays (e.g. ["high"]) — ChoicePicker requires array values per A2UI v0.9 spec.

EXAMPLE OUTPUT (copy this shape exactly, change only the updateDataModel value):
${exampleOutput}

Return ONLY the JSON object. No prose, no markdown fences, no commentary.`;

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  try {
    const genai = new GoogleGenAI({ apiKey });
    const result = await genai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: parsed.data.prompt }] }],
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        temperature: 0.3,
      },
    });

    const text = result.text ?? "";
    let payload: any;
    try {
      payload = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: "agent returned non-JSON", raw: text.slice(0, 500) },
        { status: 502 },
      );
    }

    const messages = payload?.messages;
    if (!Array.isArray(messages) || messages.length < 2) {
      return NextResponse.json(
        { error: "agent returned no messages", raw: payload },
        { status: 502 },
      );
    }

    // Quick shape check: every message should be a v0.9 message
    const okShape = messages.every(
      (m: any) =>
        m && m.version === "v0.9" &&
        (m.createSurface || m.updateComponents || m.updateDataModel),
    );
    if (!okShape) {
      return NextResponse.json(
        { error: "agent returned malformed A2UI messages", raw: payload },
        { status: 502 },
      );
    }

    return NextResponse.json({ surfaceId, messages });
  } catch (e: any) {
    console.error("[agent/draft-card] gemini call failed:", e);
    return NextResponse.json(
      { error: e?.message || "gemini call failed" },
      { status: 500 },
    );
  }
}
