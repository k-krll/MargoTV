const express = require('express');
const multer = require('multer');
const path = require('path');
const ffmpegStatic = require('ffmpeg-static');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const mongoose = require('mongoose');
const Video = require('./models/Video');
const Encoding = require('./models/Encoding');
const http = require('http');
const socketIO = require('socket.io');
const srt2vtt = require('srt-to-vtt');

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
    } else if (file.fieldname === 'subtitles') {
      cb(null, file.originalname.endsWith('.srt'));
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

// Настройки качества видео
const QUALITY_PRESETS = {
  '240p': { height: 240, bitrate: '500k' },
  '360p': { height: 360, bitrate: '800k' },
  '480p': { height: 480, bitrate: '1500k' },
  '720p': { height: 720, bitrate: '2500k' },
  '1080p': { height: 1080, bitrate: '4000k' }
};

// Обновим схему Encoding
const encodingSchema = new mongoose.Schema({
  // ... существующие поля ...
  qualities: [{
    resolution: String,
    status: String,
    progress: Number,
    path: String
  }],
  selectedQualities: [String]
});

// Обработка загрузки видео
app.post('/upload', upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
  { name: 'subtitles', maxCount: 1 }
]), async (req, res) => {
  try {
    const { title, description, qualities } = req.body;
    const selectedQualities = Array.isArray(qualities) ? qualities : [qualities];
    
    const videoFile = req.files['video'][0];
    const thumbnailFile = req.files['thumbnail'] ? req.files['thumbnail'][0] : null;
    const subtitlesFile = req.files['subtitles'] ? req.files['subtitles'][0] : null;

    // Создаем запись о видео
    const video = await Video.create({
      title,
      description,
      status: 'processing',
      path: 'processing',
      thumbnail: thumbnailFile ? `thumbnails/${Date.now()}${path.extname(thumbnailFile.originalname)}` : null
    });

    // Обрабатываем субтитры если они есть
    if (subtitlesFile) {
      const subtitlesPath = `subtitles/${Date.now()}.vtt`;
      const fullSubtitlesPath = path.join('public', subtitlesPath);
      
      // Создаем директорию если её нет
      const subtitlesDir = path.dirname(fullSubtitlesPath);
      if (!fs.existsSync(subtitlesDir)) {
        fs.mkdirSync(subtitlesDir, { recursive: true });
      }

      // Конвертируем субтитры из SRT в VTT
      const srtStream = fs.createReadStream(subtitlesFile.path);
      const vttStream = fs.createWriteStream(fullSubtitlesPath);
      
      srtStream
        .pipe(srt2vtt())
        .pipe(vttStream);

      // Обновляем информацию о субтитрах в базе
      video.subtitles = {
        path: subtitlesPath,
        language: 'ru',
        label: 'Русский'
      };
      await video.save();

      // Удаляем временный файл
      fs.unlinkSync(subtitlesFile.path);
    }

    // Создаем запись о кодировании
    const encoding = await Encoding.create({
      videoId: video._id,
      status: 'pending',
      startTime: new Date()
    });

    encoding.selectedQualities = selectedQualities;
    encoding.qualities = selectedQualities.map(q => ({
      resolution: q,
      status: 'pending',
      progress: 0
    }));
    await encoding.save();

    res.json({ 
      success: true, 
      encodingId: encoding._id,
      redirectUrl: `/encoding-status/${encoding._id}`
    });

    processVideo(videoFile, thumbnailFile, video, encoding, io);
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
async function processVideo(videoFile, thumbnailFile, video, encoding, io) {
  const inputPath = videoFile.path;
  const baseOutputPath = `public/videos/${Date.now()}`;

  console.log('📝 Детали обработки:');
  console.log(`- Входной файл: ${inputPath}`);
  console.log(`- Базовый путь выхода: ${baseOutputPath}`);
  console.log(`- Выбранные качества: ${encoding.selectedQualities.join(', ')}`);

  try {
    // Проверяем существование входного файла
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Входной файл не найден: ${inputPath}`);
    }

    // Создаем директорию если её нет
    const videosDir = path.dirname(baseOutputPath);
    if (!fs.existsSync(videosDir)) {
      fs.mkdirSync(videosDir, { recursive: true });
    }

    // Обработка thumbnail
    if (thumbnailFile) {
      try {
        const thumbnailPath = `public/${video.thumbnail}`;
        const thumbnailDir = path.dirname(thumbnailPath);
        
        if (!fs.existsSync(thumbnailDir)) {
          fs.mkdirSync(thumbnailDir, { recursive: true });
        }
        
        fs.copyFileSync(thumbnailFile.path, thumbnailPath);
        fs.unlinkSync(thumbnailFile.path);
        console.log('✅ Превью успешно сохранено');
      } catch (thumbnailError) {
        console.error('⚠️ Ошибка при обработке превью:', thumbnailError);
        // Продолжаем выполнение даже если с превью проблема
      }
    }

    // Обрабатываем каждое качество
    for (const quality of encoding.selectedQualities) {
      const preset = QUALITY_PRESETS[quality];
      const outputPath = `${baseOutputPath}_${quality}.mp4`;
      
      console.log(`\n🎯 Кодирование ${quality}:`);
      console.log(`- Выходной файл: ${outputPath}`);
      console.log(`- Настройки: ${JSON.stringify(preset)}`);

      try {
        await encodeVideoQuality(
          inputPath, 
          outputPath, 
          preset, 
          3600, // Фиксированная длительность
          quality,
          encoding,
          io
        );
        console.log(`✅ Качество ${quality} успешно обработано`);
      } catch (encodeError) {
        console.error(`❌ Ошибка при кодировании ${quality}:`, encodeError);
        throw encodeError; // Прерываем весь процесс если кодирование не удалось
      }
    }

    // Обновляем статус видео
    await Video.findByIdAndUpdate(video._id, {
      status: 'completed',
      path: `videos/${path.basename(baseOutputPath)}_${encoding.selectedQualities[0]}.mp4`
    });

    console.log('🎉 Обработка видео успешно завершена');
    io.to(encoding._id.toString()).emit('encoding:completed');

  } catch (error) {
    console.error('❌ Критическая ошибка при обработке видео:', error);
    
    // Обновляем статус на ошибку
    await Video.findByIdAndUpdate(video._id, {
      status: 'error',
      error: error.message
    });

    io.to(encoding._id.toString()).emit('encoding:error', { 
      message: error.message,
      details: error.stack
    });

    // Очищаем временные файлы
    try {
      if (fs.existsSync(inputPath)) {
        fs.unlinkSync(inputPath);
      }
    } catch (cleanupError) {
      console.error('⚠️ Ошибка при очистке временных файлов:', cleanupError);
    }
  }
}

// Функция кодирования одного качества
async function encodeVideoQuality(inputPath, outputPath, preset, duration, quality, encoding, io) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-b:v', preset.bitrate,
      '-vf', `scale=-2:${preset.height}`,
      '-preset', 'medium',
      '-progress', 'pipe:1',
      outputPath
    ];

    console.log('🎬 Запуск FFmpeg с аргументами:', args.join(' '));

    const ffmpegProcess = spawn(ffmpegStatic, args);
    let lastProgress = 0;

    ffmpegProcess.stdout.on('data', async (data) => {
      const lines = data.toString().trim().split('\n');
      const progressData = {};
      
      lines.forEach(line => {
        const [key, value] = line.split('=');
        progressData[key] = value;
      });

      if (progressData.out_time_ms) {
        const currentTime = parseInt(progressData.out_time_ms) / 1000000;
        const progress = Math.min((currentTime / duration) * 100, 100);
        
        if (progress - lastProgress >= 1) {
          lastProgress = progress;
          
          // Обновляем прогресс в БД
          await Encoding.updateOne(
            { _id: encoding._id, 'qualities.resolution': quality },
            { 
              $set: { 
                'qualities.$.progress': progress,
                'qualities.$.status': 'processing'
              }
            }
          );

          // Отправляем обновление через WebSocket
          io.to(encoding._id.toString()).emit('encoding:progress', {
            quality,
            progress,
            currentTime,
            duration,
            eta: ((duration - currentTime) / (progress / 100)).toFixed(0)
          });
        }
      }
    });

    ffmpegProcess.stderr.on('data', (data) => {
      console.log('⚠️ FFmpeg stderr:', data.toString());
    });

    ffmpegProcess.on('close', (code) => {
      if (code === 0) {
        console.log('✅ FFmpeg успешно завершил работу');
        resolve();
      } else {
        console.error(`❌ FFmpeg завершился с кодом ${code}`);
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });

    ffmpegProcess.on('error', (err) => {
      console.error('❌ Ошибка запуска FFmpeg:', err);
      reject(err);
    });
  });
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

// API для удаления субтитров
app.delete('/api/videos/:id/subtitles', async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    
    if (!video) {
      return res.status(404).json({ error: 'Видео не найдено' });
    }

    if (video.subtitles && video.subtitles.path) {
      const subtitlesPath = path.join('public', video.subtitles.path);
      if (fs.existsSync(subtitlesPath)) {
        fs.unlinkSync(subtitlesPath);
      }
    }

    video.subtitles = undefined;
    await video.save();
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка при удалении субтитров' });
  }
});

const server = http.createServer(app);
const io = socketIO(server);

// WebSocket подключение
io.on('connection', (socket) => {
  console.log('🔌 WebSocket подключение установлено');

  socket.on('join:encoding', (encodingId) => {
    socket.join(encodingId);
    console.log(`👥 Клиент присоединился к комнате: ${encodingId}`);
  });
});

server.listen(port, hostname, () => {
  console.log(`🚀 Сервер запущен на http://${hostname}:${port}`);
});

// Функция для получения длительности видео
function getVideoInfo(inputPath) {
  return new Promise((resolve) => {
    console.log('📊 Проверка файла:', inputPath, fs.existsSync(inputPath));
    
    // Возвращаем фиктивную длительность, чтобы продолжить процесс
    resolve({ duration: 3600 }); // 1 час как значение по умолчанию
    
    /* Закомментируем проблемную часть пока не найдем решение
    const ffmpegProcess = spawn(ffmpeg, [
      '-i', inputPath,
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'format=duration',
      '-of', 'json'
    ]);

    let output = '';
    let errorOutput = '';

    ffmpegProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    ffmpegProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffmpegProcess.on('close', (code) => {
      if (code === 0) {
        try {
          const info = JSON.parse(output);
          resolve({
            duration: parseFloat(info.format.duration) || 3600
          });
        } catch (error) {
          resolve({ duration: 3600 });
        }
      } else {
        resolve({ duration: 3600 });
      }
    });
    */
  });
} 