const express = require('express');
const multer = require('multer');
const path = require('path');
const ffmpeg = require('ffmpeg-static');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const mongoose = require('mongoose');
const Video = require('./models/Video');
const Encoding = require('./models/Encoding');

const app = express();
const port = 3005;
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

    // Создаем запись о видео с временным путем
    const video = await Video.create({
      title,
      description,
      status: 'processing',
      path: 'processing', // Добавляем временный путь
      thumbnail: thumbnailFile ? `thumbnails/${Date.now()}${path.extname(thumbnailFile.originalname)}` : null
    });

    // Создаем запись о кодировании
    const encoding = await Encoding.create({
      videoId: video._id,
      status: 'pending',
      startTime: new Date()
    });

    // Отправляем ID для отслеживания
    res.json({ 
      success: true, 
      encodingId: encoding._id,
      redirectUrl: `/encoding-status/${encoding._id}`
    });

    // Начинаем кодирование асинхронно
    processVideo(videoFile, thumbnailFile, video, encoding);
  } catch (error) {
    console.error('Ошибка при загрузке:', error);
    res.status(500).json({ error: 'Upload error' });
  }
});

// Добавляем роут для проверки статуса
app.get('/encoding-status/:id', (req, res) => {
  res.render('encoding-status', { 
    encodingId: req.params.id,
    appName: APP_NAME 
  });
});

// API endpoint для получения статуса
app.get('/api/encoding-status/:id', async (req, res) => {
  try {
    const encoding = await Encoding.findById(req.params.id).populate('videoId');
    res.json(encoding);
  } catch (error) {
    res.status(500).json({ error: 'Status check error' });
  }
});

// Функция обработки видео
async function processVideo(videoFile, thumbnailFile, video, encoding) {
  const inputPath = videoFile.path;
  const outputPath = `public/videos/${Date.now()}.mp4`;

  console.log(`
🎬 Начало обработки видео:
- ID: ${video._id}
- Название: ${video.title}
- Входной файл: ${inputPath}
- Выходной файл: ${outputPath}
  `);

  try {
    // Обработка thumbnail если есть
    if (thumbnailFile) {
      const thumbnailPath = `public/${video.thumbnail}`;
      console.log(`📸 Обработка превью: ${thumbnailPath}`);
      fs.copyFileSync(thumbnailFile.path, thumbnailPath);
      fs.unlinkSync(thumbnailFile.path);
      console.log('✅ Превью сохранено');
    }

    // Получаем информацию о видео
    console.log('📊 Получение информации о видео...');
    const ffprobeProcess = spawn(ffmpeg, [
      '-i', inputPath,
      '-show_entries', 'format=duration',
      '-v', 'quiet',
      '-of', 'csv=p=0'
    ]);

    let duration = 0;
    ffprobeProcess.stdout.on('data', (data) => {
      duration = parseFloat(data.toString());
      encoding.duration = duration;
      encoding.save();
      console.log(`⏱️ Длительность видео: ${duration.toFixed(2)} секунд`);
    });

    // Запускаем кодирование
    console.log('🔄 Начало кодирования...');
    const ffmpegProcess = spawn(ffmpeg, [
      '-i', inputPath,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-progress', 'pipe:1',
      outputPath
    ]);

    ffmpegProcess.stdout.on('data', async (data) => {
      const lines = data.toString().trim().split('\n');
      const progressData = {};
      
      lines.forEach(line => {
        const [key, value] = line.split('=');
        progressData[key] = value;
      });

      if (progressData.out_time_ms) {
        const currentTime = parseInt(progressData.out_time_ms) / 1000000;
        const progress = (currentTime / duration) * 100;
        
        encoding.currentTime = currentTime;
        encoding.progress = Math.min(progress, 100);
        encoding.status = 'processing';
        await encoding.save();

        // Логируем прогресс каждые 10%
        if (Math.floor(progress) % 10 === 0) {
          console.log(`⏳ Прогресс кодирования: ${progress.toFixed(1)}%`);
        }
      }
    });

    ffmpegProcess.stderr.on('data', (data) => {
      console.log(`🔧 FFmpeg: ${data.toString()}`);
    });

    ffmpegProcess.on('close', async (code) => {
      if (code === 0) {
        // Успешное завершение
        console.log('✅ Кодирование завершено успешно');
        video.path = outputPath.replace('public/', '');
        video.status = 'completed';
        await video.save();

        encoding.status = 'completed';
        encoding.progress = 100;
        encoding.endTime = new Date();
        await encoding.save();

        console.log(`
📝 Итоги обработки:
- Статус: Успешно
- Длительность: ${duration.toFixed(2)} сек
- Выходной файл: ${outputPath}
- Время обработки: ${((encoding.endTime - encoding.startTime) / 1000).toFixed(1)} сек
        `);

        fs.unlinkSync(inputPath);
        console.log('🗑️ Временные файлы удалены');
      } else {
        // Ошибка
        console.error(`❌ Ошибка кодирования: FFmpeg завершился с кодом ${code}`);
        encoding.status = 'error';
        encoding.error = `FFmpeg exited with code ${code}`;
        await encoding.save();

        video.status = 'error';
        await video.save();
      }
    });
  } catch (error) {
    console.error('❌ Критическая ошибка:', error);
    encoding.status = 'error';
    encoding.error = error.message;
    await encoding.save();

    video.status = 'error';
    await video.save();
  }
}

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

