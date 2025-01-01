const express = require('express');
const multer = require('multer');
const path = require('path');
const ffmpeg = require('ffmpeg-static');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const mongoose = require('mongoose');
const Video = require('./models/Video');

const app = express();
const port = 3000;
const hostname = '0.0.0.0';
const APP_NAME = 'MargoTV';

// Подключение к MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/margotv', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('📦 MongoDB подключена');
}).catch(err => {
  console.error('❌ Ошибка подключения к MongoDB:', err);
});

// Настройка шаблонизатора
app.set('view engine', 'ejs');
app.use(express.static('public'));

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'video') {
      cb(null, file.mimetype.startsWith('video/'));
    } else if (file.fieldname === 'thumbnail') {
      cb(null, file.mimetype.startsWith('image/'));
    } else {
      cb(null, false);
    }
  }
});

// Массив для хранения информации о видео
let videos = [];

// Добавьте в начало файла после других require
const isDev = process.env.NODE_ENV === 'development';

// Добавьте после настройки express
if (isDev) {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
  });
}

// Добавим middleware для CORS если нужно
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

// Главная страница
app.get('/', async (req, res) => {
  try {
    const videos = await Video.find().sort({ uploadDate: -1 });
    res.render('index', { 
      videos: videos,
      appName: APP_NAME 
    });
  } catch (error) {
    console.error('Ошибка при получении видео:', error);
    res.status(500).send('Ошибка сервера');
  }
});

// Страница загрузки
app.get('/upload', (req, res) => {
  res.render('upload', { appName: APP_NAME });
});

// Обработка загрузки видео
app.post('/upload', upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]), async (req, res) => {
  try {
    const title = req.body.title;
    const description = req.body.description;
    const videoFile = req.files['video'][0];
    const thumbnailFile = req.files['thumbnail'] ? req.files['thumbnail'][0] : null;

    const inputPath = videoFile.path;
    const outputPath = `public/videos/${Date.now()}.mp4`;
    const thumbnailPath = thumbnailFile ? 
      `public/thumbnails/${Date.now()}${path.extname(thumbnailFile.originalname)}` : null;

    if (thumbnailFile) {
      fs.copyFileSync(thumbnailFile.path, thumbnailPath);
      fs.unlinkSync(thumbnailFile.path);
    }

    const ffmpegProcess = spawn(ffmpeg, [
      '-i', inputPath,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      outputPath
    ]);

    ffmpegProcess.on('close', async () => {
      try {
        // Создаем новое видео в БД
        await Video.create({
          title,
          description,
          path: outputPath.replace('public/', ''),
          thumbnail: thumbnailPath ? thumbnailPath.replace('public/', '') : null
        });

        fs.unlinkSync(inputPath);
        res.redirect('/');
      } catch (error) {
        console.error('Ошибка при сохранении видео в БД:', error);
        res.status(500).send('Ошибка при сохранении видео');
      }
    });
  } catch (error) {
    console.error('Ошибка при загрузке видео:', error);
    res.status(500).send('Ошибка при загрузке видео');
  }
});

// Создаем дополнительную директорию для thumbnails
['uploads', 'public/videos', 'public/thumbnails'].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Получаем локальный IP адрес
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const interface of interfaces[name]) {
      // Пропускаем non-IPv4 и internal (например, 127.0.0.1)
      if (interface.family === 'IPv4' && !interface.internal) {
        return interface.address;
      }
    }
  }
  return '0.0.0.0';
}

const localIP = getLocalIP();

app.listen(port, hostname, () => {
  console.log(`
    🚀 Сервер MargoTV запущен
    📡 Порт: ${port}
    🔧 Режим: ${isDev ? 'разработка' : 'продакшн'}
    🌐 Локальный: http://localhost:${port}
    🌍 По сети: http://${localIP}:${port}
  `);
}); 