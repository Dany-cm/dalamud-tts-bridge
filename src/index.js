const fs = require("fs");
const path = require("path");
const promiseQueue = require("promise-queue");
const sanitize = require("sanitize-filename");
const WebSocket = require("ws");
const dotenv = require("dotenv");
dotenv.config();

const config = {
  coquiHost: process.env.COQUI_HOST || "http://localhost:5002",
  coquiSpeakerId: process.env.COQUI_SPEAKER_ID || "p363",
  dalamudHost: process.env.DALAMUD_HOST || "ws://localhost:51424/Messages",
  vlcHost: process.env.VLC_HOST || "localhost",
  vlcPort: process.env.VLC_PORT || 8080,
  vlcPassword: process.env.VLC_PASSWORD || "ascent",
};

const vlc = require("vlc-client");
const vlcClient = new vlc.Client({
  ip: config.vlcHost,
  port: config.vlcPort,
  password: config.vlcPassword,
});

const axios = require("axios");

const queue = new promiseQueue(1, Infinity);

function speak(text) {
  queue.add(async () => {
    console.log(`Speaking: ${text}`);
    const response = await axios.get(`${config.coquiHost}/api/tts`, {
      params: {
        text,
        speaker_id: config.coquiSpeakerId,
      },
      responseType: "arraybuffer",
    });

    const contentType = response.headers["content-type"];
    if (contentType !== "audio/wav") {
      throw new Error(`Unexpected content type: ${contentType}`);
    }

    // Save data to cache/ directory
    if (!fs.existsSync("cache")) {
      fs.mkdirSync("cache");
    }

    const workingDirectory = process.cwd();

    // Generate a file name based on the text and current timestamp
    const sanitizedText = sanitize(text).replace(/\s+/g, "_");
    const timestamp = Date.now();
    const fileName = `${timestamp}_${sanitizedText}.wav`;
    const filePath = path.join(workingDirectory, "cache", fileName);
    fs.writeFileSync(filePath, response.data);

    // Clear playlist if idle
    vlcClient.status().then((status) => {
      if (status.state === "stopped") {
        vlcClient.emptyPlaylist();
        vlcClient.playFile(filePath);
      }

      if (status.state === "playing") {
        vlcClient.addToPlaylist(filePath);
      }
    });
  });
}

console.log("Opening WebSocket connection to Dalamud...");
const ws = new WebSocket(config.dalamudHost);
ws.on("open", function open() {
  console.log("Connected to Dalamud");
});

ws.on("message", function incoming(data) {
  const message = JSON.parse(data);
  console.log(`Received message: ${JSON.stringify(message, null, 2)}`);
  if (message.Type === "Say") {
    speak(message.Payload);
  }
  if (message.Type === "Cancel") {
    vlcClient.stop();
    vlcClient.emptyPlaylist();
  }
});
