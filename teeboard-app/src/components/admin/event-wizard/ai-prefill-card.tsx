"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  aiParseRequestSchema,
  aiParseResponseSchema,
  AI_PARSE_INPUT_MAX,
  type AiEventPrefill,
} from "@/lib/ai/schema";

/**
 * The one-sentence AI event setup card (M4-T004). All enforcement is
 * server-side (the endpoint authorizes, rate-limits, times out, logs, and
 * validates the model output); this component only sends the text and
 * hands the validated pre-fill to the wizard. No LLM SDK, key, or URL
 * ever reaches the client.
 */

const PENDING_MESSAGE = "Reading your description…";

export function AiPrefillCard({
  onPrefill,
  disabled = false,
}: {
  onPrefill: (prefill: AiEventPrefill) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [alert, setAlert] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = aiParseRequestSchema.safeParse({ text });
    if (!parsed.success) {
      setAlert(true);
      setStatus(parsed.error.issues[0]?.message ?? "Describe the event.");
      return;
    }
    setPending(true);
    setAlert(false);
    setStatus(PENDING_MESSAGE);

    try {
      const response = await fetch("/api/admin/events/ai-parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: parsed.data.text }),
      });

      const body: unknown = await response.json();
      const result = aiParseResponseSchema.safeParse(body);
      if (!result.success) {
        setAlert(true);
        setStatus("Couldn't read that");
        return;
      }

      if (result.data.prefill === null) {
        setAlert(true);
        setStatus(result.data.message);
        return;
      }

      setAlert(false);
      setStatus(result.data.message ?? "Auto-filled — review each field.");
      onPrefill(result.data.prefill);
    } catch {
      setAlert(true);
      setStatus("Couldn't read that");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4" aria-hidden />
          Describe it in one sentence
        </CardTitle>
        <CardDescription>
          Paste how a member would say it — the AI drafts the Basics and
          Format steps for you to review. Nothing saves until you do.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid gap-2">
            <Label htmlFor="ai-event-text">Event description</Label>
            <Input
              id="ai-event-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="4-man scramble next Saturday, shotgun 8am, 18 holes, net 80%"
              maxLength={AI_PARSE_INPUT_MAX}
              disabled={disabled || pending}
              required
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={disabled || pending || text.trim().length === 0}>
              {pending ? "Reading…" : "Auto-fill the wizard"}
            </Button>
            {status ? (
              <p
                role={alert ? "alert" : undefined}
                className={
                  alert
                    ? "text-sm font-medium text-destructive"
                    : "text-sm text-muted-foreground"
                }
              >
                {status}
              </p>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
