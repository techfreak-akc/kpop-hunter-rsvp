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
                await saveRsvp(sender, contactName, 'ACCEPTED');
                await sendWhatsAppMessage(sender, `Thanks ${contactName}! You're on the list. See you at Concord HQ.`);
              } else if (replyId === 'RSVP_NO' || replyId === 'DECLINE_RSVP' || replyTitle.toUpperCase() === 'PASSING THIS TIME') {
                await saveRsvp(sender, contactName, 'DECLINED');
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

// ── JSONBIN.IO PERSISTENT STORAGE ─────────────────────────────────────────────
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${process.env.JSONBIN_ID}`;
const JSONBIN_HEADERS = {
  'X-Master-Key': process.env.JSONBIN_SECRET,
  'Content-Type': 'application/json'
};

// Bin structure: { rsvps: [...], links: { slug: { url, name, phone } } }
async function readBin() {
  try {
    const res = await axios.get(`${JSONBIN_URL}/latest`, { headers: JSONBIN_HEADERS });
    const record = res.data.record;
    // Migrate old array-only format
    if (Array.isArray(record)) return { rsvps: record.filter(r => r && r.phone), links: {} };
    return {
      rsvps: Array.isArray(record.rsvps) ? record.rsvps.filter(r => r && r.phone) : [],
      links: record.links && typeof record.links === 'object' ? record.links : {}
    };
  } catch (e) {
    console.error('[JSONBin] Read failed, falling back to local:', e.message);
    const rsvpsPath = path.join(__dirname, 'rsvps.json');
    const linksPath = path.join(__dirname, 'shortlinks.json');
    return {
      rsvps: fs.existsSync(rsvpsPath) ? JSON.parse(fs.readFileSync(rsvpsPath, 'utf8')) : [],
      links: fs.existsSync(linksPath) ? JSON.parse(fs.readFileSync(linksPath, 'utf8')) : {}
    };
  }
}

async function writeBin(data) {
  try {
    await axios.put(JSONBIN_URL, data, { headers: JSONBIN_HEADERS });
  } catch (e) {
    console.error('[JSONBin] Write failed, saved locally only:', e.message);
  }
  // Always write local backups
  fs.writeFileSync(path.join(__dirname, 'rsvps.json'), JSON.stringify(data.rsvps, null, 2));
  fs.writeFileSync(path.join(__dirname, 'shortlinks.json'), JSON.stringify(data.links, null, 2));
}

async function readRsvps() {
  return (await readBin()).rsvps;
}

async function saveRsvp(phone, name, status, extra = {}) {
  const bin = await readBin();
  const index = bin.rsvps.findIndex(r => r.phone === phone);
  const record = { phone, name, status, ...extra, timestamp: new Date() };
  if (index !== -1) bin.rsvps[index] = { ...bin.rsvps[index], ...record };
  else bin.rsvps.push(record);
  await writeBin(bin);
}

async function readLinks() {
  return (await readBin()).links;
}

async function saveLinks(links) {
  const bin = await readBin();
  bin.links = links;
  await writeBin(bin);
}

// ── SHORT URL SYSTEM ──────────────────────────────────────────────────────────

// Create a short link: POST /api/shorten { name, phone }
app.post('/api/shorten', async (req, res) => {
  const { name, phone } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'name and phone required' });
  const links = await readLinks();
  const base = name.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  const encodedName = encodeURIComponent(name.replace(/\s+/g, '-'));
  const fullUrl = `/mission/${encodedName}?phone=${phone}`;

  // If slug already exists for a different phone, add a number suffix
  let slug = base;
  let counter = 2;
  while (links[slug] && links[slug].phone !== phone) {
    slug = `${base}${counter++}`;
  }

  links[slug] = { url: fullUrl, name, phone };
  await saveLinks(links);
  res.json({ shortUrl: `/invite/${slug}`, slug });
});

// Redirect short link: GET /invite/:slug
app.get('/invite/:slug', async (req, res) => {
  const links = await readLinks();
  const entry = links[req.params.slug];
  if (entry) res.redirect(entry.url);
  else res.status(404).send('Invite not found');
});

// Fetch a single RSVP by phone
app.get('/api/rsvp/:phone', async (req, res) => {
  const data = await readRsvps();
  const record = data.find(r => r.phone === req.params.phone);
  if (record) res.json(record);
  else res.status(404).json({ error: 'Not found' });
});

// Fetch all RSVPs for dashboard
app.get('/api/rsvps', async (req, res) => {
  const data = await readRsvps();
  res.json(data);
});

// Personalized mission RSVP page
app.get('/mission/:guestName', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'mission.html'));
});

// Handle web RSVP form submission
app.post('/submit-rsvp', async (req, res) => {
  const { name, phone, status, adults, kids, food, notes } = req.body;
  const QRCode = require('qrcode');

  await saveRsvp(phone || 'web', name || 'Guest', status, { adults, kids, food, notes });

  let qrCode = null;
  if (status === 'ACCEPTED') {
    try {
      const badge = `HUNTER COMMAND\nHUNTER: ${(name || 'GUEST').toUpperCase()}\nSTATUS: CONFIRMED\nTHE HUNT: AAISHVY'S 6TH\nDATE: APRIL 19, 2026`;
      qrCode = await QRCode.toDataURL(badge, {
        color: { dark: '#00f5ff', light: '#000014' },
        width: 300,
        margin: 2
      });
    } catch (e) {
      console.error('QR gen error:', e.message);
    }
  }

  res.json({ ok: true, qrCode });
});

