require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { getJson } = require('serpapi');
const { OpenAI } = require('openai');
const path = require('path');


const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});


const serpApiKey = process.env.SERPAPI_KEY;
if (!serpApiKey) {
  console.error("SerpAPI Key отсутствует!");
  process.exit(1);
}


const searchWithSerpAPI = async (query) => {
  try {
    console.log(`Поиск информации для запроса: ${query}`);
    const params = {
      engine: "google",
      q: query,
      api_key: serpApiKey,
    };
    const result = await getJson("https://serpapi.com/search", params);
    console.log("Результаты поиска через SerpAPI:", result);
    return result.organic_results
      ? result.organic_results.map(item => item.title).join('\n')
      : "Ничего не найдено.";
  } catch (error) {
    console.error("Ошибка при запросе через SerpAPI:", error);
    return "Ошибка при поиске новой информации.";
  }
};


const getResponseFromGPT = async (query) => {
  try {
    console.log("Отправка запроса в OpenAI с сообщением:", query);
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: query }],
    });

    return response.choices[0].message.content || "Ответ отсутствует.";
  } catch (error) {
    console.error("Ошибка при получении ответа от OpenAI:", error);
    return "Ошибка при обработке запроса с использованием GPT-4o.";
  }
};


const handleQuery = async (query) => {
  
  const requiresInternetSearch = /поиск|найди|новости|узнай/i.test(query);

  if (requiresInternetSearch) {
    
    const cleanQuery = query.replace(/поиск|найди|узнай|новости/i, '').trim();
    const serpResponse = await searchWithSerpAPI(cleanQuery);

    return serpResponse;
  } else {
    
    return await getResponseFromGPT(query);
  }
};


const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'https://chathelp-y22r.onrender.com',
  },
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

io.on('connection', (socket) => {
  console.log("Новое подключение:", socket.id);

  
  socket.on('message', async (message) => {
    console.log(`Получено сообщение от ${socket.id}: ${message}`);
    const response = await handleQuery(message);
    socket.emit('message', response);
  });

  
  socket.on('gesture', async (gestureData) => {
    console.log("Получен жест:", gestureData);

    
    const query = `Обработан жест: ${JSON.stringify(gestureData)}`;
    const response = await handleQuery(query);

    socket.emit('gestureResponse', response);
  });

  socket.on('disconnect', () => {
    console.log("Пользователь отключился:", socket.id);
  });
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
