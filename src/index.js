const fs = require('fs');
const path = require('path');
const promiseQueue = require('promise-queue');
const sanitize = require('sanitize-filename');
const WebSocket = require('ws');
const dotenv = require('dotenv');
dotenv.config();

const config = {
  coquiHost: process.env.COQUI_HOST || 'http://localhost:5002',
  coquiSpeakerId: process.env.COQUI_SPEAKER_ID || 'p363',
  dalamudHost: process.env.DALAMUD_HOST || 'ws://localhost:51424/Messages',
  saveFile: process.env.SAVE_FILE || true,
};

const axios = require('axios');

const queue = new promiseQueue(1, Infinity);

async function speak(text) {
  return queue.add(async () => {
    console.log(`Speaking: ${text}`);
    const response = await axios.get(`${config.coquiHost}/api/tts`, {
      params: {
        text,
        speaker_id: config.coquiSpeakerId,
      },
      responseType: 'arraybuffer',
    });

    const contentType = response.headers['content-type'];
    if (contentType !== 'audio/wav') {
      throw new Error(`Unexpected content type: ${contentType}`);
    }

    // Save data to cache/ directory
    if (!fs.existsSync('cache')) {
      fs.mkdirSync('cache');
    }

    const workingDirectory = process.cwd();

    // Generate a file name based on the text and current timestamp
    const sanitizedText = sanitize(text).replace(/\s+/g, '_');
    const timestamp = Date.now();
    const fileName = `${timestamp}_${sanitizedText}.wav`;
    const filePath = path.join(workingDirectory, 'cache', fileName);
    fs.writeFileSync(filePath, response.data);

    // import it this way otherwise we get ES Module error
    const { default: Audic } = await import('audic');
    const audio = new Audic(filePath);
    audio.play();
  });
}

console.log('Opening WebSocket connection to Dalamud...');
const ws = new WebSocket(config.dalamudHost);
ws.on('open', function open() {
  console.log('Connected to Dalamud');
});

ws.on('message', function incoming(data) {
  const message = JSON.parse(data);
  console.log(`Received message: ${JSON.stringify(message, null, 2)}`);
  if (message.Type === 'Say') {
    speak(message.Payload);
  }
});
