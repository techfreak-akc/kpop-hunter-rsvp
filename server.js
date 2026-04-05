require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.static('public'));

// Token and credentials
const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
const META_TOKEN = process.env.META_ACCESS_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;

// Webhook Verification (GET)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

// Event Handling (POST)
app.post('/webhook', async (req, res) => {
  // Extract signature
  const signature = req.headers['x-hub-signature-256'];
  const appSecret = process.env.META_APP_SECRET;
  
  // Signature Validation (if appSecret is provided)
  if (appSecret && signature) {
    const expectedSig = 'sha256=' + crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');
    if (signature !== expectedSig) {
      console.error('Invalid signature');
      return res.sendStatus(401);
    }
  }

  const body = req.body;

  if (body.object === 'whatsapp_business_account') {
    for (const entry of body.entry) {
      for (const change of entry.changes) {
        if (change.value && change.value.messages) {
          const messages = change.value.messages;
          const contacts = change.value.contacts;
          const contactName = contacts ? contacts[0].profile.name : 'Unknown';

          for (const message of messages) {
            const sender = message.from;

            // Handle Interactive Button Reply
            if (message.type === 'interactive' && message.interactive.type === 'button_reply') {
              const replyId = message.interactive.button_reply.id;
              const replyTitle = message.interactive.button_reply.title;
              
              if (replyId === 'RSVP_YES' || replyId === 'ACCEPT_RSVP' || replyTitle.toUpperCase() === 'JOIN THE SQUAD') {
                saveRsvp(sender, contactName, 'ACCEPTED');
                await sendWhatsAppMessage(sender, `Thanks ${contactName}! You're on the list. See you at Concord HQ.`);
              } else if (replyId === 'RSVP_NO' || replyId === 'DECLINE_RSVP' || replyTitle.toUpperCase() === 'PASSING THIS TIME') {
                saveRsvp(sender, contactName, 'DECLINED');
                await sendWhatsAppMessage(sender, "Understood. Maybe next time.");
              }
            } 
            // Handle standard text response using expected interactive prompts and basic AI persona simulated answers
            else if (message.type === 'text') {
              const text = message.text.body.toLowerCase();
              let responseText = "Agency Command here. Awaiting orders.";

              // simulated AI/rule-based responses
              if (text.includes('where is the event') || text.includes('where') || text.includes('location')) {
                responseText = "Agency Command: The operations base is located exactly at 1555 Gossage Ln NW, Concord, NC, 28027. Be sharp.";
              } else if (text.includes('what time is it happening') || text.includes('when') || text.includes('time')) {
                responseText = "Agency Command: Operation commences April 19th at 06:00 PM EST. Do not be late.";
              } else if (text.includes('theme') || text.includes('wear')) {
                responseText = "Agency Command: Code name K-pop Demon Hunter. Dress accordingly.";
              } else if (text.includes('park')) {
                responseText = "Agency Command: Secure parking is available in the underground bunker beneath the HQ. Provide code 0409 at the gate.";
              } else if (text.includes('gift') || text.includes('bring')) {
                responseText = "Agency Command: No gifts required. If you must, encrypted drives or energy drinks are accepted.";
              } else if (text.includes('allerg') || text.includes('food') || text.includes('eat')) {
                responseText = "Agency Command: Dietary restrictions have been logged. All rations provided will be free of common allergens (nut/dairy/gluten free).";
              }

              // Send response text with Interactive Buttons so user gets quick reply suggestions
              await sendInteractiveMenu(sender, responseText);
            }
          }
        }
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

function saveRsvp(phone, name, status) {
  const filePath = path.join(__dirname, 'rsvps.json');
  let data = [];
  if (fs.existsSync(filePath)) {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  const index = data.findIndex(r => r.phone === phone);
  if (index !== -1) {
    data[index].status = status;
    data[index].name = name;
  } else {
    data.push({ phone, name, status, timestamp: new Date() });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// Fetch all RSVPs for dashboard
app.get('/api/rsvps', (req, res) => {
  const filePath = path.join(__dirname, 'rsvps.json');
  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.json(data);
  } else {
    res.json([]);
  }
});

async function sendWhatsAppMessage(to, text) {
  const payload = {
    messaging_product: "whatsapp",
    to: to,
    type: "text",
    text: { body: text }
  };

  if (process.env.USE_MOCK === 'true') {
    console.log('[MOCK MODE] Outbound WhatsApp Message JSON:', JSON.stringify(payload, null, 2));
    return;
  }

  if(!META_TOKEN || !PHONE_ID) return;
  try {
    await axios.post(
      `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`,
      payload,
      { headers: { Authorization: `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('Error sending message:', e.response?.data || e.message);
  }
}

async function sendInteractiveMenu(to, bodyText) {
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: [
          { type: "reply", reply: { id: "ASK_LOCATION", title: "Where is the event?" } },
          { type: "reply", reply: { id: "ASK_TIME", title: "What time is it happening?" } }
        ]
      }
    }
  };

  if (process.env.USE_MOCK === 'true') {
    console.log('[MOCK MODE] Outbound Interactive Menu JSON:', JSON.stringify(payload, null, 2));
    return;
  }

  if(!META_TOKEN || !PHONE_ID) return;
  try {
    await axios.post(
      `https://graph.facebook.com/v21.0/${PHONE_ID}/messages`,
      payload,
      { headers: { Authorization: `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('Error sending interactive menu:', e.response?.data || e.message);
  }
}

app.listen(PORT, () => {
  console.log(`Ghost Runtime actively listening on port ${PORT}`);
});