// AI Intel Agent endpoint
app.post('/api/intel', (req, res) => {
  const { question } = req.body;
  if (!question || !question.trim()) return res.json({ answer: "👋 Hey there, Hunter! Ask me anything about Aaishvy's party — time, venue, dress code, food, and more!" });
  const q = question.toLowerCase().trim();

  // ── Greetings ────────────────────────────────────────────────────────────
  const greetings = ['hi', 'hey', 'hello', 'howdy', 'hiya', 'sup', 'what\'s up', 'whats up', 'yo', 'greetings', 'good morning', 'good afternoon', 'good evening', 'namaste', 'helo', 'hii', 'heyyy', 'helloo'];
  if (greetings.some(g => q === g || q.startsWith(g + ' ') || q.startsWith(g + '!') || q.startsWith(g + ','))) {
    const replies = [
      "👋 Hey there, Hunter! Welcome to Aaishvy's 6th birthday command center! Ask me about the venue, time, dress code, food, or anything about the party! ⚡",
      "🎉 Hello, Operative! Hunter Command is online and ready. What would you like to know about the party?",
      "👋 Hi! So glad you're here! Ask me anything about Aaishvy's K-pop Demon Hunter party! 🗡️"
    ];
    return res.json({ answer: replies[Math.floor(Math.random() * replies.length)] });
  }

  // ── Thank you / Acknowledgements ─────────────────────────────────────────
  if (q.includes('thank') || q.includes('thanks') || q === 'ok' || q === 'okay' || q === 'got it' || q === 'cool' || q === 'great' || q === 'awesome' || q === 'perfect' || q.includes('noted') || q === 'nice') {
    const replies = [
      "😊 Anytime, Hunter! Let me know if you have any other questions about the party!",
      "🎖️ Happy to help! See you at the hunt on April 19th! ⚡",
      "👍 You're all set! Anything else you'd like to know?"
    ];
    return res.json({ answer: replies[Math.floor(Math.random() * replies.length)] });
  }

  // ── How are you / small talk ──────────────────────────────────────────────
  if (q.includes('how are you') || q.includes('how r u') || q.includes('how are u') || q === 'wassup' || q === 'wsp' || q.includes('what are you') || q.includes('who are you')) {
    return res.json({ answer: "🤖 I'm Hunter Command — your personal party intel bot for Aaishvy's 6th birthday! I'm trained to answer all your party questions. What would you like to know? 🎉" });
  }

  // ── Yes / No confirmations ────────────────────────────────────────────────
  if (q === 'yes' || q === 'yep' || q === 'yup' || q === 'yeah' || q === 'sure' || q === 'no' || q === 'nope' || q === 'nah') {
    return res.json({ answer: "😄 Got it! Feel free to ask me anything about the party — time, location, dress code, food, gifts, and more! 🎂" });
  }

  // ── Party details ─────────────────────────────────────────────────────────
  let answer;
  if (q.includes('start') || q.includes('begin') || q.includes('what time') || q.includes('date') || q.includes('when is') || q.includes('what day') || q.includes('which day') || q.includes('when') || (q.includes('time') && !q.includes('end time'))) {
    answer = "⏰ *Date & Time:* The hunt kicks off on **April 19th, 2026 at 6:00 PM EST**. Don't be late, Hunter!";
  } else if (q.includes('end time') || q.includes('finish') || q.includes('when does it end') || q.includes('duration') || q.includes('how long')) {
    answer = "🎉 *End Time:* There is **no fixed end time** — the party goes on! Come and stay as long as you like. 😄";
  } else if (q.includes('venue') || q.includes('coordinat') || q.includes('map') || q.includes('address') || q.includes('direction') || q.includes('where') || q.includes('gps') || q.includes('location') || q.includes('send loc')) {
    answer = "📍 *Venue:* The Hunter's Home\n**1555 Gossage Ln NW, Concord, NC 28027**\n\n🗺️ https://maps.google.com/?q=1555+Gossage+Ln+NW+Concord+NC+28027";
  } else if (q.includes('park') || q.includes('car') || q.includes('drive')) {
    answer = "🚗 *Parking:* Ample street parking is available right outside — no codes, no hassle!";
  } else if (q.includes('rsvp') || q.includes('deadline') || q.includes('last day') || q.includes('confirm') || q.includes('cancel') || q.includes('update')) {
    answer = "📋 *RSVP Deadline:* Please confirm by **April 16th, 2026**.\n\nNeed to cancel or update? Use the **same RSVP link** you received to update your status.";
  } else if (q.includes('plus one') || (q.includes('bring') && q.includes('friend')) || q.includes('extra person') || q.includes('extra guest')) {
    answer = "👥 *Plus Ones:* Absolutely — bring as many guests as you like! The more the merrier! 🎉";
  } else if (q.includes('kid') || q.includes('child') || q.includes('baby') || q.includes('toddler') || q.includes('family')) {
    answer = "👶 *Kids:* 100% kid-friendly event! Bring everyone — all ages welcome! 🎉";
  } else if (q.includes('dress') || q.includes('wear') || q.includes('outfit') || q.includes('attire') || q.includes('cloth')) {
    answer = "👗 *Dress Code:* Anything comfortable, **neon, or sparkly**! This goes for kids too. Come ready to shine! ✨";
  } else if (q.includes('veg') || q.includes('food') || q.includes('eat') || q.includes('diet') || q.includes('meal') || q.includes('snack') || q.includes('drink')) {
    answer = "🥗 *Food:* Both vegetarian and non-vegetarian options will be available. There's something for everyone!";
  } else if (q.includes('cake') || q.includes('dessert') || q.includes('sweet')) {
    answer = "🎂 *Cake:* Yes — there WILL be a birthday cake! 🎉 Aaishvy approved.";
  } else if (q.includes('theme') || q.includes('kpop') || q.includes('k-pop') || q.includes('demon') || q.includes('hunter') || q.includes('netflix')) {
    answer = "🎤 *Theme:* K-pop Demon Hunters! It's Aaishvy's current obsession — she loves watching the show and pretending to be a Hunter from the popular **Netflix Demon Hunters** series. Neon, fierce, and full of energy! ⚡";
  } else if (q.includes('contact') || q.includes('late') || q.includes('reach') || q.includes('call') || q.includes('arun')) {
    answer = "📱 *Contact:* Running late or have questions? Reach out to Aaishvy's father — **Arun Cholleti** directly via WhatsApp. 🎖️";
  } else if (q.includes('host') || q.includes('parent') || q.includes('organiz') || q.includes('whose') || q.includes('birthday')) {
    answer = "🏠 *Hosts:* The party is hosted by **Arun Cholleti** and **Neeraja Cholleti** — Aaishvy's proud parents! 💕";
  } else if (q.includes('gift') || q.includes('present') || q.includes('registry') || q.includes('bring anything')) {
    answer = "🎁 *Gifts:* Your presence is the best gift! No registry. If you'd like to bring something, Aaishvy loves art supplies, K-pop merch, or books. 💕";
  } else if (q.includes('age') || q.includes('how old') || q.includes('turning') || q.includes('6th') || q.includes('sixth')) {
    answer = "🎂 Aaishvy is turning **6 years old**! She's absolutely thrilled about her K-pop Demon Hunter party! ⚡";
  } else if (q.includes('music') || q.includes('song') || q.includes('dance') || q.includes('activity') || q.includes('game') || q.includes('play')) {
    answer = "🎵 *Activities:* Expect K-pop music, fun games, and lots of energy! It's going to be an epic celebration! ⚡🗡️";
  } else {
    // Friendly fallback with suggestions
    answer = "🤔 I didn't quite catch that! I'm best at answering questions about the party. Try asking me:\n\n📍 *Where is the venue?*\n⏰ *What time does it start?*\n👗 *What should I wear?*\n🎁 *Should I bring a gift?*\n\nOr reach out to **Arun Cholleti** on WhatsApp for anything else! 🎖️";
  }
  res.json({ answer });
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