// Добавляем обработчик ошибок
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).send('Внутренняя ошибка сервера');
});

// Страница редактирования видео
app.get('/edit/:id', async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) {
      return res.status(404).send('Видео не найдено');
    }
    res.render('edit', { 
      video: video,
      appName: APP_NAME 
    });
  } catch (error) {
    res.status(500).send('Ошибка сервера');
  }
});

// API для обновления видео
app.post('/api/videos/:id', upload.single('thumbnail'), async (req, res) => {
  try {
    const { title, description } = req.body;
    const video = await Video.findById(req.params.id);
    
    if (!video) {
      return res.status(404).json({ error: 'Видео не найдено' });
    }

    // Обновляем превью если загружено новое
    if (req.file) {
      const thumbnailPath = `thumbnails/${Date.now()}${path.extname(req.file.originalname)}`;
      
      // Удаляем старое превью если оно есть
      if (video.thumbnail) {
        const oldPath = path.join('public', video.thumbnail);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }

      // Сохраняем новое превью
      fs.copyFileSync(req.file.path, `public/${thumbnailPath}`);
      fs.unlinkSync(req.file.path);
      video.thumbnail = thumbnailPath;
    }

    video.title = title;
    video.description = description;
    await video.save();

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка при обновлении' });
  }
});

// API для удаления видео
app.delete('/api/videos/:id', async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    
    if (!video) {
      return res.status(404).json({ error: 'Видео не найдено' });
    }

    // Удаляем файлы
    if (video.path) {
      const videoPath = path.join('public', video.path);
      if (fs.existsSync(videoPath)) {
        fs.unlinkSync(videoPath);
      }
    }

    if (video.thumbnail) {
      const thumbnailPath = path.join('public', video.thumbnail);
      if (fs.existsSync(thumbnailPath)) {
        fs.unlinkSync(thumbnailPath);
      }
    }

    // Удаляем запись из БД
    await video.deleteOne();
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка при удалении' });
  }
});

app.listen(port, hostname, () => {
  console.log(`
    🚀 Сервер MargoTV запущен
    📡 Порт: ${port}
    🔧 Режим: ${isDev ? 'разработка' : 'продакшн'}
    🌐 Локальный: http://localhost:${port}
    🌍 По сети: http://${localIP}:${port}
    📦 MongoDB URI: ${process.env.MONGODB_URI}
  `);
}); 