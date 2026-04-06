require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const BASE_URL = process.env.BASE_URL || 'https://kpop-hunter-rsvp.onrender.com';

// Guest list: add as many as you want!
// Format: { name: 'First Last', phone: '1XXXXXXXXXX' }
const GUESTS = [
  // { name: 'Sarah Johnson', phone: '15551234567' },
  // { name: 'Mike Chen', phone: '15559876543' },
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
    const encodedName = encodeURIComponent(guest.name.replace(/\s+/g, '-'));
    const missionLink = `${BASE_URL}/mission/${encodedName}?phone=${phone}`;

    const message =
      `Hey ${guest.name.split(' ')[0]}! 🗡️\n\n` +
      `Aaishvy is turning 6 and she's calling in her Hunter Squad! 🎂⚡\n\n` +
      `We hand-coded this invite just for you — using AI to craft something truly one-of-a-kind. Your own personal page, a chatbot to answer all your questions about the event, and a Hunter Badge with your name on it waiting once you RSVP. 🏅\n\n` +
      `Because you're not just any guest — you're part of her squad. 💕\n\n` +
      `👇 Open your personal invite below:\n${missionLink}\n\n` +
      `One mission. One squad. Are you in? ⚡`;


    try {
      await client.sendMessage(chatId, message);
      console.log(`[✓] Invite sent → ${guest.name} (${phone})`);
      // Small delay between messages to avoid spam detection
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
