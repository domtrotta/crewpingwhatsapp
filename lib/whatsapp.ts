type WhatsAppButton = {
  id: string;
  title: string;
};

type WhatsAppSendResult = {
  messages?: Array<{
    id?: string;
  }>;
};

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getWhatsAppEndpoint(): string {
  const phoneNumberId = requireEnv('WHATSAPP_PHONE_NUMBER_ID');
  return `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
}

async function sendWhatsAppPayload(payload: Record<string, unknown>) {
  const accessToken = requireEnv('WHATSAPP_ACCESS_TOKEN');
  const endpoint = getWhatsAppEndpoint();

  console.log('[whatsapp] Sending payload', {
    endpoint,
    to: payload.to,
    type: payload.type,
  });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      ...payload,
    }),
  });

  const responseText = await response.text();

  if (!response.ok) {
    console.error('[whatsapp] Send failed', {
      status: response.status,
      statusText: response.statusText,
      responseText,
    });
    throw new Error(`WhatsApp API request failed with status ${response.status}`);
  }

  let parsed: WhatsAppSendResult | null = null;

  try {
    parsed = JSON.parse(responseText) as WhatsAppSendResult;
  } catch {
    parsed = null;
  }

  console.log('[whatsapp] Send succeeded', {
    responseText,
    messageId: parsed?.messages?.[0]?.id,
  });

  return parsed;
}

export async function sendWhatsAppText(to: string, body: string) {
  return sendWhatsAppPayload({
    to,
    type: 'text',
    text: { body },
  });
}

export async function sendWhatsAppInteractiveButtons(
  to: string,
  body: string,
  buttons: WhatsAppButton[],
) {
  if (buttons.length === 0 || buttons.length > 3) {
    throw new Error('WhatsApp interactive buttons require between 1 and 3 buttons');
  }

  return sendWhatsAppPayload({
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.map((button) => ({
          type: 'reply',
          reply: {
            id: button.id,
            title: button.title,
          },
        })),
      },
    },
  });
}
