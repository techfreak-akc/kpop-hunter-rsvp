require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

const BASE_URL = process.env.BASE_URL || 'https://kpop-hunter-rsvp.onrender.com';

// Guest list: add as many as you want!
// Format: { name: 'First Last', phone: '1XXXXXXXXXX' }
const GUESTS = [
  { name: 'Neeraja Cholleti', phone: '16169008200' },
  { name: 'Madhu Chander', phone: '919154892867' },
];

// Read CLI argument override: node send_whatsapp.js 15551234567 "Guest Name"
const cliPhone = process.argv[2];
const cliName = process.argv[3] || 'Friend';
if (cliPhone) {
  GUESTS.push({ name: cliName, phone: cliPhone });
}

if (GUESTS.length === 0) {
  console.error('No guests defined! Add guests to the GUESTS array or pass: node send_whatsapp.js <PHONE> <NAME>');
  process.exit(1);
}

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'kpop-rsvp-bot' }),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

console.log('\n[HUNTER COMMAND] Initializing WhatsApp connection...\n');

client.on('qr', (qr) => {
  console.log('[ACTION REQUIRED] Scan this QR code with your WhatsApp:\n');
  qrcode.generate(qr, { small: true });
  console.log('\nOpen WhatsApp on your phone → Three dots → Linked Devices → Link a Device\n');
});

client.on('ready', async () => {
  console.log('\n[CONNECTED] WhatsApp session active. Deploying invites...\n');

  for (const guest of GUESTS) {
    const phone = guest.phone.replace(/\D/g, ''); // strip non-digits
    const chatId = `${phone}@c.us`;
    const firstName = guest.name.split(' ')[0];

    // Generate short URL via server API
    let inviteLink = `${BASE_URL}/mission/${encodeURIComponent(guest.name.replace(/\s+/g, '-'))}?phone=${phone}`;
    try {
      const { data } = await axios.post(`${BASE_URL}/api/shorten`, { name: guest.name, phone });
      inviteLink = `${BASE_URL}${data.shortUrl}`;
      console.log(`[🔗] Short link → ${inviteLink}`);
    } catch (e) {
      console.warn(`[!] Short URL failed, using full URL: ${e.message}`);
    }

    const message =
      `Hey ${firstName}! 👋\n\n` +
      `Aaishvy is turning 6! 🎂 We're keeping it simple — just a fun little birthday gathering with the people she loves.\n\n` +
      `That said… we may have gone a tiny bit overboard building her invite. 😄 We coded this just for fun — your own personal page, a chatbot for party questions, and a Hunter Badge waiting after you RSVP. Because why not! 🤓⚡\n\n` +
      `🎖️ Your invite:\n${inviteLink}\n\n` +
      `Hope to see you there! 💕`;

    try {
      await client.sendMessage(chatId, message);
      console.log(`[✓] Invite sent → ${guest.name} (${phone})`);
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`[✗] Failed → ${guest.name}: ${err.message}`);
    }
  }

  console.log('\n[DONE] All invites deployed. You can close this terminal.\n');
  await client.destroy();
  process.exit(0);
});

client.on('auth_failure', () => {
  console.error('[ERROR] Authentication failed. Delete the .wwebjs_auth folder and try again.');
  process.exit(1);
});

client.initialize();
