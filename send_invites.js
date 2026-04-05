require('dotenv').config();
const axios = require('axios');

const META_TOKEN = process.env.META_ACCESS_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;

async function sendTemplateInvite(recipientPhone) {
  const payload = {
    messaging_product: "whatsapp",
    to: recipientPhone,
    type: "interactive",
    interactive: {
      type: "button",
      header: {
        type: "image",
        image: {
          link: "https://your-ngrok-url/poster.jpg"
        }
      },
      body: {
        text: "✨ *THE SOCIAL: Celebrating Aaishvy!*\n\nJoin us for a neon-lit afternoon as Aaishvy turns 6! 🌟 We are gathering the squad for some K-pop tunes and birthday cake at the Concord Sector HQ. It’s a simple hang-out to celebrate our favorite girl's big day. 🎂🎤\n\n📅 *WHEN:* April 19th @ 06:00 PM EST\n📍 *WHERE:* 1555 Gossage Ln NW, Concord, NC, 28027\n👗 *WEAR:* Anything neon, sparkly, or just comfortable!"
      },
      action: {
        buttons: [
          { type: "reply", reply: { id: "RSVP_YES", title: "JOIN THE SQUAD" } },
          { type: "reply", reply: { id: "RSVP_NO", title: "PASSING THIS TIME" } }
        ]
      }
    }
  };

  if (process.env.USE_MOCK === 'true') {
    console.log('[MOCK MODE] Outbound Template Invite JSON:', JSON.stringify(payload, null, 2));
    console.log(`[MOCK MODE] Simulated Invite sent successfully to ${recipientPhone}`);
    return;
  }

  if (!META_TOKEN || !PHONE_ID) {
    console.error("Missing Meta access token or phone ID in .env");
    return;
  }

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${META_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`Invite sent successfully to ${recipientPhone}`);
    console.log(response.data);
  } catch (error) {
    console.error("Failed to send template invite:", error.response?.data || error.message);
  }
}

const targetPhone = process.argv[2];
if (!targetPhone) {
  console.log("Usage: node send_invites.js <PHONE_NUMBER>");
  process.exit(1);
}

sendTemplateInvite(targetPhone);
