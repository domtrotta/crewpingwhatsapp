import { NextRequest, NextResponse } from 'next/server';

import { handleIncomingWhatsAppMessage } from '../../../../lib/jobBot';

type WhatsAppWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        contacts?: Array<{
          profile?: {
            name?: string;
          };
        }>;
        messages?: Array<{
          from?: string;
          id?: string;
          timestamp?: string;
          text?: {
            body?: string;
          };
          interactive?: {
            button_reply?: {
              id?: string;
              title?: string;
            };
            list_reply?: {
              id?: string;
              title?: string;
            };
          };
          button?: {
            text?: string;
          };
          type?: string;
        }>;
      };
    }>;
  }>;
};

type IncomingWebhookMessage = {
  from: string;
  name: string;
  text: string;
  messageId: string;
  timestamp: string;
};

export const runtime = 'nodejs';

function getQueryParam(request: NextRequest, key: string): string | null {
  return new URL(request.url).searchParams.get(key);
}

function extractMessages(payload: WhatsAppWebhookPayload): IncomingWebhookMessage[] {
  const messages: IncomingWebhookMessage[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const senderName = value?.contacts?.[0]?.profile?.name ?? '';

      for (const message of value?.messages ?? []) {
        const from = message.from?.trim();
        const messageId = message.id?.trim();
        const timestamp = message.timestamp?.trim() ?? '';

        if (!from || !messageId) {
          continue;
        }

        const text =
          message.text?.body?.trim() ??
          message.interactive?.button_reply?.title?.trim() ??
          message.interactive?.list_reply?.title?.trim() ??
          message.button?.text?.trim() ??
          '';

        if (!text) {
          continue;
        }

        messages.push({
          from,
          name: senderName,
          text,
          messageId,
          timestamp,
        });
      }
    }
  }

  return messages;
}

export async function GET(request: NextRequest) {
  const mode = getQueryParam(request, 'hub.mode');
  const verifyToken = getQueryParam(request, 'hub.verify_token');
  const challenge = getQueryParam(request, 'hub.challenge');
  console.log('[whatsapp:webhook] GET verification request', {
    mode,
    hasVerifyToken: Boolean(verifyToken),
    hasChallenge: Boolean(challenge),
    tokenMatches: verifyToken === process.env.WHATSAPP_VERIFY_TOKEN,
  });

  if (verifyToken && challenge && verifyToken === process.env.WHATSAPP_VERIFY_TOKEN) {
    if (mode && mode !== 'subscribe') {
      console.warn('[whatsapp:webhook] Unexpected verification mode', { mode });
    }

    return new Response(challenge, {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  return new Response('Forbidden', { status: 403 });
}

export async function POST(request: NextRequest) {
  console.log('[whatsapp:webhook] POST received');
  let payload: WhatsAppWebhookPayload | null = null;

  try {
    payload = (await request.json()) as WhatsAppWebhookPayload;
  } catch (error) {
    console.error('[whatsapp:webhook] Failed to parse payload', error);
    return NextResponse.json({ ok: true });
  }

  const messages = extractMessages(payload);
  console.log('[whatsapp:webhook] Extracted messages', {
    count: messages.length,
    messages: messages.map((message) => ({
      from: message.from,
      name: message.name,
      text: message.text,
      messageId: message.messageId,
      timestamp: message.timestamp,
    })),
  });

  for (const message of messages) {
    console.log('[whatsapp:webhook] Handling incoming message', {
      from: message.from,
      text: message.text,
      messageId: message.messageId,
    });
    void handleIncomingWhatsAppMessage(message).catch((error) => {
      console.error('[whatsapp:webhook] Message processing failed', {
        messageId: message.messageId,
        from: message.from,
        error,
      });
    });
  }

  return NextResponse.json({ ok: true });
}
