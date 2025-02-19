require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { OpenAI } = require("openai");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { exec } = require("child_process");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "https://chathelp-y22r.onrender.com",
        methods: ["GET", "POST"]
    }
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "25mb" }));

const upload = multer({ dest: "uploads/" });

const userSessions = new Map();

async function handleTextQuery(message, socket) {
    try {
        const session = userSessions.get(socket.id) || [];
        const messages = [...session, { role: "user", content: message }];

        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: messages,
            temperature: 0.7,
            max_tokens: 500
        });

        const botResponse = response.choices[0].message.content;
        userSessions.set(socket.id, [...messages, { role: "assistant", content: botResponse }]);

        const audioUrl = await generateSpeech(botResponse);
        socket.emit("message", { text: botResponse, audioUrl });

    } catch (error) {
        console.error(`[GPT] Ошибка: ${error.message}`);
        socket.emit("message", { text: "⚠️ Произошла ошибка при обработке запроса" });
    }
}

async function generateSpeech(text) {
    try {
        const audioPath = path.join(__dirname, "public", "response.mp3");

        const response = await openai.audio.speech.create({
            model: "tts-1",
            voice: "alloy",
            input: text
        });

        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(audioPath, buffer);

        return "/response.mp3";
    } catch (error) {
        console.error(`[TTS] Ошибка генерации речи: ${error.message}`);
        return null;
    }
}

io.on("connection", (socket) => {
    console.log(`[WebSocket] Подключился: ${socket.id}`);
    userSessions.set(socket.id, []);

    socket.on("message", async (message) => {
        console.log(`[WebSocket] Сообщение от ${socket.id}: ${message}`);
        await handleTextQuery(message, socket);
    });

    socket.on("disconnect", () => {
        console.log(`[WebSocket] Отключился: ${socket.id}`);
        userSessions.delete(socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[Сервер] Запущен на порту ${PORT}`);
});
