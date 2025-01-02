const mongoose = require('mongoose');

const videoSchema = new mongoose.Schema({
  title: String,
  description: String,
  path: String,
  thumbnail: String,
  status: {
    type: String,
    enum: ['processing', 'completed', 'error'],
    default: 'processing'
  },
  error: String,
  uploadDate: {
    type: Date,
    default: Date.now
  },
  subtitles: {
    path: String,
    language: {
      type: String,
      default: 'ru'
    },
    label: {
      type: String,
      default: 'Русский'
    }
  }
});

module.exports = mongoose.model('Video', videoSchema); 