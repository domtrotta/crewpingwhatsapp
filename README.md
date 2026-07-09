# WhatsApp Crew Booking Bot Backend

Environment variables:

```bash
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

## Webhook verification

Set your WhatsApp webhook URL to:

`/api/whatsapp/webhook`

The GET handler expects:

- `hub.verify_token` matching `WHATSAPP_VERIFY_TOKEN`
- `hub.challenge`

If the token matches, it returns the challenge as plain text.

## Database

Run `supabase/schema.sql` in your Supabase SQL editor.

## Testing

- Send `NEW JOB` to the bot on WhatsApp.
- Reply with the job details in the required format.
- Confirm with `POST`.
- Trusted techs can reply `YES` to trigger the handover flow.
